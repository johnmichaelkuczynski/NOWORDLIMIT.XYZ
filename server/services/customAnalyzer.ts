import { callLLM } from "../llm";
import { generateOutline, Outline } from "./outlineService";

export interface CustomAnalysisProgress {
  stage: "outlining" | "processing" | "extracting_quotes" | "combining" | "complete" | "error";
  message: string;
  current?: number;
  total?: number;
}

export interface CustomAnalysisResult {
  output: string;
  outline?: Outline;
  sectionsProcessed: number;
  wordCount: number;
}

function parseQuoteTarget(instructions: string): number | null {
  const match = instructions.match(/(\d+)\s*(quotes?|quotations?)/i);
  return match ? parseInt(match[1]) : null;
}

function hasSummaryRequest(instructions: string): boolean {
  return /summar/i.test(instructions);
}

function hasCritiqueRequest(instructions: string): boolean {
  return /critique|criticis|analyz|evaluat/i.test(instructions);
}

function getWordTarget(instructions: string, type: string): number {
  const pattern = new RegExp(`(\\d+)\\s*word\\s*${type}`, 'i');
  const match = instructions.match(pattern);
  return match ? parseInt(match[1]) : 1000;
}

function sliceTextBySections(text: string, numSections: number): string[] {
  const words = text.split(/\s+/);
  const wordsPerSection = Math.ceil(words.length / numSections);
  const result: string[] = [];
  
  for (let i = 0; i < numSections; i++) {
    const start = i * wordsPerSection;
    const end = Math.min(start + wordsPerSection, words.length);
    const chunk = words.slice(start, end).join(" ");
    if (chunk.trim()) result.push(chunk);
  }
  
  return result;
}

async function extractVerbatimQuotes(
  textSlices: string[],
  targetCount: number,
  provider: string,
  onProgress?: (progress: CustomAnalysisProgress) => void
): Promise<string[]> {
  const allQuotes: string[] = [];
  const quotesPerSlice = Math.ceil((targetCount * 1.5) / textSlices.length);

  for (let i = 0; i < textSlices.length; i++) {
    const slice = textSlices[i];
    
    onProgress?.({
      stage: "extracting_quotes",
      message: `Extracting verbatim quotes from section ${i + 1}/${textSlices.length}...`,
      current: i + 1,
      total: textSlices.length
    });

    const prompt = `TASK: Extract ${quotesPerSlice} VERBATIM quotes from this text.

CRITICAL RULES:
1. COPY EXACT TEXT - character for character, word for word
2. NO paraphrasing, NO summarizing, NO rewording
3. Each quote must be a DIRECT COPY from the text below
4. If you cannot find exact text, return fewer quotes - DO NOT INVENT

TEXT TO EXTRACT FROM:
"""
${slice}
"""

Return JSON array of exact quotes:
{"quotes": ["exact quote 1", "exact quote 2", ...]}

Extract ${quotesPerSlice} verbatim quotes. EXACT TEXT ONLY.`;

    try {
      const response = await callLLM(provider, prompt);
      const jsonMatch = response.match(/\{[\s\S]*"quotes"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.quotes)) {
          for (const q of parsed.quotes) {
            if (typeof q === 'string' && q.trim().length > 20) {
              allQuotes.push(q.trim());
            }
          }
        }
      }
    } catch (error) {
      console.error(`Quote extraction failed for section ${i + 1}:`, error);
    }

    if (i < textSlices.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  const unique = Array.from(new Set(allQuotes));
  return unique.slice(0, targetCount);
}

export async function runCustomAnalysis(
  text: string,
  instructions: string,
  provider: string = "openai",
  useOutlineMode: boolean = true,
  onProgress?: (progress: CustomAnalysisProgress) => void,
  desiredWordCount?: number
): Promise<CustomAnalysisResult> {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const charCount = text.length;
  
  const quoteTarget = parseQuoteTarget(instructions);
  const wantsSummary = hasSummaryRequest(instructions);
  const wantsCritique = hasCritiqueRequest(instructions);
  const summaryWords = wantsSummary ? getWordTarget(instructions, "summar") : 0;
  const critiqueWords = wantsCritique ? getWordTarget(instructions, "critique") : 0;

  let outline: Outline | undefined;
  let outlineJSON = "{}";

  if (useOutlineMode) {
    onProgress?.({ stage: "outlining", message: `Outlining ${wordCount.toLocaleString()} words...` });
    
    try {
      outline = await generateOutline(text.substring(0, 150000));
      outlineJSON = JSON.stringify({
        summary: outline.taskSummary,
        sections: outline.sections.map(s => ({
          title: s.title,
          themes: s.keyThemes
        }))
      }, null, 2);
    } catch (error) {
      onProgress?.({ stage: "outlining", message: "Outline failed, proceeding..." });
    }
  }

  const TOKEN_LIMIT = 90000;
  const estimatedTokens = Math.ceil(charCount / 3.5);
  const needsSplitting = estimatedTokens > TOKEN_LIMIT;
  
  const numSections = needsSplitting ? Math.max(8, Math.ceil(wordCount / 25000)) : 1;
  const textSlices = needsSplitting ? sliceTextBySections(text, numSections) : [text];

  const finalParts: string[] = [];

  if (wantsSummary) {
    onProgress?.({ stage: "processing", message: `Generating ${summaryWords}-word summary...` });
    
    if (needsSplitting) {
      const sectionSummaries: string[] = [];
      
      for (let i = 0; i < textSlices.length; i++) {
        onProgress?.({
          stage: "processing",
          message: `Summarizing section ${i + 1}/${textSlices.length}...`,
          current: i + 1,
          total: textSlices.length
        });

        const prompt = `STRICT INSTRUCTION: Summarize ONLY the content in this text section. Use ONLY information from the text below. NO external knowledge, NO author biography, NO publication history, NO cultural reception.

TEXT SECTION ${i + 1}/${textSlices.length}:
"""
${textSlices[i]}
"""

Write a ${Math.ceil(summaryWords / textSlices.length)}-word summary of THIS SECTION ONLY. Discuss only the philosophical arguments and ideas PRESENT IN THIS TEXT.`;

        try {
          const summary = await callLLM(provider, prompt);
          sectionSummaries.push(summary.trim());
        } catch (error) {
          sectionSummaries.push("[Section processing error]");
        }
        
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      const combinePrompt = `Combine these section summaries into ONE cohesive ${summaryWords}-word summary:

${sectionSummaries.join("\n\n---\n\n")}

RULES:
- Use ONLY content from the summaries above
- NO external knowledge about the author
- NO publication history or reception
- Make it flow as one unified piece
- Target: ${summaryWords} words`;

      try {
        const finalSummary = await callLLM(provider, combinePrompt);
        finalParts.push(`# Summary (${summaryWords} words requested)\n\n${finalSummary.trim()}`);
      } catch {
        finalParts.push(`# Summary\n\n${sectionSummaries.join("\n\n")}`);
      }
    } else {
      const prompt = `STRICT INSTRUCTION: Summarize ONLY the content in this text. Use ONLY information from the text below. NO external knowledge, NO author biography, NO publication history, NO cultural reception.

TEXT:
"""
${text}
"""

OUTLINE (for structure only):
${outlineJSON}

Write a ${summaryWords}-word summary. Discuss ONLY the philosophical arguments and ideas PRESENT IN THIS TEXT. Nothing external.`;

      try {
        const summary = await callLLM(provider, prompt);
        finalParts.push(`# Summary\n\n${summary.trim()}`);
      } catch (error: any) {
        finalParts.push(`# Summary\n\n[Error: ${error.message}]`);
      }
    }
  }

  if (wantsCritique) {
    onProgress?.({ stage: "processing", message: `Generating ${critiqueWords}-word critique...` });
    
    if (needsSplitting) {
      const sectionCritiques: string[] = [];
      
      for (let i = 0; i < textSlices.length; i++) {
        onProgress?.({
          stage: "processing",
          message: `Critiquing section ${i + 1}/${textSlices.length}...`,
          current: i + 1,
          total: textSlices.length
        });

        const prompt = `STRICT INSTRUCTION: Critique ONLY the arguments in this text section. Evaluate the philosophical claims PRESENT IN THIS TEXT. NO external knowledge, NO author biography, NO historical context from outside the text.

TEXT SECTION ${i + 1}/${textSlices.length}:
"""
${textSlices[i]}
"""

Write a ${Math.ceil(critiqueWords / textSlices.length)}-word critique of the arguments IN THIS SECTION. Assess strengths and weaknesses of the reasoning PRESENT IN THIS TEXT.`;

        try {
          const critique = await callLLM(provider, prompt);
          sectionCritiques.push(critique.trim());
        } catch (error) {
          sectionCritiques.push("[Section processing error]");
        }
        
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      const combinePrompt = `Combine these section critiques into ONE cohesive ${critiqueWords}-word critique:

${sectionCritiques.join("\n\n---\n\n")}

RULES:
- Use ONLY content from the critiques above
- NO external knowledge about the author  
- Make it flow as one unified piece
- Target: ${critiqueWords} words`;

      try {
        const finalCritique = await callLLM(provider, combinePrompt);
        finalParts.push(`# Critique (${critiqueWords} words requested)\n\n${finalCritique.trim()}`);
      } catch {
        finalParts.push(`# Critique\n\n${sectionCritiques.join("\n\n")}`);
      }
    } else {
      const prompt = `STRICT INSTRUCTION: Critique ONLY the arguments in this text. Evaluate the philosophical claims PRESENT IN THIS TEXT. NO external knowledge, NO author biography, NO historical context from outside the text.

TEXT:
"""
${text}
"""

Write a ${critiqueWords}-word critique. Assess the strengths and weaknesses of the reasoning PRESENT IN THIS TEXT. Nothing external.`;

      try {
        const critique = await callLLM(provider, prompt);
        finalParts.push(`# Critique\n\n${critique.trim()}`);
      } catch (error: any) {
        finalParts.push(`# Critique\n\n[Error: ${error.message}]`);
      }
    }
  }

  if (quoteTarget && quoteTarget > 0) {
    onProgress?.({ stage: "extracting_quotes", message: `Extracting ${quoteTarget} verbatim quotes...` });
    
    const quotes = await extractVerbatimQuotes(textSlices, quoteTarget, provider, onProgress);
    
    const quotesSection = quotes.map((q, i) => `${i + 1}. "${q}"`).join("\n\n");
    finalParts.push(`# Top ${quotes.length} Verbatim Quotes\n\n${quotesSection}`);
  }

  if (finalParts.length === 0) {
    onProgress?.({ stage: "processing", message: "Processing custom instructions..." });
    
    const wordCountInstruction = desiredWordCount 
      ? `\n\nIMPORTANT OUTPUT LENGTH REQUIREMENT: Your response should be approximately ${desiredWordCount.toLocaleString()} words. Adjust the depth and detail of your analysis to meet this target word count.`
      : '';
    
    const prompt = `STRICT INSTRUCTION: Execute ONLY using the content in this text. Use ONLY information from the text below. NO external knowledge, NO author biography, NO publication history, NO cultural reception.

TEXT:
"""
${needsSplitting ? textSlices[0] + "\n\n[...text continues across " + textSlices.length + " sections...]" : text}
"""

OUTLINE:
${outlineJSON}

USER INSTRUCTIONS:
${instructions}${wordCountInstruction}

Execute using ONLY content from the uploaded text. Nothing external.`;

    try {
      const output = await callLLM(provider, prompt);
      finalParts.push(output.trim());
    } catch (error: any) {
      finalParts.push(`[Error: ${error.message}]`);
    }
  }

  onProgress?.({ stage: "complete", message: `Complete: ${wordCount.toLocaleString()} words processed` });

  return {
    output: finalParts.join("\n\n---\n\n"),
    outline,
    sectionsProcessed: textSlices.length,
    wordCount
  };
}

export async function runCustomAnalysisWithOutline(
  text: string,
  instructions: string,
  provider: string = "openai",
  onProgress?: (progress: CustomAnalysisProgress) => void,
  desiredWordCount?: number
): Promise<CustomAnalysisResult> {
  return runCustomAnalysis(text, instructions, provider, true, onProgress, desiredWordCount);
}

export async function runCustomAnalysisChunked(
  text: string,
  instructions: string,
  provider: string = "openai",
  onProgress?: (progress: CustomAnalysisProgress) => void,
  desiredWordCount?: number
): Promise<CustomAnalysisResult> {
  return runCustomAnalysis(text, instructions, provider, false, onProgress, desiredWordCount);
}
