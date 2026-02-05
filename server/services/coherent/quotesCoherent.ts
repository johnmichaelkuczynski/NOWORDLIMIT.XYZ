import { callLLM } from "../../llm";
import { generateSkeleton, DocumentSkeletonData } from "./skeletonGenerator";
import { chunkText } from "./coherenceProcessor";
import { ProgressUpdate } from "./stateSchemas";

export interface ExtractedQuote {
  quote: string;
  context: string;
  significance: string;
  sourceChunk?: number;
}

export interface QuoteExtractionResult {
  documentId: string;
  quotes: ExtractedQuote[];
  skeleton: DocumentSkeletonData;
  totalExtracted: number;
}

export async function quotesCoherent(
  text: string,
  options: { author?: string; depth?: number },
  provider: string,
  onProgress?: (progress: ProgressUpdate) => void,
  userId?: number
): Promise<QuoteExtractionResult> {
  onProgress?.({ phase: "skeleton", message: "Generating document skeleton..." });
  const skeleton = await generateSkeleton(text, provider, userId);

  const chunks = chunkText(text, 1500);
  const allQuotes: ExtractedQuote[] = [];
  const depth = options.depth || 5;

  for (let i = 0; i < chunks.length; i++) {
    onProgress?.({
      phase: "extraction",
      currentChunk: i + 1,
      totalChunks: chunks.length,
      message: `Extracting quotes from chunk ${i + 1} of ${chunks.length}...`
    });

    const sectionContext = skeleton.sections.find(s => s.index === i) || skeleton.sections[0];

    const prompt = `Extract the most significant verbatim quotes from this text.

DOCUMENT CONTEXT:
- Main Thesis: ${skeleton.mainThesis}
- Overarching Theme: ${skeleton.overarchingTheme}
- This Section's Role: ${sectionContext?.role || 'body'}

CHUNK ${i + 1} OF ${chunks.length}:
${chunks[i]}

TASK:
Extract ${depth * 2} quotes that are:
1. REPRESENTATIVE of the document's overall argument
2. Memorable and quotable
3. Central to understanding the thesis: "${skeleton.mainThesis}"

Return JSON array:
[
  {
    "quote": "Exact verbatim quote from the text",
    "context": "Brief description of what the quote is about",
    "significance": "Why this quote matters to the overall argument"
  }
]`;

    try {
      const response = await callLLM(provider, prompt);
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const chunkQuotes = JSON.parse(jsonMatch[0]);
        allQuotes.push(...chunkQuotes.map((q: any) => ({ ...q, sourceChunk: i })));
      }
    } catch (e) {
      console.error(`Failed to extract quotes from chunk ${i}:`, e);
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  const uniqueQuotes = deduplicateQuotes(allQuotes);

  return {
    documentId: skeleton.documentId,
    quotes: uniqueQuotes,
    skeleton: skeleton,
    totalExtracted: allQuotes.length
  };
}

function deduplicateQuotes(quotes: ExtractedQuote[]): ExtractedQuote[] {
  const seen = new Set<string>();
  const unique: ExtractedQuote[] = [];

  for (const q of quotes) {
    const normalized = q.quote.toLowerCase().trim().replace(/\s+/g, ' ').substring(0, 100);
    
    let isDuplicate = false;
    for (const seenQuote of seen) {
      if (seenQuote.includes(normalized) || normalized.includes(seenQuote)) {
        isDuplicate = true;
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
