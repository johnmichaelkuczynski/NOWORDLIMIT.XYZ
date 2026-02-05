import { generateOutline, Outline, Section } from "./outlineService";
import { callLLM } from "../llm";

async function callLLMWithJSON(provider: string, prompt: string): Promise<any> {
  const fullPrompt = prompt + "\n\nIMPORTANT: You must respond with valid JSON only. No markdown, no extra text.";
  const content = await callLLM(provider, fullPrompt);
  
  try {
    return JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]);
    }
    throw new Error("Failed to parse LLM response as JSON");
  }
}

export interface IntelligenceProgress {
  stage: "outlining" | "analyzing" | "calculating" | "complete" | "error";
  message: string;
  current?: number;
  total?: number;
}

export interface ExtractedSignalQuote {
  author: string;
  quote: string;
  source: string;
  charLength: number;
}

export interface HolisticIntelligenceResult {
  score: number;
  ratio: number;
  totalTextLength: number;
  totalSignalLength: number;
  quotes: ExtractedSignalQuote[];
  analysis: string;
  mode: "outline" | "chunk";
}

function sliceTextBySections(text: string, sections: Section[]): { section: Section; content: string }[] {
  const result: { section: Section; content: string }[] = [];
  const totalWords = text.split(/\s+/).filter(Boolean).length;
  
  let currentPosition = 0;
  
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const sectionWordCount = section.wordCount || Math.floor(totalWords / sections.length);
    
    const words = text.split(/\s+/);
    const sectionStart = currentPosition;
    const sectionEnd = Math.min(currentPosition + sectionWordCount, words.length);
    
    const sectionWords = words.slice(sectionStart, sectionEnd);
    const content = sectionWords.join(' ');
    
    result.push({ section, content });
    currentPosition = sectionEnd;
  }
  
  return result;
}

function deduplicateQuotes(quotes: ExtractedSignalQuote[]): ExtractedSignalQuote[] {
  const seen = new Set<string>();
  const unique: ExtractedSignalQuote[] = [];
  
  for (const q of quotes) {
    const normalized = q.quote.toLowerCase().trim().replace(/\s+/g, ' ');
    
    let isDuplicate = false;
    const seenArray = Array.from(seen);
    
    for (const seenQuote of seenArray) {
      if (seenQuote === normalized) {
        isDuplicate = true;
        break;
      }
      if (seenQuote.includes(normalized) || normalized.includes(seenQuote)) {
        if (normalized.length > seenQuote.length) {
          seen.delete(seenQuote);
          const idx = unique.findIndex(uq => 
            uq.quote.toLowerCase().trim().replace(/\s+/g, ' ') === seenQuote
          );
          if (idx !== -1) unique.splice(idx, 1);
        } else {
          isDuplicate = true;
        }
        break;
      }
    }
    
    if (!isDuplicate) {
      seen.add(normalized);
      unique.push(q);
    }
  }
  
  return unique;
}

function inferAuthor(text: string): string {
  const authorPatterns = [
    /^(?:by|author[:\s]+|written by[:\s]+)([A-Z][a-z]+ [A-Z][a-z]+)/im,
    /—\s*([A-Z][a-z]+ [A-Z][a-z]+)\s*$/m,
    /^\s*([A-Z][a-z]+ [A-Z][a-z]+)\s*$/m
  ];
  
  for (const pattern of authorPatterns) {
    const match = text.substring(0, 2000).match(pattern);
    if (match) return match[1];
  }
  
  return "Unknown";
}

export async function analyzeIntelligenceWithOutline(
  text: string,
  provider: string = "openai",
  author?: string,
  onProgress?: (progress: IntelligenceProgress) => void
): Promise<HolisticIntelligenceResult> {
  const inferredAuthor = author?.trim() || inferAuthor(text);
  const totalTextLength = text.length;
  
  onProgress?.({ stage: "outlining", message: "Generating structural outline of full text..." });

  let outline: Outline;
  try {
    outline = await generateOutline(text.substring(0, 100000));
    if (!outline.sections || outline.sections.length === 0) {
      throw new Error("Outline generation returned no sections");
    }
  } catch (error: any) {
    onProgress?.({ stage: "outlining", message: "Outline failed, falling back to chunk mode..." });
    return analyzeIntelligenceChunked(text, provider, inferredAuthor, onProgress);
  }

  onProgress?.({ 
    stage: "outlining", 
    message: `Outline complete: ${outline.sections.length} sections. Extracting signal quotes...` 
  });

  const slicedSections = sliceTextBySections(text, outline.sections);
  const allQuotes: ExtractedSignalQuote[] = [];
  
  for (let i = 0; i < slicedSections.length; i++) {
    const { section, content } = slicedSections[i];

    onProgress?.({ 
      stage: "analyzing", 
      message: `Analyzing section ${i + 1}/${slicedSections.length}: "${section.title}"...`,
      current: i + 1,
      total: slicedSections.length
    });

    if (content.trim().length < 100) continue;

    const extractPrompt = `You are a RUTHLESS intellectual quality filter. Your job is to extract ONLY genuinely insightful content - the kind of text that makes a reader stop and think.

CRITICAL DISTINCTION - You must understand this:

META-STATEMENTS (NEVER extract these - they are PURE NOISE):
- "I argue that X" - This is a PROMISE of an argument, not an argument
- "In this chapter, I will show..." - This is a roadmap, not insight
- "I critically examine..." - This describes an activity, not a result
- "I conclude that X" - Unless the reasoning is present, this is just a claim
- "This dissertation is divided into five parts" - Pure structure, zero insight
- "I aim to show..." - Intent, not substance

JARGON MIMICRY (NEVER extract - sounds smart but says nothing):
- Strings of technical terms without actual content
- Academic name-dropping without substantive engagement
- Phrases that use impressive vocabulary but make no actual claim
- "Transcendental empiricism attempts to dissolve an epistemological dilemma" - vague gesture at ideas

GENUINE INSIGHT (ONLY extract these):
- ACTUAL ARGUMENTS with premises and conclusions stated
- Specific, novel claims that say something non-obvious
- Precise definitions that illuminate rather than obscure
- Paradoxes that genuinely reframe understanding
- Concrete distinctions that change how we see things
- Explanations that make complex ideas clear

EXAMPLES OF THE DIFFERENCE:

NOISE: "I argue that McDowell's version of linguistic idealism is problematic."
WHY: This just SAYS there's a problem. Where's the actual argument?

SIGNAL: "McDowell's linguistic idealism fails because it cannot account for pre-linguistic infants' demonstrable knowledge of object permanence."  
WHY: This gives an actual reason, makes a specific claim.

NOISE: "Disjunctivism is crucial for transcendental empiricism."
WHY: Asserts importance without explaining the connection.

SIGNAL: "Without disjunctivism, transcendental empiricism collapses into skepticism because it can no longer distinguish veridical from hallucinatory experience."
WHY: Explains the actual logical dependency.

SECTION TEXT:
"""
${content}
"""

BE EXTREMELY SELECTIVE. Most academic writing is 90% scaffolding and 10% insight. If this section has no genuine insights, return an empty array. A dissertation abstract that just describes structure should yield ZERO quotes.

{
  "quotes": [
    {
      "author": "${inferredAuthor}",
      "quote": "exact verbatim text - must be genuine insight, not meta-statement",
      "source": "${section.title}"
    }
  ]
}

Extract ONLY genuine insights. If the text is all meta-commentary and structure, return {"quotes": []}.`;

    try {
      const sectionResult = await callLLMWithJSON(provider, extractPrompt);
      const quotes = sectionResult.quotes || [];
      
      for (const q of quotes) {
        if (q.quote && q.quote.trim().length > 20) {
          allQuotes.push({
            author: inferredAuthor,
            quote: q.quote.trim(),
            source: q.source || section.title,
            charLength: q.quote.trim().length
          });
        }
      }
    } catch (error) {
      console.error(`Failed to extract from section "${section.title}":`, error);
    }

    if (i < slicedSections.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  onProgress?.({ stage: "calculating", message: "Calculating signal-to-noise ratio..." });

  const uniqueQuotes = deduplicateQuotes(allQuotes);
  const totalSignalLength = uniqueQuotes.reduce((sum, q) => sum + q.charLength, 0);
  const ratio = totalTextLength > 0 ? totalSignalLength / totalTextLength : 0;
  
  // Direct scoring based on signal ratio
  // 0% = 0, 5% = 25, 10% = 50, 20% = 75, 40%+ = 95-100
  // High ratio means the text is dense with genuine insight
  let score: number;
  if (ratio <= 0.01) {
    score = Math.round(ratio * 500); // 0-1% -> 0-5
  } else if (ratio <= 0.05) {
    score = Math.round(5 + (ratio - 0.01) * 500); // 1-5% -> 5-25
  } else if (ratio <= 0.10) {
    score = Math.round(25 + (ratio - 0.05) * 500); // 5-10% -> 25-50
  } else if (ratio <= 0.20) {
    score = Math.round(50 + (ratio - 0.10) * 250); // 10-20% -> 50-75
  } else if (ratio <= 0.40) {
    score = Math.round(75 + (ratio - 0.20) * 100); // 20-40% -> 75-95
  } else {
    score = Math.min(100, Math.round(95 + (ratio - 0.40) * 10)); // 40%+ -> 95-100
  }
  score = Math.max(0, Math.min(100, score));

  const scoreLabel = score >= 80 ? "Excellent - exceptionally rich in quotable insights" :
    score >= 65 ? "Very Good - high density of meaningful content" :
    score >= 50 ? "Good - solid content with valuable passages" :
    score >= 35 ? "Moderate - some signal mixed with exposition" :
    "Low - mostly framing, transitions, or filler";

  const analysis = `Signal-to-Noise Analysis:
- Total text length: ${totalTextLength.toLocaleString()} characters
- Total signal (quote) length: ${totalSignalLength.toLocaleString()} characters
- Unique quotes extracted: ${uniqueQuotes.length}
- Signal ratio: ${(ratio * 100).toFixed(2)}%
- Intelligence Score: ${score}/100

${scoreLabel}`;

  onProgress?.({ 
    stage: "complete", 
    message: `Analysis complete. Score: ${score}/100 (${uniqueQuotes.length} unique quotes)` 
  });

  return {
    score,
    ratio,
    totalTextLength,
    totalSignalLength,
    quotes: uniqueQuotes,
    analysis,
    mode: "outline"
  };
}

export async function analyzeIntelligenceChunked(
  text: string,
  provider: string = "openai",
  author?: string,
  onProgress?: (progress: IntelligenceProgress) => void
): Promise<HolisticIntelligenceResult> {
  const inferredAuthor = author?.trim() || inferAuthor(text);
  const totalTextLength = text.length;
  const chunkSize = 8000;
  const numChunks = Math.ceil(text.length / chunkSize);
  
  onProgress?.({ stage: "analyzing", message: `Analyzing ${numChunks} chunks...` });
  
  const allQuotes: ExtractedSignalQuote[] = [];
  
  for (let i = 0; i < numChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min((i + 1) * chunkSize, text.length);
    const chunkText = text.substring(start, end);
    
    onProgress?.({ 
      stage: "analyzing", 
      message: `Analyzing chunk ${i + 1}/${numChunks}...`,
      current: i + 1,
      total: numChunks
    });
    
    if (chunkText.trim().length < 50) continue;

    const extractPrompt = `You are a RUTHLESS intellectual quality filter. Extract ONLY genuinely insightful content.

TEXT:
"""
${chunkText}
"""

META-STATEMENTS (NEVER extract - these are NOISE):
- "I argue that X" - Promise of argument, not argument itself
- "In this chapter, I will show..." - Roadmap, not insight
- "I critically examine..." - Activity description, not result
- "I conclude that X" - Just a claim without reasoning
- "This dissertation is divided into..." - Pure structure
- "I aim to show..." - Intent, not substance

JARGON MIMICRY (NEVER extract):
- Technical terms strung together without actual content
- Academic name-dropping without engagement
- Impressive vocabulary that makes no actual claim

GENUINE INSIGHT (ONLY extract these):
- ACTUAL ARGUMENTS with premises and conclusions
- Specific, novel claims that say something non-obvious
- Precise definitions that illuminate
- Explanations that make complex ideas clear

If text is all meta-commentary, roadmapping, or structure description, return {"quotes": []}.

{
  "quotes": [
    {
      "author": "${inferredAuthor}",
      "quote": "exact verbatim genuine insight only",
      "source": "Topic/Theme"
    }
  ]
}`;

    try {
      const result = await callLLMWithJSON(provider, extractPrompt);
      for (const q of (result.quotes || [])) {
        if (q.quote && q.quote.trim().length > 20) {
          allQuotes.push({
            author: inferredAuthor,
            quote: q.quote.trim(),
            source: q.source || `Part ${i + 1}`,
            charLength: q.quote.trim().length
          });
        }
      }
    } catch (error) {
      console.error(`Failed to extract from chunk ${i + 1}:`, error);
    }

    if (i < numChunks - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  onProgress?.({ stage: "calculating", message: "Calculating signal-to-noise ratio..." });
  
  const uniqueQuotes = deduplicateQuotes(allQuotes);
  const totalSignalLength = uniqueQuotes.reduce((sum, q) => sum + q.charLength, 0);
  const ratio = totalTextLength > 0 ? totalSignalLength / totalTextLength : 0;
  
  // Direct scoring based on signal ratio
  // 0% = 0, 5% = 25, 10% = 50, 20% = 75, 40%+ = 95-100
  let score: number;
  if (ratio <= 0.01) {
    score = Math.round(ratio * 500); // 0-1% -> 0-5
  } else if (ratio <= 0.05) {
    score = Math.round(5 + (ratio - 0.01) * 500); // 1-5% -> 5-25
  } else if (ratio <= 0.10) {
    score = Math.round(25 + (ratio - 0.05) * 500); // 5-10% -> 25-50
  } else if (ratio <= 0.20) {
    score = Math.round(50 + (ratio - 0.10) * 250); // 10-20% -> 50-75
  } else if (ratio <= 0.40) {
    score = Math.round(75 + (ratio - 0.20) * 100); // 20-40% -> 75-95
  } else {
    score = Math.min(100, Math.round(95 + (ratio - 0.40) * 10)); // 40%+ -> 95-100
  }
  score = Math.max(0, Math.min(100, score));

  const scoreLabel = score >= 80 ? "Excellent - exceptionally rich in quotable insights" :
    score >= 65 ? "Very Good - high density of meaningful content" :
    score >= 50 ? "Good - solid content with valuable passages" :
    score >= 35 ? "Moderate - some signal mixed with exposition" :
    "Low - mostly framing, transitions, or filler";

  const analysis = `Signal-to-Noise Analysis (Chunk Mode):
- Total text length: ${totalTextLength.toLocaleString()} characters
- Total signal (quote) length: ${totalSignalLength.toLocaleString()} characters
- Unique quotes extracted: ${uniqueQuotes.length}
- Signal ratio: ${(ratio * 100).toFixed(2)}%
- Intelligence Score: ${score}/100

${scoreLabel}`;

  onProgress?.({ 
    stage: "complete", 
    message: `Found ${uniqueQuotes.length} unique quotes. Score: ${score}/100` 
  });

  return {
    score,
    ratio,
    totalTextLength,
    totalSignalLength,
    quotes: uniqueQuotes,
    analysis,
    mode: "chunk"
  };
}

export async function analyzeIntelligenceHolistic(
  text: string,
  provider: string = "openai",
  author?: string,
  onProgress?: (progress: IntelligenceProgress) => void,
  useOutlineMode: boolean = true
): Promise<HolisticIntelligenceResult> {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  
  if (!useOutlineMode || wordCount < 1000) {
    return analyzeIntelligenceChunked(text, provider, author, onProgress);
  }
  
  return analyzeIntelligenceWithOutline(text, provider, author, onProgress);
}
