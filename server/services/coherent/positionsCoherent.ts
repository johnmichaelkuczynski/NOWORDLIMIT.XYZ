import { callLLM } from "../../llm";
import { generateSkeleton, DocumentSkeletonData } from "./skeletonGenerator";
import { chunkText } from "./coherenceProcessor";
import { ProgressUpdate } from "./stateSchemas";

export interface ExtractedPosition {
  position: string;
  confidence: number;
  importance: "central" | "supporting" | "peripheral";
  relationToThesis: string;
  sourceChunk?: number;
}

export interface PositionExtractionResult {
  documentId: string;
  positions: ExtractedPosition[];
  skeleton: DocumentSkeletonData;
  totalExtracted: number;
  afterDeduplication: number;
}

export async function positionsCoherent(
  text: string,
  options: { author?: string; depth?: number; showMinor?: boolean },
  provider: string,
  onProgress?: (progress: ProgressUpdate) => void,
  userId?: number
): Promise<PositionExtractionResult> {
  onProgress?.({ phase: "skeleton", message: "Generating document skeleton..." });
  const skeleton = await generateSkeleton(text, provider, userId);

  const chunks = chunkText(text, 1500);
  const allPositions: ExtractedPosition[] = [];

  for (let i = 0; i < chunks.length; i++) {
    onProgress?.({
      phase: "extraction",
      currentChunk: i + 1,
      totalChunks: chunks.length,
      message: `Extracting positions from chunk ${i + 1} of ${chunks.length}...`
    });

    const sectionContext = skeleton.sections.find(s => s.index === i) || skeleton.sections[0];

    const prompt = `Extract author positions from this text chunk.

DOCUMENT CONTEXT:
- Main Thesis: ${skeleton.mainThesis}
- Overarching Theme: ${skeleton.overarchingTheme}
- This Section's Role: ${sectionContext?.role || 'body'}
- This Section's Relation to Thesis: ${sectionContext?.relationToThesis || 'supports main argument'}

CHUNK ${i + 1} OF ${chunks.length}:
${chunks[i]}

TASK:
Extract positions that are REPRESENTATIVE of the document's overall argument, not just locally prominent.
Prioritize positions that connect to the main thesis: "${skeleton.mainThesis}"

Return JSON array:
[
  {
    "position": "The author's stated position (verbatim or closely paraphrased)",
    "confidence": 0.0-1.0,
    "importance": "central|supporting|peripheral",
    "relationToThesis": "How this position relates to the main thesis"
  }
]`;

    try {
      const response = await callLLM(provider, prompt);
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const chunkPositions = JSON.parse(jsonMatch[0]);
        allPositions.push(...chunkPositions.map((p: any) => ({ ...p, sourceChunk: i })));
      }
    } catch (e) {
      console.error(`Failed to extract positions from chunk ${i}:`, e);
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  onProgress?.({ phase: "ranking", message: "Ranking and deduplicating positions..." });
  const rankedPositions = await rankAndDeduplicate(allPositions, skeleton, provider, options.showMinor);

  return {
    documentId: skeleton.documentId,
    positions: rankedPositions,
    skeleton: skeleton,
    totalExtracted: allPositions.length,
    afterDeduplication: rankedPositions.length
  };
}

async function rankAndDeduplicate(
  positions: ExtractedPosition[],
  skeleton: DocumentSkeletonData,
  provider: string,
  showMinor?: boolean
): Promise<ExtractedPosition[]> {
  if (positions.length === 0) return [];
  if (positions.length <= 10) return positions;

  const positionList = positions.slice(0, 50).map((p, i) => 
    `${i + 1}. ${p.position} [importance: ${p.importance}]`
  ).join('\n');

  const prompt = `Given the document's main thesis: "${skeleton.mainThesis}"

And these extracted positions:
${positionList}

TASK:
1. Remove duplicates (positions saying essentially the same thing)
2. Rank remaining positions by how central they are to the thesis
3. Return the top ${showMinor ? 30 : 15} positions in ranked order

Return JSON array of position indices (1-based) to keep, in ranked order:
[3, 7, 1, 15, ...]`;

  try {
    const response = await callLLM(provider, prompt);
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const rankedIndices = JSON.parse(jsonMatch[0]) as number[];
      return rankedIndices
        .filter(i => i >= 1 && i <= positions.length)
        .map(i => positions[i - 1]);
    }
  } catch (e) {
    console.error("Failed to rank positions:", e);
  }

  return positions.slice(0, showMinor ? 30 : 15);
}
