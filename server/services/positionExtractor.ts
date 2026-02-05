import { callLLM } from "../llm";
import { generateOutline, Outline, Section as OutlineSection } from "./outlineService";

export interface Section {
  title: string;
  startApprox: number;
  endApprox: number;
  content?: string;
}

export interface ExtractedPosition {
  author: string;
  quote: string;
  source: string;
  importance?: number;
  sectionIndex?: number;
}

export interface ExtractionProgress {
  stage: "summarizing" | "outlining" | "extracting" | "deduplicating" | "complete" | "error";
  message: string;
  current?: number;
  total?: number;
}

export interface HolisticExtractionResult {
  positions: ExtractedPosition[];
  summary: string;
  sections: Section[];
  outline?: Outline;
  totalExtracted: number;
  duplicatesRemoved: number;
  mode: "outline" | "chunk";
}

async function callLLMWithJSON(provider: string, prompt: string): Promise<any> {
  const fullPrompt = prompt + "\n\nIMPORTANT: You must respond with valid JSON only. No markdown, no extra text.";
  console.log(`[callLLMWithJSON] Calling ${provider} with prompt length: ${prompt.length}`);
  const content = await callLLM(provider, fullPrompt);
  console.log(`[callLLMWithJSON] Got response, length: ${content.length}, preview: ${content.substring(0, 200)}`);
  
  try {
    const parsed = JSON.parse(content);
    console.log(`[callLLMWithJSON] Parsed JSON successfully, keys: ${Object.keys(parsed).join(', ')}`);
    return parsed;
  } catch (e) {
    console.log(`[callLLMWithJSON] Direct JSON parse failed, trying markdown extraction`);
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      console.log(`[callLLMWithJSON] Markdown extraction succeeded, keys: ${Object.keys(parsed).join(', ')}`);
      return parsed;
    }
    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      const parsed = JSON.parse(objectMatch[0]);
      console.log(`[callLLMWithJSON] Object extraction succeeded, keys: ${Object.keys(parsed).join(', ')}`);
      return parsed;
    }
    console.error(`[callLLMWithJSON] All parsing failed. Content: ${content.substring(0, 500)}`);
    throw new Error("Failed to parse LLM response as JSON");
  }
}

function calculateTargetPositions(wordCount: number, depth: number, sectionCount: number): { perSection: number; total: number } {
  const basePerSection = 15;
  const depthMultiplier = 1 + (depth - 1) * 0.35;
  const sizeMultiplier = Math.max(1, Math.log10(wordCount / 1000) * 0.8);
  
  let perSection = Math.round(basePerSection * depthMultiplier * sizeMultiplier);
  
  if (depth >= 8) {
    perSection = Math.max(perSection, 45);
  }
  if (depth >= 9) {
    perSection = Math.max(perSection, 60);
  }
  if (depth === 10) {
    perSection = Math.max(perSection, 75);
  }
  
  perSection = Math.min(perSection, 90);
  
  const total = perSection * sectionCount;
  
  return { perSection, total };
}

function calculateMinimumPositions(wordCount: number, depth: number): number {
  const pages = wordCount / 250;
  
  if (depth <= 3) {
    return Math.min(150, Math.max(45, Math.floor(pages * 0.3)));
  } else if (depth <= 5) {
    return Math.min(300, Math.max(90, Math.floor(pages * 0.45)));
  } else if (depth <= 7) {
    return Math.min(600, Math.max(150, Math.floor(pages * 0.6)));
  } else if (depth <= 9) {
    return Math.min(1200, Math.max(300, Math.floor(pages * 0.9)));
  } else {
    return Math.min(1800, Math.max(600, Math.floor(pages * 1.2)));
  }
}

export async function extractPositionsWithOutline(
  text: string,
  provider: string = "openai",
  onProgress?: (progress: ExtractionProgress) => void,
  providedAuthor?: string,
  depth: number = 8
): Promise<HolisticExtractionResult> {
  console.log(`[PositionExtractor] Starting extraction with depth=${depth}, author=${providedAuthor}, textLength=${text.length}`);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const pages = Math.round(wordCount / 250);
  console.log(`[PositionExtractor] Word count: ${wordCount}, pages: ${pages}`);
  
  onProgress?.({ stage: "summarizing", message: "Analyzing full text structure..." });
  await new Promise(resolve => setTimeout(resolve, 100));
  onProgress?.({ stage: "outlining", message: "Outlining full text..." });

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

  const { perSection, total: targetTotal } = calculateTargetPositions(wordCount, depth, outline.sections.length);
  const minimumRequired = calculateMinimumPositions(wordCount, depth);

  onProgress?.({ 
    stage: "outlining", 
    message: `Outline complete: ${outline.sections.length} sections. Target: ~${Math.min(targetTotal, minimumRequired)} positions (depth ${depth})...` 
  });

  const slicedSections = sliceTextBySections(text, outline.sections);
  console.log(`[PositionExtractor] Sliced into ${slicedSections.length} sections`);
  for (let i = 0; i < Math.min(3, slicedSections.length); i++) {
    console.log(`[PositionExtractor] Section ${i+1}: "${slicedSections[i].section.title}", content length: ${slicedSections[i].content.length}`);
  }
  const mainAuthor = providedAuthor || await inferMainAuthor(text.substring(0, 5000), provider);
  console.log(`[PositionExtractor] Using author: "${mainAuthor}"`);

  const outlineJSON = JSON.stringify({
    summary: outline.taskSummary,
    sections: outline.sections.map(s => ({ title: s.title, themes: s.keyThemes }))
  }, null, 2);

  let allPositions: ExtractedPosition[] = [];
  const legacySections: Section[] = [];
  let passNumber = 1;
  const absoluteMaxPasses = depth >= 9 ? 4 : (depth >= 7 ? 3 : 2);
  let currentPerSection = perSection;
  
  while (passNumber <= absoluteMaxPasses) {
    const passPositions: ExtractedPosition[] = [];
    
    for (let i = 0; i < slicedSections.length; i++) {
      const { section, content, startApprox, endApprox } = slicedSections[i];
      
      if (passNumber === 1) {
        legacySections.push({
          title: section.title,
          startApprox,
          endApprox,
          content: content.substring(0, 500) + "..."
        });
      }

      onProgress?.({ 
        stage: "extracting", 
        message: `Extracting positions from section ${i + 1}/${slicedSections.length} (depth ${depth})${passNumber > 1 ? ` [pass ${passNumber}]` : ""}...`,
        current: i + 1,
        total: slicedSections.length
      });

      if (content.trim().length < 100) continue;

      const exhaustiveGuidance = depth >= 7 ? `
EXHAUSTIVE MODE (depth ${depth}/10):
- Extract ${currentPerSection}-${currentPerSection + 10} positions from this section
- Include ALL: major theses, supporting claims, examples, conclusions, predictions, recommendations
- Do not skip "minor" positions - everything matters for comprehensiveness
- Be thorough: every meaningful claim or insight should be captured` : "";

      const extractPrompt = `You are an exhaustive position extractor. Extract EVERY meaningful position/insight/claim in exact format. No omissions, no paraphrases — verbatim from text. Use global context to prioritize deep/unique ones.

GLOBAL CONTEXT (full document outline):
${outlineJSON}

CURRENT SECTION (${i + 1}/${slicedSections.length}): "${section.title}"
Section Description: ${section.description}
Key Themes: ${section.keyThemes.join(", ")}
${exhaustiveGuidance}

SECTION TEXT:
"""
${content}
"""

EXTRACTION RULES:
1. Extract ${currentPerSection}-${currentPerSection + 10} positions from this section
2. VERBATIM ONLY: Copy EXACT words from the text - no additions, no paraphrases, no rewording
3. Include: philosophical claims, factual assertions, value judgments, predictions, recommendations, conclusions
4. Rate importance: 10 = central thesis, 7-9 = major argument, 4-6 = supporting claim, 1-3 = minor insight
5. Use "${section.title}" as source

OUTPUT FORMAT:
{
  "positions": [
    {
      "author": "${mainAuthor}",
      "quote": "EXACT VERBATIM TEXT - word for word from source",
      "source": "${section.title}",
      "importance": 1-10
    }
  ]
}

Extract ${currentPerSection}+ positions. Be exhaustive — cover every insight.`;

      try {
        console.log(`[PositionExtractor] Extracting from section ${i+1}: "${section.title}", content length: ${content.length}`);
        const sectionResult = await callLLMWithJSON(provider, extractPrompt);
        const positions = sectionResult.positions || [];
        console.log(`[PositionExtractor] Section ${i+1} returned ${positions.length} positions`);
        
        for (const pos of positions) {
          if (pos.quote && pos.quote.trim().length > 10) {
            passPositions.push({
              author: mainAuthor,
              quote: pos.quote.trim(),
              source: section.title,
              importance: pos.importance || 5,
              sectionIndex: i
            });
          }
        }
      } catch (error) {
        console.error(`[PositionExtractor] Failed to extract from section "${section.title}":`, error);
      }

      if (i < slicedSections.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    allPositions = [...allPositions, ...passPositions];
    console.log(`[PositionExtractor] Pass ${passNumber} complete: ${passPositions.length} positions this pass, ${allPositions.length} total`);
    
    const currentUnique = deduplicatePositions(allPositions);
    console.log(`[PositionExtractor] After dedup: ${currentUnique.length} unique (need ${minimumRequired} minimum)`);
    
    if (currentUnique.length >= minimumRequired || passNumber >= absoluteMaxPasses) {
      break;
    }
    
    currentPerSection = Math.min(105, currentPerSection + 15);
    
    onProgress?.({ 
      stage: "extracting", 
      message: `Pass ${passNumber}: ${currentUnique.length} positions found. Running pass ${passNumber + 1} (boosted to ${currentPerSection}/section)...` 
    });
    
    passNumber++;
  }

  onProgress?.({ 
    stage: "deduplicating", 
    message: `De-duplicating ${allPositions.length} found...` 
  });

  const uniquePositions = deduplicatePositions(allPositions);
  const duplicatesRemoved = allPositions.length - uniquePositions.length;

  const targetMet = uniquePositions.length >= minimumRequired;
  const resultMessage = targetMet 
    ? `Extraction complete: ${uniquePositions.length} unique positions (${duplicatesRemoved} duplicates removed, ~${pages} pages, depth ${depth})`
    : `Extraction complete: ${uniquePositions.length} unique positions after ${passNumber} passes (~${pages} pages, depth ${depth})`;
  
  onProgress?.({ 
    stage: "complete", 
    message: resultMessage
  });

  return {
    positions: uniquePositions,
    summary: outline.taskSummary,
    sections: legacySections,
    outline,
    totalExtracted: allPositions.length,
    duplicatesRemoved,
    mode: "outline"
  };
}

export async function extractPositionsChunked(
  text: string,
  provider: string = "openai",
  onProgress?: (progress: ExtractionProgress) => void,
  providedAuthor?: string,
  depth: number = 5
): Promise<HolisticExtractionResult> {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  
  if (wordCount > 5000) {
    onProgress?.({ stage: "summarizing", message: "Large text detected. Switching to outline mode for exhaustive extraction..." });
    return extractPositionsWithOutline(text, provider, onProgress, providedAuthor, depth);
  }
  
  onProgress?.({ stage: "summarizing", message: "Analyzing text for context (chunk mode)..." });

  const chunkSize = Math.ceil(text.length / Math.max(1, Math.ceil(wordCount / 2000)));
  const sections: Section[] = [];
  const numChunks = Math.ceil(text.length / chunkSize);
  
  for (let i = 0; i < numChunks; i++) {
    sections.push({
      title: `Part ${i + 1}`,
      startApprox: i * chunkSize,
      endApprox: Math.min((i + 1) * chunkSize, text.length)
    });
  }

  onProgress?.({ 
    stage: "extracting", 
    message: `Processing ${sections.length} chunks...`,
    current: 0,
    total: sections.length
  });

  const allPositions: ExtractedPosition[] = [];
  
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    onProgress?.({ 
      stage: "extracting", 
      message: `Extracting from chunk ${i + 1}/${sections.length}...`,
      current: i + 1,
      total: sections.length
    });

    const sectionText = text.substring(section.startApprox, section.endApprox);
    if (sectionText.trim().length < 50) continue;

    const extractPrompt = `Extract ALL meaningful positions and claims from this text.

⚠️ VERBATIM EXTRACTION ONLY - copy exact words, no paraphrasing ⚠️

TEXT:
"""
${sectionText}
"""

Output JSON:
{
  "positions": [
    {
      "author": "Author name or Unknown",
      "quote": "EXACT VERBATIM TEXT",
      "source": "Topic/Theme",
      "importance": 1-10
    }
  ]
}`;

    try {
      const result = await callLLMWithJSON(provider, extractPrompt);
      for (const pos of (result.positions || [])) {
        if (pos.quote && pos.quote.trim().length > 10) {
          allPositions.push({
            author: providedAuthor || "Unknown",
            quote: pos.quote.trim(),
            source: pos.source || section.title,
            importance: pos.importance || 5
          });
        }
      }
    } catch (error) {
      console.error(`Failed to extract from chunk ${i + 1}:`, error);
    }

    if (i < sections.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  onProgress?.({ stage: "deduplicating", message: "De-duplicating positions..." });
  
  const uniquePositions = deduplicatePositions(allPositions);

  onProgress?.({ 
    stage: "complete", 
    message: `Found ${uniquePositions.length} unique positions.` 
  });

  return {
    positions: uniquePositions,
    summary: "",
    sections,
    totalExtracted: allPositions.length,
    duplicatesRemoved: allPositions.length - uniquePositions.length,
    mode: "chunk"
  };
}

export async function extractPositionsHolistic(
  text: string,
  provider: string = "openai",
  onProgress?: (progress: ExtractionProgress) => void,
  useOutlineMode: boolean = true,
  providedAuthor?: string,
  depth: number = 8
): Promise<HolisticExtractionResult> {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  
  if (wordCount < 500) {
    onProgress?.({ stage: "summarizing", message: "Text is short, using direct extraction..." });
    return extractPositionsChunked(text, provider, onProgress, providedAuthor, depth);
  }
  
  if (wordCount < 1500 && !useOutlineMode) {
    return extractPositionsChunked(text, provider, onProgress, providedAuthor, depth);
  }
  
  if (useOutlineMode) {
    return extractPositionsWithOutline(text, provider, onProgress, providedAuthor, depth);
  }
  
  return extractPositionsChunked(text, provider, onProgress, providedAuthor, depth);
}

function sliceTextBySections(text: string, sections: OutlineSection[]): Array<{
  section: OutlineSection;
  content: string;
  startApprox: number;
  endApprox: number;
}> {
  const words = text.split(/\s+/).filter(Boolean);
  const totalWords = words.length;
  
  if (sections.length === 0) {
    return [{
      section: { id: "full", title: "Full Document", description: "", keyThemes: [], wordCount: totalWords },
      content: text,
      startApprox: 0,
      endApprox: text.length
    }];
  }
  
  const sectionsWithCounts = sections.map(s => ({
    ...s,
    wordCount: s.wordCount || Math.floor(totalWords / sections.length)
  }));
  const totalOutlineWords = sectionsWithCounts.reduce((sum, s) => sum + s.wordCount, 0);
  
  const result: Array<{section: OutlineSection; content: string; startApprox: number; endApprox: number}> = [];
  let currentWordIndex = 0;
  let charOffset = 0;
  
  for (let i = 0; i < sectionsWithCounts.length; i++) {
    const section = sectionsWithCounts[i];
    const isLastSection = i === sectionsWithCounts.length - 1;
    
    const proportion = totalOutlineWords > 0 ? section.wordCount / totalOutlineWords : 1 / sections.length;
    let estimatedWords = Math.max(1, Math.floor(totalWords * proportion));
    
    if (isLastSection) {
      estimatedWords = totalWords - currentWordIndex;
    }
    
    const startWord = currentWordIndex;
    const endWord = Math.min(currentWordIndex + estimatedWords, totalWords);
    
    const sectionWords = words.slice(startWord, endWord);
    const content = sectionWords.join(" ");
    
    const startApprox = charOffset;
    charOffset += content.length + 1;
    const endApprox = charOffset;
    
    result.push({ 
      section: sections[i],
      content, 
      startApprox, 
      endApprox 
    });
    currentWordIndex = endWord;
  }
  
  return result;
}

async function inferMainAuthor(textStart: string, provider: string): Promise<string> {
  try {
    const result = await callLLMWithJSON(provider, `From this text beginning, identify the main author if mentioned. Output: {"author": "Name or Unknown"}

Text: "${textStart.substring(0, 2000)}"`);
    return result.author || "Unknown";
  } catch {
    return "Unknown";
  }
}

function deduplicatePositions(positions: ExtractedPosition[]): ExtractedPosition[] {
  const seen = new Set<string>();
  const unique: ExtractedPosition[] = [];
  
  for (const pos of positions) {
    const normalized = pos.quote.toLowerCase().trim().replace(/\s+/g, ' ');
    
    if (normalized.length < 15) continue;
    
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
          const idx = unique.findIndex(p => 
            p.quote.toLowerCase().trim().replace(/\s+/g, ' ') === seenQuote
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
      unique.push(pos);
    }
  }
  
  unique.sort((a, b) => {
    const sectionDiff = (a.sectionIndex ?? 0) - (b.sectionIndex ?? 0);
    if (sectionDiff !== 0) return sectionDiff;
    return (b.importance || 5) - (a.importance || 5);
  });
  return unique;
}

export function formatPositionsForDisplay(positions: ExtractedPosition[]): string {
  return positions
    .map((p, i) => `${i + 1}. ${p.author} | "${p.quote}" | ${p.source}`)
    .join("\n\n");
}

export function formatPositionsForCopy(positions: ExtractedPosition[]): string {
  return positions
    .map(p => `${p.author} | ${p.quote} | ${p.source}`)
    .join("\n");
}
