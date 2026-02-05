import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import { parseFile } from "./services/fileParser";
import { setupAuth } from "./auth";
import { 
  computeRawFeatures, 
  computeVerticalityScore, 
  getAbstractionLevel,
  buildSingleTextPrompt,
  buildComparisonPrompt,
  formatSingleTextReport,
  formatComparisonReport
} from "./stylometrics";
import { shouldUseCoherentProcessing, getWordCount } from "./services/coherent/router";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup Google OAuth authentication
  setupAuth(app);
  
  const { analyzeText, analyzeTextStreaming, callLLM } = await import("./llm");

  app.post("/api/parse-file", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const result = await parseFile(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );

      res.json(result);
    } catch (error: any) {
      console.error("File parsing error:", error);
      res.status(500).json({ error: error.message || "Failed to parse file" });
    }
  });

  app.post("/api/analyze", async (req, res) => {
    try {
      const { text, provider, functionType, username } = req.body;

      if (!text || typeof text !== "string") {
        return res.status(400).json({ 
          error: "Missing or invalid 'text' field in request body" 
        });
      }

      if (!provider || typeof provider !== "string") {
        return res.status(400).json({ 
          error: "Missing or invalid 'provider' field in request body" 
        });
      }

      if (!functionType || typeof functionType !== "string") {
        return res.status(400).json({ 
          error: "Missing or invalid 'functionType' field in request body" 
        });
      }

      // Check credits for logged-in users
      let userId: number | null = null;
      if (req.isAuthenticated() && req.user) {
        userId = req.user.id;
        const userCredits = await storage.getUserCredits(userId);
        if (userCredits <= 0) {
          return res.status(403).json({ 
            error: "Insufficient credits. Please purchase more credits to continue.",
            needsCredits: true
          });
        }
      } else if (!username) {
        return res.status(401).json({ error: "Please log in to use analysis features" });
      }

      const result = await analyzeText(text, provider, functionType);
      
      // Deduct credits based on output word count
      if (userId) {
        const { calculateCreditsForWords } = await import("./services/stripe");
        const outputText = JSON.stringify(result);
        const wordCount = outputText.split(/\s+/).length;
        const creditsUsed = calculateCreditsForWords(provider, wordCount);
        await storage.deductCredits(userId, creditsUsed);
      }
      
      // Save to history if user is logged in
      if (username && typeof username === "string" && username.trim().length >= 2) {
        try {
          const cleanUsername = username.trim().toLowerCase();
          let user = await storage.getUserByUsername(cleanUsername);
          if (!user) {
            user = await storage.createUser({ username: cleanUsername });
          }
          
          const inputPreview = text.substring(0, 200) + (text.length > 200 ? "..." : "");
          
          await storage.createAnalysisHistory({
            userId: user.id,
            analysisType: functionType,
            provider: provider,
            inputPreview: inputPreview,
            outputData: result
          });
        } catch (saveError) {
          console.error("Failed to save to history:", saveError);
        }
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("Analysis error:", error);
      res.status(500).json({ 
        error: error.message || "Analysis failed" 
      });
    }
  });

  app.post("/api/analyze/stream", async (req, res) => {
    try {
      const { text, provider, functionType, username } = req.body;

      if (!text || typeof text !== "string") {
        return res.status(400).json({ 
          error: "Missing or invalid 'text' field in request body" 
        });
      }

      if (!provider || typeof provider !== "string") {
        return res.status(400).json({ 
          error: "Missing or invalid 'provider' field in request body" 
        });
      }

      if (!functionType || typeof functionType !== "string") {
        return res.status(400).json({ 
          error: "Missing or invalid 'functionType' field in request body" 
        });
      }

      // Check credits for logged-in users
      let userId: number | null = null;
      if (req.isAuthenticated() && req.user) {
        userId = req.user.id;
        const userCredits = await storage.getUserCredits(userId);
        if (userCredits <= 0) {
          return res.status(403).json({ 
            error: "Insufficient credits. Please purchase more credits to continue.",
            needsCredits: true
          });
        }
      } else if (!username) {
        return res.status(401).json({ error: "Please log in to use analysis features" });
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      let fullContent = '';
      await analyzeTextStreaming(text, provider, functionType, (chunk: string) => {
        fullContent += chunk;
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      });

      // Deduct credits based on output word count
      if (userId) {
        const { calculateCreditsForWords } = await import("./services/stripe");
        const wordCount = fullContent.split(/\s+/).length;
        const creditsUsed = calculateCreditsForWords(provider, wordCount);
        await storage.deductCredits(userId, creditsUsed);
      }

      // Save to history if user is logged in
      if (username && typeof username === "string" && username.trim().length >= 2) {
        try {
          const cleanUsername = username.trim().toLowerCase();
          let user = await storage.getUserByUsername(cleanUsername);
          if (!user) {
            user = await storage.createUser({ username: cleanUsername });
          }
          
          const inputPreview = text.substring(0, 200) + (text.length > 200 ? "..." : "");
          
          // Structure the output data based on function type
          let outputData: any;
          try {
            outputData = JSON.parse(fullContent);
          } catch {
            // For text-based outputs, structure them properly based on type
            if (functionType === "analyzer") {
              outputData = { analyzer: fullContent };
            } else if (functionType === "database") {
              outputData = { database: fullContent };
            } else if (functionType === "rewrite") {
              outputData = { summary: fullContent };
            } else {
              outputData = { rawContent: fullContent };
            }
          }
          
          await storage.createAnalysisHistory({
            userId: user.id,
            analysisType: functionType,
            provider: provider,
            inputPreview: inputPreview,
            outputData: outputData
          });
        } catch (saveError) {
          console.error("Failed to save streaming result to history:", saveError);
        }
      }

      // Deduct credits
      if (req.isAuthenticated() && req.user) {
        try {
          const { calculateCreditsForWords } = await import("./services/stripe");
          const wordCount = fullContent.split(/\s+/).length;
          const creditsUsed = calculateCreditsForWords(provider, wordCount);
          await storage.deductCredits(req.user.id, creditsUsed);
          res.write(`data: ${JSON.stringify({ creditsUsed })}\n\n`);
        } catch (creditError) {
          console.error("Failed to deduct credits:", creditError);
        }
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error("Streaming analysis error:", error);
      res.write(`data: ${JSON.stringify({ error: error.message || "Analysis failed" })}\n\n`);
      res.end();
    }
  });

  const { extractPositionsHolistic, formatPositionsForCopy } = await import("./services/positionExtractor");

  app.post("/api/positions/extract", async (req, res) => {
    try {
      const { text, provider, username, useOutlineMode = true } = req.body;

      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Missing or invalid 'text' field" });
      }

      const result = await extractPositionsHolistic(text, provider || "openai", undefined, useOutlineMode);
      
      if (username && typeof username === "string" && username.trim().length >= 2) {
        try {
          const cleanUsername = username.trim().toLowerCase();
          let user = await storage.getUserByUsername(cleanUsername);
          if (!user) {
            user = await storage.createUser({ username: cleanUsername });
          }
          
          await storage.createAnalysisHistory({
            userId: user.id,
            analysisType: "positions",
            provider: provider || "openai",
            inputPreview: text.substring(0, 200) + (text.length > 200 ? "..." : ""),
            outputData: result
          });
        } catch (saveError) {
          console.error("Failed to save positions to history:", saveError);
        }
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("Position extraction error:", error);
      res.status(500).json({ error: error.message || "Position extraction failed" });
    }
  });

  app.post("/api/positions/extract/stream", async (req, res) => {
    const { text, provider, username, useOutlineMode = true, author, depth = 8 } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'text' field" });
    }

    const extractionDepth = Math.min(10, Math.max(1, parseInt(depth) || 8));

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let isComplete = false;

    const cleanup = () => {
      isComplete = true;
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    };

    const flushResponse = () => {
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    };

    heartbeatInterval = setInterval(() => {
      if (!isComplete) {
        try {
          res.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
          flushResponse();
        } catch {}
      }
    }, 15000);

    req.on('close', cleanup);
    req.on('error', cleanup);

    res.write(`data: ${JSON.stringify({ type: 'progress', stage: 'starting', message: 'Starting extraction...' })}\n\n`);
    flushResponse();

    try {
      let result;
      
      if (shouldUseCoherentProcessing(text)) {
        const { positionsCoherent } = await import("./services/coherent/positionsCoherent");
        const coherentResult = await positionsCoherent(
          text,
          { author, depth: extractionDepth, showMinor: false },
          provider || "openai",
          (progress) => {
            if (!isComplete) {
              res.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`);
              flushResponse();
            }
          }
        );
        result = {
          positions: coherentResult.positions.map((p, i) => ({
            number: i + 1,
            position: p.position,
            importance: p.importance,
            confidence: p.confidence
          })),
          totalPositions: coherentResult.positions.length,
          documentId: coherentResult.documentId
        };
      } else {
        result = await extractPositionsHolistic(
          text, 
          provider || "openai",
          (progress) => {
            if (!isComplete) {
              res.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`);
              flushResponse();
            }
          },
          useOutlineMode,
          author,
          extractionDepth
        );
      }
      
      if (username && typeof username === "string" && username.trim().length >= 2) {
        try {
          const cleanUsername = username.trim().toLowerCase();
          let user = await storage.getUserByUsername(cleanUsername);
          if (!user) {
            user = await storage.createUser({ username: cleanUsername });
          }
          
          await storage.createAnalysisHistory({
            userId: user.id,
            analysisType: "positions",
            provider: provider || "openai",
            inputPreview: text.substring(0, 200) + (text.length > 200 ? "..." : ""),
            outputData: result
          });
        } catch (saveError) {
          console.error("Failed to save positions to history:", saveError);
        }
      }

      // Deduct credits
      if (req.isAuthenticated() && req.user) {
        try {
          const { calculateCreditsForWords } = await import("./services/stripe");
          const outputText = JSON.stringify(result);
          const wordCount = outputText.split(/\s+/).length;
          const creditsUsed = calculateCreditsForWords(provider || "openai", wordCount);
          await storage.deductCredits(req.user.id, creditsUsed);
          res.write(`data: ${JSON.stringify({ type: 'credits', creditsUsed })}\n\n`);
        } catch (creditError) {
          console.error("Failed to deduct credits:", creditError);
        }
      }

      cleanup();
      res.write(`data: ${JSON.stringify({ type: 'complete', result })}\n\n`);
      flushResponse();
      res.end();
    } catch (error: any) {
      cleanup();
      console.error("Position extraction streaming error:", error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      flushResponse();
      res.end();
    }
  });

  const { extractQuotesHolistic, formatQuotesForDisplay } = await import("./services/quoteExtractor");

  app.post("/api/quotes/extract/stream", async (req, res) => {
    const { text, provider, username, useOutlineMode = true, author, depth = 5 } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'text' field" });
    }

    if (!author || typeof author !== "string" || author.trim().length < 2) {
      return res.status(400).json({ error: "Author name is required" });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      let result;
      
      if (shouldUseCoherentProcessing(text)) {
        const { quotesCoherent } = await import("./services/coherent/quotesCoherent");
        const coherentResult = await quotesCoherent(
          text,
          { author: author.trim(), depth },
          provider || "openai",
          (progress) => {
            res.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`);
          }
        );
        result = {
          quotes: coherentResult.quotes,
          totalQuotes: coherentResult.quotes.length,
          documentId: coherentResult.documentId
        };
      } else {
        result = await extractQuotesHolistic(
          text, 
          provider || "openai",
          author.trim(),
          (progress) => {
            res.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`);
          },
          useOutlineMode,
          depth
        );
      }
      
      if (username && typeof username === "string" && username.trim().length >= 2) {
        try {
          const cleanUsername = username.trim().toLowerCase();
          let user = await storage.getUserByUsername(cleanUsername);
          if (!user) {
            user = await storage.createUser({ username: cleanUsername });
          }
          
          await storage.createAnalysisHistory({
            userId: user.id,
            analysisType: "quotes_holistic",
            provider: provider || "openai",
            inputPreview: text.substring(0, 200) + (text.length > 200 ? "..." : ""),
            outputData: result
          });
        } catch (saveError) {
          console.error("Failed to save quotes to history:", saveError);
        }
      }

      // Deduct credits
      if (req.isAuthenticated() && req.user) {
        try {
          const { calculateCreditsForWords } = await import("./services/stripe");
          const outputText = JSON.stringify(result);
          const wordCount = outputText.split(/\s+/).length;
          const creditsUsed = calculateCreditsForWords(provider || "openai", wordCount);
          await storage.deductCredits(req.user.id, creditsUsed);
          res.write(`data: ${JSON.stringify({ type: 'credits', creditsUsed })}\n\n`);
        } catch (creditError) {
          console.error("Failed to deduct credits:", creditError);
        }
      }

      res.write(`data: ${JSON.stringify({ type: 'complete', result })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error("Quote extraction streaming error:", error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    }
  });

  const { extractArgumentsWithOutline, extractArgumentsChunked, formatArgumentsAsMarkdown } = await import("./services/argumentExtractor");

  app.post("/api/arguments/extract/stream", async (req, res) => {
    const { text, provider, username, useOutlineMode = true, author, depth = 7 } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'text' field" });
    }

    if (!author || typeof author !== "string" || author.trim().length < 2) {
      return res.status(400).json({ error: "Author name is required" });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const heartbeatInterval = setInterval(() => {
      res.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeatInterval);
    };

    req.on('close', cleanup);
    req.on('error', cleanup);

    try {
      const clampedDepth = Math.max(1, Math.min(10, Number(depth) || 7));
      let result;
      let markdown;
      
      if (shouldUseCoherentProcessing(text)) {
        const { argumentsCoherent } = await import("./services/coherent/argumentsCoherent");
        const coherentResult = await argumentsCoherent(
          text,
          { author: author.trim(), depth: clampedDepth },
          provider || "openai",
          (progress) => {
            res.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`);
          }
        );
        result = {
          arguments: coherentResult.arguments,
          totalArguments: coherentResult.arguments.length,
          documentId: coherentResult.documentId
        };
        markdown = coherentResult.markdown || formatArgumentsAsMarkdown(coherentResult.arguments);
      } else {
        const extractFn = useOutlineMode ? extractArgumentsWithOutline : extractArgumentsChunked;
        result = await extractFn(
          text, 
          author.trim(),
          provider || "openai",
          (progress) => {
            res.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`);
          },
          clampedDepth
        );
        markdown = formatArgumentsAsMarkdown(result.arguments);
      }
      
      if (username && typeof username === "string" && username.trim().length >= 2) {
        try {
          const cleanUsername = username.trim().toLowerCase();
          let user = await storage.getUserByUsername(cleanUsername);
          if (!user) {
            user = await storage.createUser({ username: cleanUsername });
          }
          
          await storage.createAnalysisHistory({
            userId: user.id,
            analysisType: "arguments",
            provider: provider || "openai",
            inputPreview: text.substring(0, 200) + (text.length > 200 ? "..." : ""),
            outputData: { ...result, markdown }
          });
        } catch (saveError) {
          console.error("Failed to save arguments to history:", saveError);
        }
      }

      // Deduct credits
      if (req.isAuthenticated() && req.user) {
        try {
          const { calculateCreditsForWords } = await import("./services/stripe");
          const outputText = JSON.stringify(result);
          const wordCount = outputText.split(/\s+/).length;
          const creditsUsed = calculateCreditsForWords(provider || "openai", wordCount);
          await storage.deductCredits(req.user.id, creditsUsed);
          res.write(`data: ${JSON.stringify({ type: 'credits', creditsUsed })}\n\n`);
        } catch (creditError) {
          console.error("Failed to deduct credits:", creditError);
        }
      }

      cleanup();
      res.write(`data: ${JSON.stringify({ type: 'complete', result: { ...result, markdown } })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error("Argument extraction streaming error:", error);
      cleanup();
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    }
  });

  const { runCustomAnalysisWithOutline, runCustomAnalysisChunked } = await import("./services/customAnalyzer");

  app.post("/api/custom/analyze/stream", async (req, res) => {
    const { text, provider, username, useOutlineMode = true, instructions, desiredWordCount } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'text' field" });
    }

    if (!instructions || typeof instructions !== "string" || instructions.trim().length < 5) {
      return res.status(400).json({ error: "Instructions are required (at least 5 characters)" });
    }
    
    // Validate desiredWordCount if provided
    const wordCountTarget = desiredWordCount && typeof desiredWordCount === 'number' && desiredWordCount >= 100 
      ? desiredWordCount 
      : undefined;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const heartbeatInterval = setInterval(() => {
      res.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeatInterval);
    };

    req.on('close', cleanup);
    req.on('error', cleanup);

    try {
      let result;
      
      if (shouldUseCoherentProcessing(text)) {
        const { customCoherent } = await import("./services/coherent/customCoherent");
        const coherentResult = await customCoherent(
          text,
          instructions.trim(),
          provider || "openai",
          (progress) => {
            res.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`);
          },
          wordCountTarget
        );
        result = {
          result: coherentResult.result,
          mode: coherentResult.mode,
          documentId: coherentResult.documentId
        };
      } else {
        const analyzeFn = useOutlineMode ? runCustomAnalysisWithOutline : runCustomAnalysisChunked;
        result = await analyzeFn(
          text, 
          instructions.trim(),
          provider || "openai",
          (progress) => {
            res.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`);
          },
          wordCountTarget
        );
      }
      
      if (username && typeof username === "string" && username.trim().length >= 2) {
        try {
          const cleanUsername = username.trim().toLowerCase();
          let user = await storage.getUserByUsername(cleanUsername);
          if (!user) {
            user = await storage.createUser({ username: cleanUsername });
          }
          
          await storage.createAnalysisHistory({
            userId: user.id,
            analysisType: "custom",
            provider: provider || "openai",
            inputPreview: text.substring(0, 200) + (text.length > 200 ? "..." : ""),
            outputData: { ...result, instructions: instructions.trim() }
          });
        } catch (saveError) {
          console.error("Failed to save custom analysis to history:", saveError);
        }
      }

      // Deduct credits
      if (req.isAuthenticated() && req.user) {
        try {
          const { calculateCreditsForWords } = await import("./services/stripe");
          const outputText = JSON.stringify(result);
          const wordCount = outputText.split(/\s+/).length;
          const creditsUsed = calculateCreditsForWords(provider || "openai", wordCount);
          await storage.deductCredits(req.user.id, creditsUsed);
          res.write(`data: ${JSON.stringify({ type: 'credits', creditsUsed })}\n\n`);
        } catch (creditError) {
          console.error("Failed to deduct credits:", creditError);
        }
      }

      cleanup();
      res.write(`data: ${JSON.stringify({ type: 'complete', result })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error("Custom analysis streaming error:", error);
      cleanup();
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    }
  });

  const { generateOutline } = await import("./services/outlineService");

  app.post("/api/outline", async (req, res) => {
    try {
      const { text, username, provider } = req.body;

      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Missing or invalid 'text' field" });
      }

      let result;
      
      if (shouldUseCoherentProcessing(text)) {
        const { outlineCoherent } = await import("./services/coherent/outlineCoherent");
        result = await outlineCoherent(text, provider || "openai");
      } else {
        result = await generateOutline(text);
      }
      
      if (username && typeof username === "string" && username.trim().length >= 2) {
        try {
          const cleanUsername = username.trim().toLowerCase();
          let user = await storage.getUserByUsername(cleanUsername);
          if (!user) {
            user = await storage.createUser({ username: cleanUsername });
          }
          
          await storage.createAnalysisHistory({
            userId: user.id,
            analysisType: "outline",
            provider: provider || "openai",
            inputPreview: text.substring(0, 200) + (text.length > 200 ? "..." : ""),
            outputData: result
          });
        } catch (saveError) {
          console.error("Failed to save outline to history:", saveError);
        }
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("Outline generation error:", error);
      res.status(500).json({ error: error.message || "Outline generation failed" });
    }
  });

  app.post("/api/rewrite/tractatus", async (req, res) => {
    const { text, provider, includeBulletMarkers, useOutlineMode, username, useRAG } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'text' field" });
    }

    const wordCount = text.split(/\s+/).length;
    if (wordCount < 100) {
      return res.status(400).json({ error: "Text too short for Tractatus rewrite (minimum 100 words)" });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const flushResponse = () => {
      try { (res as any).flush?.(); } catch {}
    };

    try {
      const onProgress = (progress: any) => {
        res.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`);
        flushResponse();
      };

      // RAG: Fetch relevant positions if enabled
      let ragContext = null;
      if (useRAG !== false) {
        try {
          const { fetchRelevantPositions } = await import("./services/tractatusRAG");
          onProgress({ stage: "rag", message: "Searching philosophical positions database..." });
          ragContext = await fetchRelevantPositions(text, provider || 'openai', 30);
          if (ragContext.positions.length > 0) {
            onProgress({ 
              stage: "rag", 
              message: `Found ${ragContext.positions.length} relevant positions from ${ragContext.thinkers.length} thinkers` 
            });
          }
        } catch (ragError) {
          console.warn("RAG fetch failed, continuing without:", ragError);
        }
      }

      let result;
      
      // Format RAG context for prompts
      let ragPromptAddition = "";
      if (ragContext && ragContext.positions.length > 0) {
        const { formatPositionsForPrompt } = await import("./services/tractatusRAG");
        ragPromptAddition = formatPositionsForPrompt(ragContext.positions);
      }
      
      if (shouldUseCoherentProcessing(text)) {
        const { tractatusCoherent } = await import("./services/coherent/tractatusCoherent");
        const coherentResult = await tractatusCoherent(
          text,
          { showBullets: includeBulletMarkers, ragContext: ragPromptAddition },
          provider || 'openai',
          onProgress
        );
        result = {
          rewrittenText: coherentResult.rewrittenText,
          statementsCount: coherentResult.rewrittenText.split('\n').filter((l: string) => l.trim()).length,
          documentId: coherentResult.documentId,
          ragPositionsUsed: ragContext?.positions?.length || 0
        };
      } else {
        const { rewriteAsTractatusWithOutline, rewriteAsTractatusSimple } = await import("./services/tractatusRewrite");
        if (useOutlineMode && wordCount > 2000) {
          result = await rewriteAsTractatusWithOutline(text, provider || 'openai', includeBulletMarkers, onProgress, ragPromptAddition);
        } else {
          result = await rewriteAsTractatusSimple(text, provider || 'openai', includeBulletMarkers, onProgress, ragPromptAddition);
        }
        (result as any).ragPositionsUsed = ragContext?.positions?.length || 0;
      }

      res.write(`data: ${JSON.stringify({ type: 'complete', result })}\n\n`);
      flushResponse();

      if (username && typeof username === "string" && username.trim().length >= 2) {
        try {
          const cleanUsername = username.trim().toLowerCase();
          let user = await storage.getUserByUsername(cleanUsername);
          if (!user) {
            user = await storage.createUser({ username: cleanUsername });
          }
          await storage.createAnalysisHistory({
            userId: user.id,
            analysisType: "tractatus_rewrite",
            inputPreview: text.substring(0, 200),
            outputData: { 
              outputPreview: result.rewrittenText.substring(0, 200),
              statementsCount: result.statementsCount, 
              includeBulletMarkers 
            }
          });
        } catch {}
      }
    } catch (error: any) {
      console.error("Tractatus rewrite error:", error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message || 'Rewrite failed' })}\n\n`);
      flushResponse();
    } finally {
      res.end();
    }
  });

  app.post("/api/tractatus-tree", async (req, res) => {
    const { text, provider, username } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'text' field" });
    }

    const wordCount = text.split(/\s+/).length;
    if (wordCount < 100) {
      return res.status(400).json({ error: "Text too short for Tractatus Tree (minimum 100 words)" });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      const { generateTractatusTree } = await import("./services/tractatusTree");
      
      const result = await generateTractatusTree(
        text,
        provider || 'openai',
        (progress) => {
          res.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`);
        }
      );

      res.write(`data: ${JSON.stringify({ type: 'complete', result })}\n\n`);

      if (username && typeof username === "string" && username.trim().length >= 2) {
        try {
          const cleanUsername = username.trim().toLowerCase();
          let user = await storage.getUserByUsername(cleanUsername);
          if (!user) {
            user = await storage.createUser({ username: cleanUsername });
          }
          await storage.createAnalysisHistory({
            userId: user.id,
            analysisType: "tractatus_tree",
            inputPreview: text.substring(0, 200),
            outputData: { 
              maxDepth: result.maxDepth,
              totalStatements: result.totalStatements,
              columnCount: result.columns.length
            }
          });
        } catch {}
      }
    } catch (error: any) {
      console.error("Tractatus Tree error:", error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message || 'Generation failed' })}\n\n`);
    } finally {
      res.end();
    }
  });

  app.post("/api/summary", async (req, res) => {
    const { text, resolution, recognizeContentSections, provider } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'text' field" });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      const selectedProvider = provider || "grok";
      const resolutionLevel = typeof resolution === 'number' ? resolution : 0;
      const recognizeContent = recognizeContentSections === true;

      res.write(`data: ${JSON.stringify({ type: 'progress', current: 0, total: 5, message: 'Starting summary generation...' })}\n\n`);

      const { generateStructuredSummary } = await import('./services/summaryService');
      
      const result = await generateStructuredSummary(
        text,
        resolutionLevel,
        recognizeContent,
        selectedProvider,
        (progress) => {
          res.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`);
        }
      );

      res.write(`data: ${JSON.stringify({ type: 'complete', result })}\n\n`);
    } catch (error: any) {
      console.error("Summary error:", error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message || 'Summary generation failed' })}\n\n`);
    } finally {
      res.end();
    }
  });

  app.post("/api/rewrite/full", async (req, res) => {
    const { text, outline, instructions, username, provider } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'text' field" });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      let fullRewrite = "";
      
      if (shouldUseCoherentProcessing(text)) {
        const { fullRewriteCoherent } = await import("./services/coherent/fullRewriteCoherent");
        const coherentResult = await fullRewriteCoherent(
          text,
          instructions || 'Improve clarity and flow while preserving all content',
          provider || 'openai',
          (progress) => {
            if (progress.content) {
              fullRewrite += progress.content;
              res.write(`data: ${JSON.stringify({ type: 'content', content: progress.content })}\n\n`);
            }
            res.write(`data: ${JSON.stringify({ 
              type: 'progress', 
              current: progress.current,
              total: progress.total,
              message: progress.message 
            })}\n\n`);
          }
        );
        fullRewrite = coherentResult.rewrittenText;
        res.write(`data: ${JSON.stringify({ type: 'complete', result: fullRewrite })}\n\n`);
        res.end();
        return;
      } else {
        if (!outline || !outline.sections || !Array.isArray(outline.sections) || outline.sections.length === 0) {
          res.write(`data: ${JSON.stringify({ type: 'error', error: 'Missing outline for small document rewrite' })}\n\n`);
          res.end();
          return;
        }
        
        const sections = outline.sections;
        const totalSections = sections.length;

        for (let i = 0; i < totalSections; i++) {
          const section = sections[i];
          res.write(`data: ${JSON.stringify({ 
            type: 'progress', 
            current: i + 1, 
            total: totalSections, 
            message: `Rewriting section ${i + 1}/${totalSections}: "${section.title}"...` 
          })}\n\n`);

          const sectionPrompt = `You are an expert rewriter. Follow the user's instructions exactly. Preserve all key positions, details, and meaning while improving clarity, flow, and structure.

Rewrite this section of the document.

SECTION: "${section.title}"
DESCRIPTION: ${section.description || 'N/A'}
KEY THEMES: ${section.keyThemes?.join(', ') || 'N/A'}

USER INSTRUCTIONS: ${instructions || 'Improve clarity and flow while preserving all content'}

FULL DOCUMENT CONTEXT (for reference):
"""
${text.substring(0, 40000)}
"""

OUTLINE FOR STRUCTURE:
${JSON.stringify(outline, null, 2)}

Write ONLY the rewritten content for this section "${section.title}". Do not include section headers or labels. Output clean prose only.`;

          try {
            const sectionContent = await callLLM("openai", sectionPrompt);
            fullRewrite += `\n\n## ${section.title}\n\n${sectionContent}`;
            res.write(`data: ${JSON.stringify({ type: 'content', content: `\n\n## ${section.title}\n\n${sectionContent}` })}\n\n`);
          } catch (sectionError: any) {
            console.error(`Failed to rewrite section "${section.title}":`, sectionError);
            res.write(`data: ${JSON.stringify({ type: 'content', content: `\n\n## ${section.title}\n\n[Rewrite failed: ${sectionError.message || 'Unknown error'}]` })}\n\n`);
          }

          if (i < totalSections - 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
      }

      if (username && typeof username === "string" && username.trim().length >= 2) {
        try {
          const cleanUsername = username.trim().toLowerCase();
          let user = await storage.getUserByUsername(cleanUsername);
          if (!user) {
            user = await storage.createUser({ username: cleanUsername });
          }
          
          await storage.createAnalysisHistory({
            userId: user.id,
            analysisType: "full_rewrite",
            provider: provider || "openai",
            inputPreview: text.substring(0, 200) + (text.length > 200 ? "..." : ""),
            outputData: { rewrittenDocument: fullRewrite, instructions, outline }
          });
        } catch (saveError) {
          console.error("Failed to save rewrite to history:", saveError);
        }
      }

      res.write(`data: ${JSON.stringify({ type: 'complete', result: fullRewrite })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error("Full rewrite error:", error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    }
  });

  // Write From Scratch - generate a document from a prompt using coherent processing
  app.post("/api/write-from-scratch", async (req, res) => {
    const { prompt, targetWords, provider, username } = req.body;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'prompt' field" });
    }

    const wordTarget = Math.min(Math.max(parseInt(targetWords) || 5000, 1000), 50000);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const { writeFromScratchCoherent } = await import("./services/coherent/writeFromScratchCoherent");
      let generatedText = "";

      const result = await writeFromScratchCoherent(
        prompt,
        wordTarget,
        provider || 'openai',
        (progress) => {
          if (progress.content) {
            generatedText += progress.content;
            res.write(`data: ${JSON.stringify({ type: 'content', content: progress.content })}\n\n`);
          }
          res.write(`data: ${JSON.stringify({ 
            type: 'progress', 
            current: progress.current,
            total: progress.total,
            message: progress.message,
            phase: progress.phase
          })}\n\n`);
        }
      );

      // Save to history if username provided
      if (username && typeof username === "string" && username.trim().length >= 2) {
        try {
          const cleanUsername = username.trim().toLowerCase();
          let user = await storage.getUserByUsername(cleanUsername);
          if (!user) {
            user = await storage.createUser({ username: cleanUsername });
          }
          await storage.createAnalysisHistory({
            userId: user.id,
            analysisType: "write_from_scratch",
            provider: provider || "openai",
            inputPreview: prompt.substring(0, 200) + (prompt.length > 200 ? "..." : ""),
            outputData: { 
              generatedText: result.generatedText, 
              wordCount: result.wordCount,
              mode: result.mode,
              prompt
            }
          });
        } catch (saveError) {
          console.error("Failed to save generated document to history:", saveError);
        }
      }

      res.write(`data: ${JSON.stringify({ 
        type: 'complete', 
        result: result.generatedText,
        wordCount: result.wordCount,
        mode: result.mode
      })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error("Write from scratch error:", error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    }
  });

  // Refine output - takes existing output and refines it with new instructions
  app.post("/api/refine-output", async (req, res) => {
    const { currentOutput, refineInstructions, outputType, provider, username } = req.body;

    if (!currentOutput || typeof currentOutput !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'currentOutput' field" });
    }

    if (!refineInstructions || typeof refineInstructions !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'refineInstructions' field" });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const wordCount = currentOutput.split(/\s+/).length;
      
      res.write(`data: ${JSON.stringify({ type: 'progress', stage: 'refining', message: 'Processing your refinement instructions...' })}\n\n`);

      const prompt = `You are refining an existing document based on user feedback.

CURRENT OUTPUT (${wordCount} words):
${currentOutput}

USER'S REFINEMENT INSTRUCTIONS:
${refineInstructions}

TASK:
1. Carefully apply the user's refinement instructions to the current output
2. Maintain the overall structure and length unless the instructions explicitly ask otherwise
3. Preserve any content not explicitly mentioned in the refinement instructions
4. If the user asks to add more quotes, add relevant quotes that fit naturally
5. If the user asks to expand on topics, elaborate while maintaining coherence
6. Output ONLY the refined document - no explanations, no meta-commentary

Output the refined document now:`;

      const refinedOutput = await callLLM(provider || "openai", prompt);

      res.write(`data: ${JSON.stringify({ type: 'content', content: refinedOutput })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'complete', result: refinedOutput })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error("Refine output error:", error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    }
  });

  // ============ PHILOSOPHICAL POSITIONS API ============
  
  // Get all positions with optional filtering
  app.get("/api/positions", async (req, res) => {
    try {
      const { topic, thinker, search } = req.query;
      let positions;
      
      if (search && typeof search === "string") {
        positions = await storage.searchPhilosophicalPositions(search);
      } else if (topic && typeof topic === "string") {
        positions = await storage.getPhilosophicalPositionsByTopic(topic);
      } else if (thinker && typeof thinker === "string") {
        positions = await storage.getPhilosophicalPositionsByThinker(thinker);
      } else {
        positions = await storage.getAllPhilosophicalPositions();
      }
      
      res.json({ positions, count: positions.length });
    } catch (error: any) {
      console.error("Error fetching positions:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Batch insert positions
  app.post("/api/positions/batch", async (req, res) => {
    try {
      const { positions } = req.body;
      
      if (!Array.isArray(positions)) {
        return res.status(400).json({ error: "positions must be an array" });
      }
      
      const { insertPhilosophicalPositionSchema } = await import("@shared/schema");
      const validPositions = [];
      const errors: { index: number; error: string }[] = [];
      
      for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        const result = insertPhilosophicalPositionSchema.safeParse({
          thinker: pos.thinker?.trim?.() || pos.thinker,
          statement: pos.statement?.trim?.() || pos.statement,
          topic: pos.topic?.trim?.() || pos.topic,
          source: pos.source?.trim?.() || pos.source || null,
          era: pos.era?.trim?.() || pos.era || null,
          keywords: pos.keywords ? String(pos.keywords).trim() : null,
          embedding: null
        });
        
        if (result.success) {
          validPositions.push(result.data);
        } else {
          errors.push({ index: i, error: result.error.errors[0]?.message || "Validation failed" });
        }
      }
      
      if (validPositions.length === 0) {
        return res.status(400).json({ 
          error: "No valid positions found. Each position requires: thinker, statement, topic",
          validationErrors: errors.slice(0, 5)
        });
      }
      
      const created = await storage.batchCreatePhilosophicalPositions(validPositions);
      res.json({ 
        success: true, 
        inserted: created.length,
        skipped: positions.length - validPositions.length,
        validationErrors: errors.length > 0 ? errors.slice(0, 10) : undefined,
        positions: created 
      });
    } catch (error: any) {
      console.error("Error batch inserting positions:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Delete a position
  app.delete("/api/positions/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid position ID" });
      }
      
      const deleted = await storage.deletePhilosophicalPosition(id);
      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Position not found" });
      }
    } catch (error: any) {
      console.error("Error deleting position:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username } = req.body;

      if (!username || typeof username !== "string" || username.trim().length < 2) {
        return res.status(400).json({ 
          error: "Username must be at least 2 characters" 
        });
      }

      const cleanUsername = username.trim().toLowerCase();
      
      let user = await storage.getUserByUsername(cleanUsername);
      
      if (!user) {
        user = await storage.createUser({ username: cleanUsername });
      }
      
      res.json({ 
        success: true, 
        user: { id: user.id, username: user.username } 
      });
    } catch (error: any) {
      console.error("Login error:", error);
      res.status(500).json({ 
        error: error.message || "Login failed" 
      });
    }
  });

  app.post("/api/stylometrics/analyze", async (req, res) => {
    try {
      const { username, authorName, sourceTitle, text, provider } = req.body;

      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Missing text" });
      }

      if (!authorName || typeof authorName !== "string") {
        return res.status(400).json({ error: "Missing author name" });
      }

      const wordCount = text.split(/\s+/).filter(Boolean).length;
      if (wordCount < 400) {
        return res.status(400).json({ 
          error: `Text too short: ${wordCount} words. Minimum 400 words required.` 
        });
      }

      const rawFeatures = computeRawFeatures(text);
      const prompt = buildSingleTextPrompt(authorName, sourceTitle || '', text, rawFeatures);
      
      const llmResponse = await callLLM(provider || 'grok', prompt);
      
      let llmResult;
      try {
        const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          llmResult = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON found in response");
        }
      } catch (e) {
        console.error("Failed to parse LLM response:", e);
        llmResult = {
          metaphorDensity: 'moderate',
          anecdoteFrequency: 'occasional',
          signaturePhrases: [],
          negativeMarkers: [],
          sampleSentences: [],
          psychologicalProfile: {},
          narrativeSummary: "Analysis could not be completed.",
          clustering: { veryCloseTo: [], moderatelyCloseTo: [], farFrom: [] }
        };
      }

      const verticalityScore = computeVerticalityScore(
        rawFeatures, 
        llmResult.metaphorDensity, 
        llmResult.anecdoteFrequency
      );
      llmResult.verticalityScore = verticalityScore;
      
      const abstraction = getAbstractionLevel(verticalityScore);
      llmResult.abstractionLevel = abstraction.level;
      llmResult.abstractionDescription = abstraction.description;

      const fullReport = formatSingleTextReport(authorName, sourceTitle || '', rawFeatures, llmResult);

      const responseData = {
        success: true,
        report: fullReport,
        data: {
          authorName,
          sourceTitle,
          wordCount: rawFeatures.wordCount,
          verticalityScore,
          abstractionLevel: abstraction.level,
          rawFeatures,
          ...llmResult
        }
      };

      // Auto-save to history if user is logged in
      if (username && typeof username === "string" && username.trim().length >= 2) {
        try {
          const cleanUsername = username.trim().toLowerCase();
          let user = await storage.getUserByUsername(cleanUsername);
          if (!user) {
            user = await storage.createUser({ username: cleanUsername });
          }
          
          const inputPreview = `Stylometrics: ${authorName} - ${text.substring(0, 150)}...`;
          
          await storage.createAnalysisHistory({
            userId: user.id,
            analysisType: "stylometrics",
            provider: provider || "grok",
            inputPreview: inputPreview,
            outputData: responseData.data
          });
        } catch (saveError) {
          console.error("Failed to save stylometrics to history:", saveError);
        }
      }

      res.json(responseData);
    } catch (error: any) {
      console.error("Stylometrics analysis error:", error);
      res.status(500).json({ 
        error: error.message || "Stylometric analysis failed" 
      });
    }
  });

  app.post("/api/stylometrics/analyze/stream", async (req, res) => {
    try {
      const { username, authorName, sourceTitle, text, provider } = req.body;

      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Missing text" });
      }

      if (!authorName || typeof authorName !== "string") {
        return res.status(400).json({ error: "Missing author name" });
      }

      const wordCount = text.split(/\s+/).filter(Boolean).length;
      if (wordCount < 400) {
        return res.status(400).json({ 
          error: `Text too short: ${wordCount} words. Minimum 400 words required.` 
        });
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      const rawFeatures = computeRawFeatures(text);
      
      res.write(`data: ${JSON.stringify({ 
        type: 'features', 
        rawFeatures,
        message: 'Computing stylometric features...' 
      })}\n\n`);

      const prompt = buildSingleTextPrompt(authorName, sourceTitle || '', text, rawFeatures);
      
      const llmResponse = await callLLM(provider || 'grok', prompt);
      
      for (let i = 0; i < llmResponse.length; i += 100) {
        const chunk = llmResponse.slice(i, i + 100);
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      let llmResult;
      try {
        const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          llmResult = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON found");
        }
      } catch (e) {
        llmResult = {
          metaphorDensity: 'moderate',
          anecdoteFrequency: 'occasional',
          signaturePhrases: [],
          negativeMarkers: [],
          sampleSentences: [],
          psychologicalProfile: {},
          narrativeSummary: "Analysis could not be completed.",
          clustering: { veryCloseTo: [], moderatelyCloseTo: [], farFrom: [] }
        };
      }

      const verticalityScore = computeVerticalityScore(
        rawFeatures, 
        llmResult.metaphorDensity, 
        llmResult.anecdoteFrequency
      );
      llmResult.verticalityScore = verticalityScore;
      
      const abstraction = getAbstractionLevel(verticalityScore);
      llmResult.abstractionLevel = abstraction.level;
      llmResult.abstractionDescription = abstraction.description;

      const fullReport = formatSingleTextReport(authorName, sourceTitle || '', rawFeatures, llmResult);

      res.write(`data: ${JSON.stringify({ 
        type: 'complete',
        report: fullReport,
        data: {
          authorName,
          sourceTitle,
          wordCount: rawFeatures.wordCount,
          verticalityScore,
          abstractionLevel: abstraction.level,
          abstractionDescription: abstraction.description,
          rawFeatures,
          metaphorDensity: llmResult.metaphorDensity,
          anecdoteFrequency: llmResult.anecdoteFrequency,
          signaturePhrases: llmResult.signaturePhrases,
          negativeMarkers: llmResult.negativeMarkers,
          sampleSentences: llmResult.sampleSentences,
          closestAuthorMatch: llmResult.closestAuthorMatch,
          matchExplanation: llmResult.matchExplanation,
          psychologicalProfile: llmResult.psychologicalProfile,
          narrativeSummary: llmResult.narrativeSummary,
          clustering: llmResult.clustering
        }
      })}\n\n`);

      // Deduct credits
      if (req.isAuthenticated() && req.user) {
        try {
          const { calculateCreditsForWords } = await import("./services/stripe");
          const outputWordCount = fullReport.split(/\s+/).length;
          const creditsUsed = calculateCreditsForWords(provider || "grok", outputWordCount);
          await storage.deductCredits(req.user.id, creditsUsed);
          res.write(`data: ${JSON.stringify({ type: 'credits', creditsUsed })}\n\n`);
        } catch (creditError) {
          console.error("Failed to deduct credits:", creditError);
        }
      }

      res.end();
    } catch (error: any) {
      console.error("Stylometrics streaming error:", error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    }
  });

  app.post("/api/stylometrics/compare", async (req, res) => {
    try {
      const { username, textA, textB, provider } = req.body;

      if (!textA?.text || !textA?.authorName) {
        return res.status(400).json({ error: "Missing Text A" });
      }

      if (!textB?.text || !textB?.authorName) {
        return res.status(400).json({ error: "Missing Text B" });
      }

      const wordCountA = textA.text.split(/\s+/).filter(Boolean).length;
      const wordCountB = textB.text.split(/\s+/).filter(Boolean).length;
      
      if (wordCountA < 400 || wordCountB < 400) {
        return res.status(400).json({ 
          error: `Texts too short. Text A: ${wordCountA} words, Text B: ${wordCountB} words. Minimum 400 words each.` 
        });
      }

      const rawFeaturesA = computeRawFeatures(textA.text);
      const rawFeaturesB = computeRawFeatures(textB.text);

      const prompt = buildComparisonPrompt(
        { authorName: textA.authorName, text: textA.text, rawFeatures: rawFeaturesA },
        { authorName: textB.authorName, text: textB.text, rawFeatures: rawFeaturesB }
      );

      const llmResponse = await callLLM(provider || 'grok', prompt);
      
      let llmResult;
      try {
        const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          llmResult = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON found");
        }
      } catch (e) {
        console.error("Failed to parse comparison response:", e);
        llmResult = {
          textA: { metaphorDensity: 'moderate', anecdoteFrequency: 'occasional' },
          textB: { metaphorDensity: 'moderate', anecdoteFrequency: 'occasional' },
          comparison: { keyDivergences: [], sameRoomScenario: '', collaborativePotential: '' },
          verdict: 'Comparison could not be completed.'
        };
      }

      if (llmResult.textA) {
        const scoreA = computeVerticalityScore(rawFeaturesA, llmResult.textA.metaphorDensity, llmResult.textA.anecdoteFrequency);
        llmResult.textA.verticalityScore = scoreA;
        const absA = getAbstractionLevel(scoreA);
        llmResult.textA.abstractionLevel = absA.level;
        llmResult.textA.abstractionDescription = absA.description;
      }
      
      if (llmResult.textB) {
        const scoreB = computeVerticalityScore(rawFeaturesB, llmResult.textB.metaphorDensity, llmResult.textB.anecdoteFrequency);
        llmResult.textB.verticalityScore = scoreB;
        const absB = getAbstractionLevel(scoreB);
        llmResult.textB.abstractionLevel = absB.level;
        llmResult.textB.abstractionDescription = absB.description;
      }

      if (llmResult.comparison) {
        llmResult.comparison.verticalityDifference = Math.abs(
          (llmResult.textA?.verticalityScore || 0) - (llmResult.textB?.verticalityScore || 0)
        );
      }

      const fullReport = formatComparisonReport(
        { authorName: textA.authorName, rawFeatures: rawFeaturesA },
        { authorName: textB.authorName, rawFeatures: rawFeaturesB },
        llmResult
      );

      const responseData = {
        success: true,
        report: fullReport,
        data: llmResult
      };

      // Auto-save to history if user is logged in
      if (username && typeof username === "string" && username.trim().length >= 2) {
        try {
          const cleanUsername = username.trim().toLowerCase();
          let user = await storage.getUserByUsername(cleanUsername);
          if (!user) {
            user = await storage.createUser({ username: cleanUsername });
          }
          
          const inputPreview = `Stylometrics Compare: ${textA.authorName} vs ${textB.authorName}`;
          
          await storage.createAnalysisHistory({
            userId: user.id,
            analysisType: "stylometrics_compare",
            provider: provider || "grok",
            inputPreview: inputPreview,
            outputData: responseData.data
          });
        } catch (saveError) {
          console.error("Failed to save stylometrics comparison to history:", saveError);
        }
      }

      res.json(responseData);
    } catch (error: any) {
      console.error("Comparison error:", error);
      res.status(500).json({ 
        error: error.message || "Comparison failed" 
      });
    }
  });

  // Holistic Stylometrics Analysis with SSE streaming (uses outline mode)
  app.post("/api/stylometrics/holistic/stream", async (req, res) => {
    const { analyzeStylometricsHolistic, compareStylometricsHolistic } = await import("./services/stylometricsHolistic");
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let aborted = false;
    let heartbeatInterval: NodeJS.Timeout | null = null;

    const cleanup = () => {
      aborted = true;
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    };

    req.on('close', cleanup);
    req.on('aborted', cleanup);

    heartbeatInterval = setInterval(() => {
      if (!aborted) {
        try {
          res.write(': ping\n\n');
        } catch {}
      }
    }, 15000);

    try {
      const { username, authorName, authorNameB, text, textB, provider, mode } = req.body;

      if (!text || typeof text !== "string") {
        res.write(`data: ${JSON.stringify({ type: 'error', error: "Missing or invalid 'text' field" })}\n\n`);
        cleanup();
        res.end();
        return;
      }

      if (!authorName || typeof authorName !== "string") {
        res.write(`data: ${JSON.stringify({ type: 'error', error: "Missing or invalid 'authorName' field" })}\n\n`);
        cleanup();
        res.end();
        return;
      }

      const wordCount = text.split(/\s+/).filter(Boolean).length;
      if (wordCount < 400) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: `Text too short: ${wordCount} words. Minimum 400 words required.` })}\n\n`);
        cleanup();
        res.end();
        return;
      }

      let result: any;

      if (mode === 'compare') {
        if (!textB || typeof textB !== "string") {
          res.write(`data: ${JSON.stringify({ type: 'error', error: "Missing Text B for comparison" })}\n\n`);
          cleanup();
          res.end();
          return;
        }

        result = await compareStylometricsHolistic(
          text,
          textB,
          provider || 'grok',
          authorName,
          authorNameB || 'Unknown B',
          (progress) => {
            if (!aborted) {
              try {
                res.write(`data: ${JSON.stringify({ type: 'progress', progress })}\n\n`);
              } catch {}
            }
          }
        );

        if (aborted) {
          cleanup();
          return;
        }

        res.write(`data: ${JSON.stringify({ type: 'result', result, mode: 'compare' })}\n\n`);

        if (username && typeof username === "string" && username.trim().length >= 2) {
          try {
            const cleanUsername = username.trim().toLowerCase();
            let user = await storage.getUserByUsername(cleanUsername);
            if (!user) {
              user = await storage.createUser({ username: cleanUsername });
            }
            
            await storage.createAnalysisHistory({
              userId: user.id,
              analysisType: "stylometrics_holistic_compare",
              provider: provider || "grok",
              inputPreview: `Holistic: ${authorName} vs ${authorNameB}`,
              outputData: result
            });
          } catch (saveError) {
            console.error("Failed to save to history:", saveError);
          }
        }
      } else {
        result = await analyzeStylometricsHolistic(
          text,
          provider || 'grok',
          authorName,
          (progress) => {
            if (!aborted) {
              try {
                res.write(`data: ${JSON.stringify({ type: 'progress', progress })}\n\n`);
              } catch {}
            }
          }
        );

        if (aborted) {
          cleanup();
          return;
        }

        res.write(`data: ${JSON.stringify({ type: 'result', result, mode: 'single' })}\n\n`);

        if (username && typeof username === "string" && username.trim().length >= 2) {
          try {
            const cleanUsername = username.trim().toLowerCase();
            let user = await storage.getUserByUsername(cleanUsername);
            if (!user) {
              user = await storage.createUser({ username: cleanUsername });
            }
            
            await storage.createAnalysisHistory({
              userId: user.id,
              analysisType: "stylometrics_holistic",
              provider: provider || "grok",
              inputPreview: `Holistic: ${authorName} - ${text.substring(0, 150)}...`,
              outputData: result
            });
          } catch (saveError) {
            console.error("Failed to save to history:", saveError);
          }
        }
      }

      // Deduct credits
      if (req.isAuthenticated() && req.user) {
        try {
          const { calculateCreditsForWords } = await import("./services/stripe");
          const outputText = JSON.stringify(result);
          const outputWordCount = outputText.split(/\s+/).length;
          const creditsUsed = calculateCreditsForWords(provider || "grok", outputWordCount);
          await storage.deductCredits(req.user.id, creditsUsed);
          res.write(`data: ${JSON.stringify({ type: 'credits', creditsUsed })}\n\n`);
        } catch (creditError) {
          console.error("Failed to deduct credits:", creditError);
        }
      }

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      cleanup();
      res.end();
    } catch (error: any) {
      console.error("Holistic stylometrics error:", error);
      if (!aborted) {
        try {
          res.write(`data: ${JSON.stringify({ type: 'error', error: error.message || "Analysis failed" })}\n\n`);
        } catch {}
      }
      cleanup();
      res.end();
    }
  });

  app.post("/api/stylometrics/save", async (req, res) => {
    try {
      const { username, authorName, sourceTitle, data, fullReport } = req.body;

      if (!username || typeof username !== "string" || username.trim().length < 2) {
        return res.status(401).json({ error: "Login required to save profiles" });
      }

      if (!authorName || typeof authorName !== "string" || authorName.trim().length === 0) {
        return res.status(400).json({ error: "Author name required" });
      }

      const cleanUsername = username.trim().toLowerCase();
      let user = await storage.getUserByUsername(cleanUsername);
      if (!user) {
        user = await storage.createUser({ username: cleanUsername });
      }

      const existingAuthor = await storage.getStylometricAuthorByName(user.id, authorName.trim());
      
      const authorData = {
        userId: user.id,
        authorName,
        sourceTitle: sourceTitle || null,
        wordCount: data?.wordCount || null,
        verticalityScore: data?.verticalityScore?.toString() || null,
        rawFeatures: data?.rawFeatures || null,
        signaturePhrases: data?.signaturePhrases || null,
        negativeMarkers: data?.negativeMarkers || null,
        sampleSentences: data?.sampleSentences || null,
        closestAuthorMatch: data?.closestAuthorMatch || null,
        matchExplanation: data?.matchExplanation || null,
        psychologicalProfile: data?.psychologicalProfile || null,
        narrativeSummary: data?.narrativeSummary || null,
        clustering: data?.clustering || null,
        fullReport: fullReport || null
      };

      let savedAuthor;
      if (existingAuthor) {
        savedAuthor = await storage.updateStylometricAuthor(existingAuthor.id, authorData);
      } else {
        savedAuthor = await storage.createStylometricAuthor(authorData);
      }

      res.json({
        success: true,
        message: existingAuthor ? 'Author profile updated' : 'Author profile saved',
        author: savedAuthor
      });
    } catch (error: any) {
      console.error("Save error:", error);
      res.status(500).json({ 
        error: error.message || "Failed to save author" 
      });
    }
  });

  app.get("/api/stylometrics/authors", async (req, res) => {
    try {
      const { username } = req.query;

      if (!username || typeof username !== "string") {
        return res.status(400).json({ error: "Username required" });
      }

      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.json({ authors: [] });
      }

      const authors = await storage.getStylometricAuthors(user.id);
      res.json({ authors });
    } catch (error: any) {
      console.error("Get authors error:", error);
      res.status(500).json({ 
        error: error.message || "Failed to get authors" 
      });
    }
  });

  app.get("/api/stylometrics/author/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const author = await storage.getStylometricAuthor(parseInt(id));
      
      if (!author) {
        return res.status(404).json({ error: "Author not found" });
      }

      res.json({ author });
    } catch (error: any) {
      console.error("Get author error:", error);
      res.status(500).json({ 
        error: error.message || "Failed to get author" 
      });
    }
  });

  app.delete("/api/stylometrics/author/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteStylometricAuthor(parseInt(id));
      res.json({ success: true, message: "Author deleted" });
    } catch (error: any) {
      console.error("Delete error:", error);
      res.status(500).json({ 
        error: error.message || "Failed to delete author" 
      });
    }
  });

  app.get("/api/stylometrics/export", async (req, res) => {
    try {
      const { username } = req.query;

      if (!username || typeof username !== "string") {
        return res.status(400).json({ error: "Username required" });
      }

      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.json({ authors: [] });
      }

      const authors = await storage.getStylometricAuthors(user.id);
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="stylometric-database-${username}.json"`);
      res.json({
        exportedAt: new Date().toISOString(),
        username,
        authorCount: authors.length,
        authors
      });
    } catch (error: any) {
      console.error("Export error:", error);
      res.status(500).json({ 
        error: error.message || "Export failed" 
      });
    }
  });

  // History API endpoints
  
  // Save partial results from multi-chunk processing
  app.post("/api/history/save-partial", async (req, res) => {
    try {
      const { username, analysisType, provider, inputPreview, outputData, chunksCompleted, totalChunks } = req.body;
      
      if (!username || typeof username !== "string") {
        return res.status(400).json({ error: "Username required" });
      }
      
      const cleanUsername = username.trim().toLowerCase();
      let user = await storage.getUserByUsername(cleanUsername);
      if (!user) {
        user = await storage.createUser({ username: cleanUsername });
      }
      
      // Add chunk progress info to the output
      const enrichedOutput = {
        ...outputData,
        _chunkProgress: {
          completed: chunksCompleted,
          total: totalChunks,
          partial: chunksCompleted < totalChunks
        }
      };
      
      await storage.createAnalysisHistory({
        userId: user.id,
        analysisType,
        provider,
        inputPreview: `[${chunksCompleted}/${totalChunks} chunks] ${inputPreview}`,
        outputData: enrichedOutput
      });
      
      res.json({ success: true, message: `Saved results for ${chunksCompleted}/${totalChunks} chunks` });
    } catch (error: any) {
      console.error("Save partial results error:", error);
      res.status(500).json({ error: error.message || "Failed to save partial results" });
    }
  });
  
  app.get("/api/history", async (req, res) => {
    try {
      const { username, type } = req.query;

      if (!username || typeof username !== "string") {
        return res.status(400).json({ error: "Username required" });
      }

      const user = await storage.getUserByUsername(username.trim().toLowerCase());
      if (!user) {
        return res.json({ history: [] });
      }

      let history;
      if (type && typeof type === "string") {
        history = await storage.getAnalysisHistoryByType(user.id, type);
      } else {
        history = await storage.getAnalysisHistory(user.id);
      }

      res.json({ history });
    } catch (error: any) {
      console.error("Get history error:", error);
      res.status(500).json({ 
        error: error.message || "Failed to get history" 
      });
    }
  });

  app.get("/api/history/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { username } = req.query;
      
      if (!username || typeof username !== "string") {
        return res.status(401).json({ error: "Login required" });
      }
      
      const user = await storage.getUserByUsername(username.trim().toLowerCase());
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      
      const item = await storage.getAnalysisHistoryItem(parseInt(id));
      
      if (!item) {
        return res.status(404).json({ error: "History item not found" });
      }
      
      // Verify ownership
      if (item.userId !== user.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json({ item });
    } catch (error: any) {
      console.error("Get history item error:", error);
      res.status(500).json({ 
        error: error.message || "Failed to get history item" 
      });
    }
  });

  app.delete("/api/history/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { username } = req.query;
      
      if (!username || typeof username !== "string") {
        return res.status(401).json({ error: "Login required" });
      }
      
      const user = await storage.getUserByUsername(username.trim().toLowerCase());
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      
      const item = await storage.getAnalysisHistoryItem(parseInt(id));
      
      if (!item) {
        return res.status(404).json({ error: "History item not found" });
      }
      
      // Verify ownership
      if (item.userId !== user.id) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      await storage.deleteAnalysisHistoryItem(parseInt(id));
      res.json({ success: true, message: "History item deleted" });
    } catch (error: any) {
      console.error("Delete history error:", error);
      res.status(500).json({ 
        error: error.message || "Failed to delete history item" 
      });
    }
  });

  app.post("/api/intelligence", async (req, res) => {
    try {
      const { text, provider, username } = req.body;

      if (!text || typeof text !== "string") {
        return res.status(400).json({ 
          error: "Missing or invalid 'text' field in request body" 
        });
      }

      if (!provider || typeof provider !== "string") {
        return res.status(400).json({ 
          error: "Missing or invalid 'provider' field in request body" 
        });
      }

      const wordCount = text.split(/\s+/).filter(Boolean).length;
      
      const prompt = `You are an expert at identifying sharp, quotable insights. Extract ALL the genuinely sharp lines from this text. Be thorough — a well-written text can contain dozens of sharp quotes.

WHAT COUNTS AS SHARP (extract liberally):
- Punchy formulations: "Religions are degenerate cults." "All worship is projection."
- Reversals that reframe: "Thoughts are taught by being elicited, not by being deposited."
- Precise distinctions: "Superhuman is not supernatural."
- Dark wit: "The people who should commit suicide don't."
- Compressed insights: "Projection is unconscious LARPing."
- Memorable metaphors: "His categories don't cut nature at the joints."
- Paradoxes stated sharply: "The lower you are in a hierarchy, the more fiercely you will defend it."

WHAT DOES NOT COUNT (reject these):
- Dissertation/abstract framing: "In this dissertation, I critically examine..."
- Signposting: "This chapter is divided into five parts..."
- Bland scholarly prose: "I argue that McDowell's direct realism is problematic."
- Promises without payoff: "By answering the question X, philosopher Y reveals Z..."
- Throat-clearing: "It is important to consider..."

CALIBRATION - SHARP TEXT (extract many quotes):
"To worship something is to regard it as supernatural. If you worship it, it's a fiction. All worship is projection. Projection is unconscious LARPing. A cult leader is someone on whom people believe they can project a great fiction."
→ Extract ALL of these: each is a standalone insight.

CALIBRATION - BLAND TEXT (extract zero):  
"In this dissertation, I critically examine the philosophy of transcendental empiricism. I argue that Gaskin's critiques are faulty and that Gaskin's minimalist empiricism is very dubious."
→ Extract ZERO. This is academic framing, not insight.

Be generous with genuinely sharp writing. A good essay might have 20-50 sharp quotes. Only reject text that is genuinely bland, transitional, or merely descriptive.

TEXT TO ANALYZE:
${text}

Respond with valid JSON only:
{
  "sharpQuotes": ["quote1", "quote2", ...],
  "analysis": "Brief explanation of why these quotes are sharp (or why none were found)"
}`;

      const result = await callLLM(provider, prompt);
      
      let parsed;
      try {
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          parsed = { sharpQuotes: [], analysis: "Failed to parse response" };
        }
      } catch {
        parsed = { sharpQuotes: [], analysis: "Failed to parse response" };
      }

      const sharpQuotes = Array.isArray(parsed.sharpQuotes) ? parsed.sharpQuotes.filter((q: any) => typeof q === 'string' && q.trim()) : [];
      const density = wordCount > 0 ? (sharpQuotes.length * 1000) / wordCount : 0;
      
      let score: number;
      if (density <= 1) {
        score = Math.round(density * 30);
      } else if (density <= 3) {
        score = Math.round(30 + ((density - 1) / 2) * 35);
      } else if (density <= 6) {
        score = Math.round(65 + ((density - 3) / 3) * 25);
      } else {
        score = Math.min(100, Math.round(90 + ((density - 6) / 4) * 10));
      }

      const response = {
        wordCount,
        sharpQuotes,
        quoteCount: sharpQuotes.length,
        density: parseFloat(density.toFixed(2)),
        score,
        analysis: parsed.analysis || ""
      };

      if (username && typeof username === "string" && username.trim().length >= 2) {
        try {
          const cleanUsername = username.trim().toLowerCase();
          let user = await storage.getUserByUsername(cleanUsername);
          if (!user) {
            user = await storage.createUser({ username: cleanUsername });
          }
          
          const inputPreview = text.substring(0, 200) + (text.length > 200 ? "..." : "");
          
          await storage.createAnalysisHistory({
            userId: user.id,
            analysisType: "intelligence",
            provider: provider,
            inputPreview: inputPreview,
            outputData: response
          });
        } catch (saveError) {
          console.error("Failed to save to history:", saveError);
        }
      }

      res.json(response);
    } catch (error: any) {
      console.error("Intelligence analysis error:", error);
      res.status(500).json({ 
        error: error.message || "Intelligence analysis failed" 
      });
    }
  });

  app.post("/api/intelligence/compare", async (req, res) => {
    try {
      const { textA, textB, provider, username } = req.body;

      if (!textA || typeof textA !== "string" || !textB || typeof textB !== "string") {
        return res.status(400).json({ 
          error: "Missing or invalid text fields in request body" 
        });
      }

      if (!provider || typeof provider !== "string") {
        return res.status(400).json({ 
          error: "Missing or invalid 'provider' field in request body" 
        });
      }

      const wordCountA = textA.split(/\s+/).filter(Boolean).length;
      const wordCountB = textB.split(/\s+/).filter(Boolean).length;
      
      const prompt = `Extract ALL sharp, quotable insights from TWO texts and compare them. Be thorough.

SHARP (extract liberally):
- Punchy formulations: "Religions are degenerate cults."
- Reversals: "Thoughts are taught by being elicited, not by being deposited."
- Dark wit: "The people who should commit suicide don't."
- Compressed insights: "Projection is unconscious LARPing."
- Paradoxes: "The lower you are in a hierarchy, the more fiercely you will defend it."

NOT SHARP (reject):
- "In this dissertation, I critically examine..." (academic framing)
- "I argue that X is problematic." (bland scholarly prose)
- Transitions, signposting, throat-clearing

Be generous. A good essay might have 20-50 sharp quotes.

TEXT A:
${textA}

---

TEXT B:
${textB}

Respond with valid JSON only:
{
  "textA": {
    "sharpQuotes": ["quote1", "quote2", ...],
    "analysis": "Brief explanation"
  },
  "textB": {
    "sharpQuotes": ["quote1", "quote2", ...],
    "analysis": "Brief explanation"
  },
  "verdict": "One-sentence comparative verdict"
}`;

      const result = await callLLM(provider, prompt);
      
      let parsed;
      try {
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          parsed = { textA: { sharpQuotes: [], analysis: "" }, textB: { sharpQuotes: [], analysis: "" }, verdict: "" };
        }
      } catch {
        parsed = { textA: { sharpQuotes: [], analysis: "" }, textB: { sharpQuotes: [], analysis: "" }, verdict: "" };
      }

      const quotesA = Array.isArray(parsed.textA?.sharpQuotes) ? parsed.textA.sharpQuotes.filter((q: any) => typeof q === 'string' && q.trim()) : [];
      const quotesB = Array.isArray(parsed.textB?.sharpQuotes) ? parsed.textB.sharpQuotes.filter((q: any) => typeof q === 'string' && q.trim()) : [];
      
      const densityA = wordCountA > 0 ? (quotesA.length * 1000) / wordCountA : 0;
      const densityB = wordCountB > 0 ? (quotesB.length * 1000) / wordCountB : 0;
      
      const calculateScore = (density: number): number => {
        if (density <= 1) return Math.round(density * 30);
        if (density <= 3) return Math.round(30 + ((density - 1) / 2) * 35);
        if (density <= 6) return Math.round(65 + ((density - 3) / 3) * 25);
        return Math.min(100, Math.round(90 + ((density - 6) / 4) * 10));
      };

      const scoreA = calculateScore(densityA);
      const scoreB = calculateScore(densityB);
      
      let winner: string;
      const densityDiff = Math.abs(densityA - densityB);
      if (densityDiff <= 0.3) {
        winner = "Essentially equal";
      } else if (densityA > densityB) {
        winner = "Text A is sharper";
      } else {
        winner = "Text B is sharper";
      }

      const response = {
        textA: {
          wordCount: wordCountA,
          sharpQuotes: quotesA,
          quoteCount: quotesA.length,
          density: parseFloat(densityA.toFixed(2)),
          score: scoreA,
          analysis: parsed.textA?.analysis || ""
        },
        textB: {
          wordCount: wordCountB,
          sharpQuotes: quotesB,
          quoteCount: quotesB.length,
          density: parseFloat(densityB.toFixed(2)),
          score: scoreB,
          analysis: parsed.textB?.analysis || ""
        },
        winner,
        verdict: parsed.verdict || ""
      };

      if (username && typeof username === "string" && username.trim().length >= 2) {
        try {
          const cleanUsername = username.trim().toLowerCase();
          let user = await storage.getUserByUsername(cleanUsername);
          if (!user) {
            user = await storage.createUser({ username: cleanUsername });
          }
          
          const inputPreview = `Text A: ${textA.substring(0, 100)}... vs Text B: ${textB.substring(0, 100)}...`;
          
          await storage.createAnalysisHistory({
            userId: user.id,
            analysisType: "intelligence_compare",
            provider: provider,
            inputPreview: inputPreview,
            outputData: response
          });
        } catch (saveError) {
          console.error("Failed to save to history:", saveError);
        }
      }

      res.json(response);
    } catch (error: any) {
      console.error("Intelligence comparison error:", error);
      res.status(500).json({ 
        error: error.message || "Intelligence comparison failed" 
      });
    }
  });

  // Holistic Intelligence Analysis with SSE streaming
  app.post("/api/intelligence/stream", async (req, res) => {
    const { analyzeIntelligenceHolistic } = await import("./services/intelligenceAnalyzer");
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let aborted = false;
    let heartbeatInterval: NodeJS.Timeout | null = null;

    const cleanup = () => {
      aborted = true;
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    };

    req.on('close', cleanup);
    req.on('aborted', cleanup);

    heartbeatInterval = setInterval(() => {
      if (!aborted) {
        try {
          res.write(': ping\n\n');
        } catch {}
      }
    }, 15000);

    try {
      const { text, provider, username, author, useOutlineMode } = req.body;

      if (!text || typeof text !== "string") {
        res.write(`data: ${JSON.stringify({ type: 'error', error: "Missing or invalid 'text' field" })}\n\n`);
        cleanup();
        res.end();
        return;
      }

      if (!provider || typeof provider !== "string") {
        res.write(`data: ${JSON.stringify({ type: 'error', error: "Missing or invalid 'provider' field" })}\n\n`);
        cleanup();
        res.end();
        return;
      }

      const result = await analyzeIntelligenceHolistic(
        text,
        provider,
        author,
        (progress) => {
          if (!aborted) {
            try {
              res.write(`data: ${JSON.stringify({ type: 'progress', progress })}\n\n`);
            } catch {}
          }
        },
        useOutlineMode !== false
      );

      if (aborted) {
        cleanup();
        return;
      }

      res.write(`data: ${JSON.stringify({ type: 'result', result })}\n\n`);

      // Deduct credits based on output
      if (req.isAuthenticated() && req.user) {
        try {
          const { calculateCreditsForWords } = await import("./services/stripe");
          const outputText = JSON.stringify(result);
          const wordCount = outputText.split(/\s+/).length;
          const creditsUsed = calculateCreditsForWords(provider, wordCount);
          await storage.deductCredits(req.user.id, creditsUsed);
          res.write(`data: ${JSON.stringify({ type: 'credits', creditsUsed })}\n\n`);
        } catch (creditError) {
          console.error("Failed to deduct credits:", creditError);
        }
      }

      if (username && typeof username === "string" && username.trim().length >= 2) {
        try {
          const cleanUsername = username.trim().toLowerCase();
          let user = await storage.getUserByUsername(cleanUsername);
          if (!user) {
            user = await storage.createUser({ username: cleanUsername });
          }
          
          const inputPreview = text.substring(0, 200) + (text.length > 200 ? "..." : "");
          
          await storage.createAnalysisHistory({
            userId: user.id,
            analysisType: "intelligence_holistic",
            provider: provider,
            inputPreview: inputPreview,
            outputData: result
          });
        } catch (saveError) {
          console.error("Failed to save to history:", saveError);
        }
      }

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      cleanup();
      res.end();
    } catch (error: any) {
      console.error("Holistic intelligence analysis error:", error);
      if (!aborted) {
        try {
          res.write(`data: ${JSON.stringify({ type: 'error', error: error.message || "Analysis failed" })}\n\n`);
        } catch {}
      }
      cleanup();
      res.end();
    }
  });

  // Quote Finder: Find quotes that support given positions
  app.post("/api/find-quotes", async (req, res) => {
    try {
      const { author, positions, corpus, provider } = req.body;

      if (!author || typeof author !== "string") {
        return res.status(400).json({ error: "Missing or invalid 'author' field" });
      }

      if (!positions || !Array.isArray(positions) || positions.length === 0) {
        return res.status(400).json({ error: "Missing or invalid 'positions' array" });
      }

      if (!provider || typeof provider !== "string") {
        return res.status(400).json({ error: "Missing or invalid 'provider' field" });
      }

      // Corpus is now optional - we'll try LLM knowledge first
      const hasCorpus = corpus && typeof corpus === "string" && corpus.trim().length > 0;
      const results: any[] = [];
      let needsCorpus = false;

      for (const position of positions) {
        if (!position || typeof position !== "string") continue;

        let prompt: string;
        
        if (hasCorpus) {
          // With corpus: find verbatim quotes from the provided text
          prompt = `You are an expert textual analyst. 
User will supply:
1. An author name.
2. A doctrinal position.
3. The full corpus of the author's writings.

Task: Identify one or more exact quotes from the corpus that best support or correspond to the given position. Quotes must be verbatim and must appear in the corpus text.

Author: ${author}
Position: ${position}
Corpus: ${corpus}

Return JSON array:
[
  {
    "position": "${position}",
    "quote": "…verbatim quotation…",
    "source": "…if identifiable…"
  }
]`;
        } else {
          // Without corpus: try to find quotes from LLM's knowledge of famous authors
          prompt = `You are an expert on the works of ${author}. 

Task: Find a direct quote from ${author}'s published works that best supports or expresses this position/idea:

Position: ${position}

If ${author} is a well-known author whose works you have knowledge of, provide an actual quote. If you cannot confidently provide a real quote from ${author}'s works (because the author is obscure or you don't have reliable knowledge), respond with exactly: {"status": "need_corpus"}

Otherwise return JSON array:
[
  {
    "position": "${position}",
    "quote": "…the actual quote from ${author}…",
    "source": "…the work/book/text where this appears…"
  }
]`;
        }

        try {
          const llmResponse = await callLLM(provider, prompt);
          
          // Check if LLM says it needs corpus
          if (llmResponse.includes('"status"') && llmResponse.includes('need_corpus')) {
            needsCorpus = true;
            continue;
          }
          
          // Parse the JSON response
          let parsed;
          try {
            // Try to extract JSON array from response
            const jsonMatch = llmResponse.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              parsed = JSON.parse(jsonMatch[0]);
            } else {
              parsed = JSON.parse(llmResponse);
            }
          } catch {
            // If parsing fails, create a simple result
            parsed = [{
              position: position,
              quote: llmResponse.trim(),
              source: "Unable to parse structured response"
            }];
          }

          if (Array.isArray(parsed)) {
            // Filter out empty quotes
            const validQuotes = parsed.filter((p: any) => p.quote && p.quote.trim().length > 0);
            if (validQuotes.length === 0 && !hasCorpus) {
              needsCorpus = true;
            } else {
              results.push(...validQuotes);
            }
          } else if (parsed && parsed.quote) {
            results.push(parsed);
          } else if (!hasCorpus) {
            needsCorpus = true;
          }
        } catch (llmError: any) {
          results.push({
            position: position,
            quote: "",
            source: "",
            error: llmError.message || "LLM call failed"
          });
        }
      }

      // If we tried without corpus and got no results, return 422
      if (!hasCorpus && (needsCorpus || results.length === 0)) {
        return res.status(422).json({ 
          error: `HEY ASSHOLE I NEED FUCKING CORPUS TEXT! I don't know ${author}'s works well enough to find these quotes. Upload or paste their actual writings.`
        });
      }

      res.json({ results });
    } catch (error: any) {
      console.error("Find quotes error:", error);
      res.status(500).json({ 
        error: error.message || "Failed to find quotes" 
      });
    }
  });

  // ============ CORPUS DATABASE ENDPOINTS ============
  
  // Get all corpus authors
  app.get("/api/corpus/authors", async (req, res) => {
    try {
      const authors = await storage.getAllCorpusAuthors();
      res.json(authors);
    } catch (error: any) {
      console.error("Get corpus authors error:", error);
      res.status(500).json({ error: error.message || "Failed to get authors" });
    }
  });
  
  // Create a new corpus author
  app.post("/api/corpus/authors", async (req, res) => {
    try {
      const { name, aliases, era, description } = req.body;
      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "Author name is required" });
      }
      
      // Check if author already exists
      const existing = await storage.findCorpusAuthorByName(name);
      if (existing) {
        return res.status(409).json({ error: "Author already exists", author: existing });
      }
      
      const author = await storage.createCorpusAuthor({ name, aliases, era, description });
      res.json(author);
    } catch (error: any) {
      console.error("Create corpus author error:", error);
      res.status(500).json({ error: error.message || "Failed to create author" });
    }
  });
  
  // Delete a corpus author
  app.delete("/api/corpus/authors/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid author ID" });
      }
      
      await storage.deleteCorpusAuthor(id);
      res.json({ message: "Author deleted successfully" });
    } catch (error: any) {
      console.error("Delete corpus author error:", error);
      res.status(500).json({ error: error.message || "Failed to delete author" });
    }
  });
  
  // Get works for an author
  app.get("/api/corpus/authors/:id/works", async (req, res) => {
    try {
      const authorId = parseInt(req.params.id);
      if (isNaN(authorId)) {
        return res.status(400).json({ error: "Invalid author ID" });
      }
      
      const works = await storage.getCorpusWorks(authorId);
      res.json(works);
    } catch (error: any) {
      console.error("Get corpus works error:", error);
      res.status(500).json({ error: error.message || "Failed to get works" });
    }
  });
  
  // Upload a work (with automatic chunking)
  app.post("/api/corpus/works", async (req, res) => {
    try {
      const { authorId, title, year, source, content } = req.body;
      
      if (!authorId || isNaN(parseInt(authorId))) {
        return res.status(400).json({ error: "Valid author ID is required" });
      }
      
      if (!title || typeof title !== "string") {
        return res.status(400).json({ error: "Work title is required" });
      }
      
      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "Work content is required" });
      }
      
      // Verify author exists
      const author = await storage.getCorpusAuthor(parseInt(authorId));
      if (!author) {
        return res.status(404).json({ error: "Author not found" });
      }
      
      const wordCount = content.split(/\s+/).filter(Boolean).length;
      
      // Create the work
      const work = await storage.createCorpusWork({
        authorId: parseInt(authorId),
        title,
        year: year ? parseInt(year) : null,
        source,
        wordCount
      });
      
      // Chunk the content into ~2500 character sections
      const CHUNK_SIZE = 2500;
      const sections: { workId: number; sectionNumber: number; content: string }[] = [];
      
      let currentPos = 0;
      let sectionNumber = 1;
      
      while (currentPos < content.length) {
        // Find a good break point (end of sentence or paragraph)
        let endPos = Math.min(currentPos + CHUNK_SIZE, content.length);
        
        if (endPos < content.length) {
          // Look for paragraph break first
          const paragraphBreak = content.lastIndexOf('\n\n', endPos);
          if (paragraphBreak > currentPos + CHUNK_SIZE / 2) {
            endPos = paragraphBreak + 2;
          } else {
            // Look for sentence break
            const sentenceBreak = content.lastIndexOf('. ', endPos);
            if (sentenceBreak > currentPos + CHUNK_SIZE / 2) {
              endPos = sentenceBreak + 2;
            }
          }
        }
        
        const chunk = content.substring(currentPos, endPos).trim();
        if (chunk.length > 0) {
          sections.push({
            workId: work.id,
            sectionNumber,
            content: chunk
          });
          sectionNumber++;
        }
        
        currentPos = endPos;
      }
      
      // Save all sections
      await storage.createWorkSections(sections);
      
      res.json({ 
        work, 
        sectionsCreated: sections.length,
        message: `Uploaded "${title}" with ${sections.length} searchable sections (${wordCount} words)`
      });
    } catch (error: any) {
      console.error("Upload corpus work error:", error);
      res.status(500).json({ error: error.message || "Failed to upload work" });
    }
  });
  
  // Delete a work
  app.delete("/api/corpus/works/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid work ID" });
      }
      
      await storage.deleteCorpusWork(id);
      res.json({ message: "Work deleted successfully" });
    } catch (error: any) {
      console.error("Delete corpus work error:", error);
      res.status(500).json({ error: error.message || "Failed to delete work" });
    }
  });
  
  // Search corpus by author and term
  app.post("/api/corpus/search", async (req, res) => {
    try {
      const { authorName, searchTerm } = req.body;
      
      if (!authorName || typeof authorName !== "string") {
        return res.status(400).json({ error: "Author name is required" });
      }
      
      if (!searchTerm || typeof searchTerm !== "string") {
        return res.status(400).json({ error: "Search term is required" });
      }
      
      const results = await storage.searchCorpusByAuthor(authorName, searchTerm);
      res.json({ results, count: results.length });
    } catch (error: any) {
      console.error("Search corpus error:", error);
      res.status(500).json({ error: error.message || "Failed to search corpus" });
    }
  });
  
  // Get corpus stats
  app.get("/api/corpus/stats", async (req, res) => {
    try {
      const authors = await storage.getAllCorpusAuthors();
      let totalWorks = 0;
      let totalWords = 0;
      
      for (const author of authors) {
        const works = await storage.getCorpusWorks(author.id);
        totalWorks += works.length;
        totalWords += works.reduce((sum, w) => sum + (w.wordCount || 0), 0);
      }
      
      res.json({
        totalAuthors: authors.length,
        totalWorks,
        totalWords,
        authors: authors.map(a => ({ id: a.id, name: a.name }))
      });
    } catch (error: any) {
      console.error("Get corpus stats error:", error);
      res.status(500).json({ error: error.message || "Failed to get stats" });
    }
  });

  // ============ STRIPE PAYMENT ROUTES ============
  const { createCheckoutSession, handleWebhookEvent, CREDITS_PER_PURCHASE, calculateCreditsForWords } = await import("./services/stripe");

  app.get("/api/credits", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Must be logged in" });
    }
    const credits = await storage.getUserCredits(req.user.id);
    res.json({ credits });
  });

  app.post("/api/checkout", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Must be logged in to purchase credits" });
    }

    try {
      const session = await createCheckoutSession(req.user.id, req.user.email || null);
      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Checkout error:", error);
      res.status(500).json({ error: error.message || "Failed to create checkout" });
    }
  });

  app.get("/api/stripe-publishable-key", (req, res) => {
    res.json({ key: process.env.STRIPE_PUBLISHABLE_KEY || '' });
  });

  app.post("/api/webhook/stripe", async (req, res) => {
    const signature = req.headers['stripe-signature'] as string;
    
    if (!signature) {
      return res.status(400).json({ error: "Missing stripe-signature header" });
    }

    try {
      const event = await handleWebhookEvent(req.rawBody as Buffer, signature);
      
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as any;
        const userId = parseInt(session.metadata.userId, 10);
        const credits = parseInt(session.metadata.credits, 10);
        
        if (userId && credits) {
          await storage.addCredits(userId, credits);
          console.log(`Added ${credits} credits to user ${userId}`);
        }
      }

      res.json({ received: true });
    } catch (error: any) {
      console.error("Webhook error:", error);
      res.status(400).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
