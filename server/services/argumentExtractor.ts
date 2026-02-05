import { callLLM } from "../llm";
import { generateOutline, Outline, Section as OutlineSection } from "./outlineService";

export interface ExtractedArgument {
  author: string;
  premises: string[];
  conclusion: string;
  source: string;
  counterarguments?: string[];
  importance?: number;
  sectionIndex?: number;
  argumentType?: string;
}

export interface ArgumentExtractionProgress {
  stage: "outlining" | "extracting" | "deduplicating" | "complete" | "error";
  message: string;
  current?: number;
  total?: number;
}

export interface ArgumentExtractionResult {
  arguments: ExtractedArgument[];
  outline?: Outline;
  totalExtracted: number;
  duplicatesRemoved: number;
  mode: "outline" | "chunk";
  errors?: string[];
  failedSections?: number;
}

const EXHAUSTIVE_SYSTEM_PROMPT = `You are a thorough, exhaustive argument extractor. Your task is to extract EVERY meaningful argument from the text with complete premise chains and conclusions.

CRITICAL REQUIREMENTS:
1. Be EXHAUSTIVE - extract ALL arguments, explicit and implicit
2. Use VERBATIM quotes from the text for premises and conclusions wherever possible
3. Include FULL premise chains - do not summarize or shorten
4. Capture nested arguments (arguments supporting other arguments)
5. Identify the argument TYPE (deductive, inductive, analogical, causal, etc.)
6. Note counterarguments the author addresses
7. Miss NOTHING important - better to over-extract than under-extract
8. NO summaries - only extract actual argumentative content

ARGUMENT TYPES TO LOOK FOR:
- Main thesis arguments
- Supporting sub-arguments
- Definitional arguments
- Causal claims
- Comparative/analogical reasoning
- Appeals to authority/evidence
- Reductio ad absurdum
- Conditional arguments
- Dilemmas and alternatives`;

async function callLLMWithJSON(provider: string, systemPrompt: string, userPrompt: string): Promise<any> {
  const fullPrompt = `${systemPrompt}\n\n${userPrompt}\n\nIMPORTANT: You must respond with valid JSON only. No markdown, no extra text.`;
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

function sliceTextBySections(text: string, sections: OutlineSection[]): { section: OutlineSection; content: string; startApprox: number; endApprox: number }[] {
  const words = text.split(/\s+/);
  const result: { section: OutlineSection; content: string; startApprox: number; endApprox: number }[] = [];
  
  let currentWordIndex = 0;
  
  for (const section of sections) {
    const sectionWordCount = section.wordCount || Math.floor(words.length / sections.length);
    const startIndex = currentWordIndex;
    const endIndex = Math.min(currentWordIndex + sectionWordCount, words.length);
    
    const sectionWords = words.slice(startIndex, endIndex);
    const content = sectionWords.join(" ");
    
    result.push({
      section,
      content,
      startApprox: startIndex,
      endApprox: endIndex
    });
    
    currentWordIndex = endIndex;
  }
  
  return result;
}

function deduplicateArguments(args: ExtractedArgument[]): { deduplicated: ExtractedArgument[]; removed: number } {
  const seen = new Set<string>();
  const deduplicated: ExtractedArgument[] = [];
  let removed = 0;
  
  for (const arg of args) {
    // Use conclusion + first premise for better deduplication
    const premiseKey = arg.premises.length > 0 ? arg.premises[0].toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 50) : "";
    const conclusionKey = arg.conclusion.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 80);
    const key = conclusionKey + premiseKey;
    
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(arg);
    } else {
      removed++;
    }
  }
  
  return { deduplicated, removed };
}

function calculateTargetArgs(depth: number, sectionWordCount: number): { min: number; max: number } {
  // Base: depth 1 = 2-4 args, depth 10 = 15-25 args per section
  const baseMin = Math.max(2, Math.floor(depth * 1.5));
  const baseMax = Math.max(4, Math.floor(depth * 2.5));
  
  // Scale with section size (more words = more potential arguments)
  const sizeFactor = Math.max(1, sectionWordCount / 2000);
  
  return {
    min: Math.floor(baseMin * sizeFactor),
    max: Math.floor(baseMax * sizeFactor)
  };
}

export async function extractArgumentsWithOutline(
  text: string,
  author: string,
  provider: string = "openai",
  onProgress?: (progress: ArgumentExtractionProgress) => void,
  depth: number = 7
): Promise<ArgumentExtractionResult> {
  // Clamp depth to 1-10
  depth = Math.max(1, Math.min(10, depth));
  
  const wordCount = text.split(/\s+/).length;
  const depthLabel = depth >= 8 ? "deep mode" : depth >= 5 ? "standard mode" : "quick mode";
  
  onProgress?.({ stage: "outlining", message: `Generating structured outline (${depthLabel})...` });

  let outline: Outline;
  try {
    outline = await generateOutline(text.substring(0, 150000));
  } catch (error: any) {
    onProgress?.({ stage: "error", message: `Failed to generate outline: ${error.message}` });
    throw error;
  }

  if (!outline.sections || outline.sections.length === 0) {
    onProgress?.({ stage: "error", message: "Outline generation returned no sections" });
    throw new Error("Outline generation returned no sections");
  }

  onProgress?.({ 
    stage: "outlining", 
    message: `Outline complete: ${outline.sections.length} sections. Beginning exhaustive extraction...` 
  });

  const slicedSections = sliceTextBySections(text, outline.sections);
  const allArguments: ExtractedArgument[] = [];
  const extractionErrors: string[] = [];
  let failedSectionCount = 0;
  
  // Create outline summary for context
  const outlineJSON = JSON.stringify({
    summary: outline.taskSummary,
    sections: outline.sections.map(s => ({ title: s.title, themes: s.keyThemes }))
  });

  for (let i = 0; i < slicedSections.length; i++) {
    const { section, content } = slicedSections[i];
    const sectionWordCount = content.split(/\s+/).length;

    onProgress?.({ 
      stage: "extracting", 
      message: `Extracting arguments from section ${i + 1}/${slicedSections.length}: "${section.title}" (${depthLabel})...`,
      current: i + 1,
      total: slicedSections.length
    });

    if (content.trim().length < 100) continue;

    const { min: minArgs, max: maxArgs } = calculateTargetArgs(depth, sectionWordCount);

    const extractPrompt = `From this section and the full document outline, extract ALL meaningful arguments with DETAILED premises, conclusions, and source information.

FULL DOCUMENT OUTLINE (for context):
${outlineJSON}

CURRENT SECTION (${i + 1}/${slicedSections.length}): "${section.title}"
Section Description: ${section.description}
Key Themes: ${section.keyThemes.join(", ")}

SECTION TEXT:
"""
${content}
"""

EXTRACTION REQUIREMENTS:
1. Extract ${minArgs}-${maxArgs} arguments from this section (be exhaustive!)
2. Use VERBATIM quotes for premises and conclusions where possible
3. Include COMPLETE premise chains - do not omit any supporting reasons
4. Capture both explicit arguments and implicit/underlying arguments
5. Identify argument type (deductive, inductive, causal, analogical, etc.)
6. Note any counterarguments the author addresses
7. Rate importance: 10 = central thesis argument, 7-9 = major supporting, 4-6 = secondary, 1-3 = minor
8. Use full document context to identify which arguments are most significant

FORMAT (Author: ${author}):
{
  "arguments": [
    {
      "author": "${author}",
      "premises": [
        "First premise - EXACT quote or close paraphrase from text",
        "Second premise - another supporting reason",
        "Third premise if applicable"
      ],
      "conclusion": "The claim these premises support - VERBATIM if possible",
      "source": "${section.title}",
      "argumentType": "deductive|inductive|causal|analogical|etc",
      "counterarguments": ["Any counterargument author addresses (optional)"],
      "importance": 1-10
    }
  ]
}

IMPORTANT: Extract ${minArgs}-${maxArgs} arguments. Include long reasoning chains. Miss nothing important. Be thorough and exhaustive.`;

    try {
      const sectionResult = await callLLMWithJSON(provider, EXHAUSTIVE_SYSTEM_PROMPT, extractPrompt);
      const args = sectionResult.arguments || [];
      
      for (const arg of args) {
        if (arg.conclusion && arg.conclusion.trim().length > 10) {
          allArguments.push({
            author: author,
            premises: Array.isArray(arg.premises) ? arg.premises.filter((p: string) => p && p.trim()) : [],
            conclusion: arg.conclusion.trim(),
            source: section.title,
            argumentType: arg.argumentType || undefined,
            counterarguments: Array.isArray(arg.counterarguments) ? arg.counterarguments.filter((c: string) => c && c.trim()) : undefined,
            importance: arg.importance || 5,
            sectionIndex: i
          });
        }
      }
    } catch (error: any) {
      failedSectionCount++;
      const errorMsg = error.message || String(error);
      console.error(`Failed to extract arguments from section "${section.title}":`, error);
      extractionErrors.push(`Section "${section.title}": ${errorMsg}`);
      
      // Check if it's a critical API error (rate limit, credits exhausted)
      if (errorMsg.includes('429') || errorMsg.includes('credits') || errorMsg.includes('exhausted') || errorMsg.includes('limit')) {
        onProgress?.({ 
          stage: "error", 
          message: `API Error: ${errorMsg.substring(0, 200)}` 
        });
      }
    }

    // Small delay between sections
    if (i < slicedSections.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  onProgress?.({ stage: "deduplicating", message: `De-duplicating ${allArguments.length} extracted arguments...` });
  
  const { deduplicated, removed } = deduplicateArguments(allArguments);
  
  // Sort by section order, then by importance within section
  const sorted = deduplicated.sort((a, b) => {
    if (a.sectionIndex !== b.sectionIndex) {
      return (a.sectionIndex || 0) - (b.sectionIndex || 0);
    }
    return (b.importance || 5) - (a.importance || 5);
  });

  // If all sections failed, report an error
  if (failedSectionCount === slicedSections.length && slicedSections.length > 0) {
    const firstError = extractionErrors[0] || "All sections failed to extract";
    onProgress?.({ 
      stage: "error", 
      message: `Extraction failed: ${firstError}` 
    });
  } else {
    onProgress?.({ 
      stage: "complete", 
      message: `Extraction complete: ${sorted.length} unique arguments (${removed} duplicates removed, ${depthLabel})${failedSectionCount > 0 ? ` - ${failedSectionCount} sections failed` : ''}` 
    });
  }

  return {
    arguments: sorted,
    outline,
    totalExtracted: allArguments.length,
    duplicatesRemoved: removed,
    mode: "outline",
    errors: extractionErrors.length > 0 ? extractionErrors : undefined,
    failedSections: failedSectionCount > 0 ? failedSectionCount : undefined
  };
}

export async function extractArgumentsChunked(
  text: string,
  author: string,
  provider: string = "openai",
  onProgress?: (progress: ArgumentExtractionProgress) => void,
  depth: number = 7
): Promise<ArgumentExtractionResult> {
  depth = Math.max(1, Math.min(10, depth));
  const depthLabel = depth >= 8 ? "deep mode" : depth >= 5 ? "standard mode" : "quick mode";
  
  const CHUNK_SIZE = 4000;
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  
  for (let i = 0; i < words.length; i += CHUNK_SIZE) {
    chunks.push(words.slice(i, i + CHUNK_SIZE).join(" "));
  }

  const allArguments: ExtractedArgument[] = [];
  const { min: minArgs, max: maxArgs } = calculateTargetArgs(depth, CHUNK_SIZE);

  for (let i = 0; i < chunks.length; i++) {
    onProgress?.({
      stage: "extracting",
      message: `Extracting arguments from chunk ${i + 1}/${chunks.length} (${depthLabel})...`,
      current: i + 1,
      total: chunks.length
    });

    const chunk = chunks[i];
    if (chunk.trim().length < 100) continue;

    const extractPrompt = `Extract ALL meaningful arguments from this text with COMPLETE premise chains.

TEXT:
"""
${chunk}
"""

EXTRACTION REQUIREMENTS:
1. Extract ${minArgs}-${maxArgs} arguments from this chunk
2. Use VERBATIM quotes where possible
3. Include COMPLETE premise chains
4. Capture explicit and implicit arguments
5. Rate importance: 10 = central, 7-9 = major, 4-6 = secondary, 1-3 = minor

FORMAT:
{
  "arguments": [
    {
      "author": "${author}",
      "premises": ["First premise - exact text", "Second premise"],
      "conclusion": "The main claim - verbatim if possible",
      "source": "Chunk ${i + 1}",
      "argumentType": "deductive|inductive|causal|analogical|etc",
      "counterarguments": ["Any counterargument (optional)"],
      "importance": 1-10
    }
  ]
}

Extract ${minArgs}-${maxArgs} arguments. Be exhaustive.`;

    try {
      const result = await callLLMWithJSON(provider, EXHAUSTIVE_SYSTEM_PROMPT, extractPrompt);
      const args = result.arguments || [];
      
      for (const arg of args) {
        if (arg.conclusion && arg.conclusion.trim().length > 10) {
          allArguments.push({
            author: author,
            premises: Array.isArray(arg.premises) ? arg.premises.filter((p: string) => p && p.trim()) : [],
            conclusion: arg.conclusion.trim(),
            source: arg.source || `Chunk ${i + 1}`,
            argumentType: arg.argumentType || undefined,
            counterarguments: Array.isArray(arg.counterarguments) ? arg.counterarguments.filter((c: string) => c && c.trim()) : undefined,
            importance: arg.importance || 5,
            sectionIndex: i
          });
        }
      }
    } catch (error) {
      console.error(`Failed to extract arguments from chunk ${i + 1}:`, error);
    }

    if (i < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  onProgress?.({ stage: "deduplicating", message: `De-duplicating ${allArguments.length} arguments...` });
  
  const { deduplicated, removed } = deduplicateArguments(allArguments);

  onProgress?.({ 
    stage: "complete", 
    message: `Extraction complete: ${deduplicated.length} arguments (${depthLabel})` 
  });

  return {
    arguments: deduplicated,
    totalExtracted: allArguments.length,
    duplicatesRemoved: removed,
    mode: "chunk"
  };
}

export function formatArgumentsAsMarkdown(args: ExtractedArgument[]): string {
  if (args.length === 0) {
    return "No arguments extracted.";
  }

  let markdown = `# Extracted Arguments (${args.length} total)\n\n`;
  
  let currentSection = "";
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.source !== currentSection) {
      currentSection = arg.source;
      markdown += `## ${currentSection}\n\n`;
    }
    
    markdown += `### Argument ${i + 1}`;
    if (arg.argumentType) {
      markdown += ` (${arg.argumentType})`;
    }
    markdown += `\n`;
    markdown += `**Author:** ${arg.author}\n\n`;
    markdown += `**Premises:**\n`;
    for (const premise of arg.premises) {
      markdown += `- ${premise}\n`;
    }
    markdown += `\n**→ Conclusion:** ${arg.conclusion}\n\n`;
    
    if (arg.counterarguments && arg.counterarguments.length > 0) {
      markdown += `**Counterarguments addressed:**\n`;
      for (const counter of arg.counterarguments) {
        markdown += `- ${counter}\n`;
      }
      markdown += "\n";
    }
    
    markdown += `*Source: ${arg.source} | Importance: ${arg.importance || "N/A"}/10*\n\n`;
    markdown += "---\n\n";
  }
  
  return markdown;
}
