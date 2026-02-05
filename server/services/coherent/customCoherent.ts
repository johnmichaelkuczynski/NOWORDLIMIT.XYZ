import { processDocumentSequentially, autoDetectMode } from "./coherenceProcessor";
import { generateSkeleton } from "./skeletonGenerator";
import { chunkText } from "./coherenceProcessor";
import { callLLM } from "../../llm";
import { ProgressUpdate } from "./stateSchemas";

export interface CustomAnalysisResult {
  documentId: string;
  result: string;
  mode: "rewrite" | "analysis";
  chunkCount: number;
}

function detectTaskType(instructions: string): "rewrite" | "analysis" {
  const rewriteKeywords = [
    "rewrite", "rephrase", "summarize", "translate", "convert",
    "simplify", "expand", "compress", "paraphrase", "edit"
  ];
  
  const analysisKeywords = [
    "extract", "find", "identify", "list", "analyze",
    "what are", "how many", "compare", "evaluate"
  ];

  const lowerInstructions = instructions.toLowerCase();
  
  const rewriteScore = rewriteKeywords.filter(k => lowerInstructions.includes(k)).length;
  const analysisScore = analysisKeywords.filter(k => lowerInstructions.includes(k)).length;

  return rewriteScore >= analysisScore ? "rewrite" : "analysis";
}

export async function customCoherent(
  text: string,
  instructions: string,
  provider: string,
  onProgress?: (progress: ProgressUpdate) => void,
  desiredWordCount?: number,
  userId?: number
): Promise<CustomAnalysisResult> {
  const taskType = detectTaskType(instructions);

  if (taskType === "rewrite") {
    return customRewrite(text, instructions, provider, onProgress, desiredWordCount, userId);
  } else {
    return customAnalysis(text, instructions, provider, onProgress, desiredWordCount, userId);
  }
}

async function customRewrite(
  text: string,
  instructions: string,
  provider: string,
  onProgress?: (progress: ProgressUpdate) => void,
  desiredWordCount?: number,
  userId?: number
): Promise<CustomAnalysisResult> {
  const mode = await autoDetectMode(text.substring(0, 3000), provider);
  
  const instructionsWithWordCount = desiredWordCount 
    ? `${instructions}\n\nIMPORTANT: Your total output should be approximately ${desiredWordCount.toLocaleString()} words.`
    : instructions;

  const result = await processDocumentSequentially(
    text,
    mode,
    provider,
    "rewrite",
    instructionsWithWordCount,
    onProgress,
    userId
  );

  return {
    documentId: result.documentId,
    result: result.finalOutput,
    mode: "rewrite",
    chunkCount: result.chunkCount
  };
}

async function customAnalysis(
  text: string,
  instructions: string,
  provider: string,
  onProgress?: (progress: ProgressUpdate) => void,
  desiredWordCount?: number,
  userId?: number
): Promise<CustomAnalysisResult> {
  onProgress?.({ phase: "skeleton", message: "Generating document skeleton..." });
  const skeleton = await generateSkeleton(text, provider, userId);

  const chunks = chunkText(text, 1500);
  const chunkResults: string[] = [];
  
  const wordCountNote = desiredWordCount 
    ? `\n\nNote: The final synthesis should be approximately ${desiredWordCount.toLocaleString()} words.`
    : '';

  for (let i = 0; i < chunks.length; i++) {
    onProgress?.({
      phase: "analysis",
      currentChunk: i + 1,
      totalChunks: chunks.length,
      message: `Analyzing chunk ${i + 1} of ${chunks.length}...`
    });

    const prompt = `You are analyzing a document chunk-by-chunk.

DOCUMENT CONTEXT:
- Main Thesis: ${skeleton.mainThesis}
- Overarching Theme: ${skeleton.overarchingTheme}

CHUNK ${i + 1} OF ${chunks.length}:
${chunks[i]}

USER INSTRUCTIONS:
${instructions}

Apply the user's instructions to this chunk. Be thorough and specific.`;

    try {
      const response = await callLLM(provider, prompt);
      chunkResults.push(`### Chunk ${i + 1}\n\n${response}`);
    } catch (e) {
      console.error(`Failed to analyze chunk ${i}:`, e);
      chunkResults.push(`### Chunk ${i + 1}\n\n[Analysis failed]`);
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  onProgress?.({ phase: "synthesis", message: "Synthesizing results..." });

  const synthesisPrompt = `You analyzed a document in ${chunks.length} chunks. Here are the per-chunk results:

${chunkResults.join('\n\n---\n\n')}

Now synthesize these into a unified response that addresses the user's original instructions:
"${instructions}"${wordCountNote}

Provide a comprehensive, well-organized synthesis.`;

  const synthesis = await callLLM(provider, synthesisPrompt);

  return {
    documentId: skeleton.documentId,
    result: synthesis,
    mode: "analysis",
    chunkCount: chunks.length
  };
}
