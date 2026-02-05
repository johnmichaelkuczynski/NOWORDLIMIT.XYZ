import { callLLM } from "../llm";
import { generateOutline, Outline, Section as OutlineSection } from "./outlineService";

export interface ExtractedQuote {
  author: string;
  quote: string;
  topic: string;
  sectionIndex?: number;
}

export interface QuoteExtractionProgress {
  stage: "summarizing" | "outlining" | "extracting" | "deduplicating" | "complete" | "error";
  message: string;
  current?: number;
  total?: number;
}

export interface HolisticQuoteResult {
  quotes: ExtractedQuote[];
  summary: string;
  totalExtracted: number;
  duplicatesRemoved: number;
  mode: "outline" | "chunk";
}

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

function deduplicateQuotes(quotes: ExtractedQuote[]): ExtractedQuote[] {
  const seen = new Set<string>();
  const unique: ExtractedQuote[] = [];
  
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
  
  unique.sort((a, b) => (a.sectionIndex ?? 0) - (b.sectionIndex ?? 0));
  return unique;
}

export async function extractQuotesWithOutline(
  text: string,
  provider: string = "openai",
  author: string,
  onProgress?: (progress: QuoteExtractionProgress) => void,
  depth: number = 5
): Promise<HolisticQuoteResult> {
  // Clamp depth to 1-10
  depth = Math.max(1, Math.min(10, depth));
  onProgress?.({ stage: "summarizing", message: "Analyzing full text structure..." });
  await new Promise(resolve => setTimeout(resolve, 100));
  onProgress?.({ stage: "outlining", message: "Generating structured outline of full text..." });

  let outline: Outline;
  try {
    outline = await generateOutline(text.substring(0, 100000));
    if (!outline.sections || outline.sections.length === 0) {
      throw new Error("Outline generation returned no sections");
    }
  } catch (error: any) {
    onProgress?.({ stage: "outlining", message: `Outline failed, falling back to chunk mode...` });
    return extractQuotesChunked(text, provider, author, onProgress, depth);
  }

  onProgress?.({ 
    stage: "outlining", 
    message: `Outline complete: ${outline.sections.length} sections identified. Extracting quotes...` 
  });

  const slicedSections = sliceTextBySections(text, outline.sections);
  const allQuotes: ExtractedQuote[] = [];
  
  for (let i = 0; i < slicedSections.length; i++) {
    const { section, content } = slicedSections[i];

    onProgress?.({ 
      stage: "extracting", 
      message: `Extracting from section ${i + 1}/${slicedSections.length}: "${section.title}"...`,
      current: i + 1,
      total: slicedSections.length
    });

    if (content.trim().length < 100) continue;

    // Calculate quote target based on density (depth 1=minimal, 10=maximum)
    const minQuotes = Math.max(3, depth * 2);
    const maxQuotes = Math.max(10, depth * 8);
    const densityLabel = depth >= 8 ? "exhaustive - capture every statement" : 
                        depth >= 5 ? "thorough - capture most important statements" : 
                        "focused - only the most significant quotes";

    const extractPrompt = `You are an expert quote extractor. Extract meaningful direct quotes from this section.

⚠️ CRITICAL: VERBATIM EXTRACTION ONLY ⚠️
- Copy the EXACT WORDS from the text - no additions, no paraphrases
- Each quote must appear EXACTLY as written in the source
- Preserve the exact punctuation and wording from the original
- If you cannot find an exact quote, skip it entirely

GLOBAL CONTEXT:
Document Summary: ${outline.taskSummary}
All Sections: ${outline.sections.map(s => s.title).join(", ")}

CURRENT SECTION (${i + 1}/${slicedSections.length}): "${section.title}"
Section Description: ${section.description}
Key Themes: ${section.keyThemes.join(", ")}

SECTION TEXT:
"""
${content}
"""

EXTRACTION DENSITY: ${densityLabel}
TARGET: Extract ${minQuotes}-${maxQuotes} quotes from this section.

EXTRACTION RULES:
1. Extract meaningful direct quotes - statements, claims, definitions, arguments
2. Use "${author}" as the author for all quotes
3. Use the section title "${section.title}" as the topic
4. Copy the exact text word-for-word from the source
5. Minimum 10 words per quote for meaningful content

OUTPUT FORMAT:
{
  "quotes": [
    {
      "author": "${author}",
      "quote": "exact verbatim text from source",
      "topic": "${section.title}"
    }
  ]
}`;

    try {
      const sectionResult = await callLLMWithJSON(provider, extractPrompt);
      const quotes = sectionResult.quotes || [];
      
      for (const q of quotes) {
        if (q.quote && q.quote.trim().length > 20) {
          allQuotes.push({
            author: author,
            quote: q.quote.trim(),
            topic: section.title,
            sectionIndex: i
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

  onProgress?.({ 
    stage: "deduplicating", 
    message: `De-duplicating ${allQuotes.length} extracted quotes...` 
  });

  const uniqueQuotes = deduplicateQuotes(allQuotes);
  const duplicatesRemoved = allQuotes.length - uniqueQuotes.length;

  onProgress?.({ 
    stage: "complete", 
    message: `Extraction complete. ${uniqueQuotes.length} unique quotes found (${duplicatesRemoved} duplicates removed).` 
  });

  return {
    quotes: uniqueQuotes,
    summary: outline.taskSummary,
    totalExtracted: allQuotes.length,
    duplicatesRemoved,
    mode: "outline"
  };
}

export async function extractQuotesChunked(
  text: string,
  provider: string = "openai",
  author: string,
  onProgress?: (progress: QuoteExtractionProgress) => void,
  depth: number = 5
): Promise<HolisticQuoteResult> {
  // Clamp depth to 1-10
  depth = Math.max(1, Math.min(10, depth));
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  
  onProgress?.({ stage: "summarizing", message: "Analyzing text for context (chunk mode)..." });

  const chunkSize = Math.ceil(text.length / Math.max(1, Math.ceil(wordCount / 2000)));
  const numChunks = Math.ceil(text.length / chunkSize);
  
  onProgress?.({ 
    stage: "extracting", 
    message: `Processing ${numChunks} chunks...`,
    current: 0,
    total: numChunks
  });

  const allQuotes: ExtractedQuote[] = [];
  
  for (let i = 0; i < numChunks; i++) {
    onProgress?.({ 
      stage: "extracting", 
      message: `Extracting from chunk ${i + 1}/${numChunks}...`,
      current: i + 1,
      total: numChunks
    });

    const chunkStart = i * chunkSize;
    const chunkEnd = Math.min((i + 1) * chunkSize, text.length);
    const chunkText = text.substring(chunkStart, chunkEnd);
    
    if (chunkText.trim().length < 50) continue;

    // Calculate quote target based on density
    const minQuotes = Math.max(3, depth * 2);
    const maxQuotes = Math.max(10, depth * 8);
    const densityLabel = depth >= 8 ? "exhaustive" : depth >= 5 ? "thorough" : "focused";

    const extractPrompt = `Extract meaningful direct quotes from this text. Extraction mode: ${densityLabel}.

⚠️ VERBATIM EXTRACTION ONLY - copy exact words, no paraphrasing ⚠️

TEXT:
"""
${chunkText}
"""

Extract ${minQuotes}-${maxQuotes} quotes. Output JSON:
{
  "quotes": [
    {
      "author": "${author}",
      "quote": "exact verbatim text from source",
      "topic": "Topic/Theme"
    }
  ]
}`;

    try {
      const result = await callLLMWithJSON(provider, extractPrompt);
      for (const q of (result.quotes || [])) {
        if (q.quote && q.quote.trim().length > 20) {
          allQuotes.push({
            author: author,
            quote: q.quote.trim(),
            topic: q.topic || `Part ${i + 1}`,
            sectionIndex: i
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

  onProgress?.({ stage: "deduplicating", message: "De-duplicating quotes..." });
  
  const uniqueQuotes = deduplicateQuotes(allQuotes);

  onProgress?.({ 
    stage: "complete", 
    message: `Found ${uniqueQuotes.length} unique quotes.` 
  });

  return {
    quotes: uniqueQuotes,
    summary: "",
    totalExtracted: allQuotes.length,
    duplicatesRemoved: allQuotes.length - uniqueQuotes.length,
    mode: "chunk"
  };
}

export async function extractQuotesHolistic(
  text: string,
  provider: string = "openai",
  author: string,
  onProgress?: (progress: QuoteExtractionProgress) => void,
  useOutlineMode: boolean = true,
  depth: number = 5
): Promise<HolisticQuoteResult> {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  
  if (wordCount < 500) {
    onProgress?.({ stage: "summarizing", message: "Text is short, using direct extraction..." });
    return extractQuotesChunked(text, provider, author, onProgress, depth);
  }
  
  if (wordCount < 1500 && !useOutlineMode) {
    return extractQuotesChunked(text, provider, author, onProgress, depth);
  }
  
  if (useOutlineMode) {
    return extractQuotesWithOutline(text, provider, author, onProgress, depth);
  }
  
  return extractQuotesChunked(text, provider, author, onProgress, depth);
}

export function formatQuotesForDisplay(quotes: ExtractedQuote[]): string {
  if (quotes.length === 0) return "No quotes extracted.";
  
  let output = "";
  for (let i = 0; i < quotes.length; i++) {
    const q = quotes[i];
    output += `${i + 1}. ${q.author} | ${q.quote} | ${q.topic}\n`;
  }
  return output;
}
