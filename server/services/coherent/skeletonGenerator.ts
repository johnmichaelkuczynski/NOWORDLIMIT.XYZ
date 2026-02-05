import { callLLM } from "../../llm";
import { generateDocumentId, storeSkeleton, retrieveSkeleton } from "./coherenceDatabase";
import { chunkText } from "./coherenceProcessor";

export interface SectionSkeleton {
  index: number;
  title: string;
  role: string;
  keyPoints: string[];
  relationToThesis: string;
  wordRange?: [number, number];
}

export interface DocumentSkeletonData {
  documentId: string;
  mainThesis: string;
  overarchingTheme: string;
  sections: SectionSkeleton[];
  keyArguments: string[];
  centralConcepts: string[];
  narrativeArc: string;
  totalWordCount: number;
}

const LARGE_DOCUMENT_THRESHOLD = 50000;

export async function generateSkeleton(
  text: string,
  provider: string,
  userId?: number
): Promise<DocumentSkeletonData> {
  const wordCount = text.split(/\s+/).length;
  const docId = generateDocumentId();

  if (wordCount > LARGE_DOCUMENT_THRESHOLD) {
    return generateTwoTierSkeleton(text, docId, provider, userId);
  } else {
    return generateSingleSkeleton(text, docId, provider, userId);
  }
}

async function generateSingleSkeleton(
  text: string,
  docId: string,
  provider: string,
  userId?: number
): Promise<DocumentSkeletonData> {
  const chunks = chunkText(text, 3000);
  const wordCount = text.split(/\s+/).length;

  const chunkPreviews = chunks.slice(0, 10).map((c, i) => 
    `--- SECTION ${i + 1} ---\n${c.substring(0, 1200)}...`
  ).join('\n\n');

  const prompt = `Analyze this document and extract its structural skeleton.

DOCUMENT (${chunks.length} sections, showing first 10):
${chunkPreviews}

Extract and return JSON:
{
  "mainThesis": "The central claim or purpose of the document",
  "overarchingTheme": "The unifying theme across all sections",
  "sections": [
    {
      "index": 0,
      "title": "Section title or description",
      "role": "introduction|argument|evidence|objection|reply|conclusion|transition",
      "keyPoints": ["Main point 1", "Main point 2"],
      "relationToThesis": "How this section supports/develops the thesis"
    }
  ],
  "keyArguments": ["Argument 1", "Argument 2", ...],
  "centralConcepts": ["Concept 1", "Concept 2", ...],
  "narrativeArc": "Description of how the document develops"
}`;

  const response = await callLLM(provider, prompt);

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const skeleton = JSON.parse(jsonMatch[0]);

      await storeSkeleton(docId, "single", skeleton, wordCount, undefined, userId);

      return {
        documentId: docId,
        mainThesis: skeleton.mainThesis || "",
        overarchingTheme: skeleton.overarchingTheme || "",
        sections: skeleton.sections || [],
        keyArguments: skeleton.keyArguments || [],
        centralConcepts: skeleton.centralConcepts || [],
        narrativeArc: skeleton.narrativeArc || "",
        totalWordCount: wordCount
      };
    }
  } catch (e) {
    console.error("Failed to parse skeleton:", e);
  }

  const fallbackSkeleton = {
    documentId: docId,
    mainThesis: "Unable to extract thesis",
    overarchingTheme: "Unable to extract theme",
    sections: [],
    keyArguments: [],
    centralConcepts: [],
    narrativeArc: "",
    totalWordCount: wordCount
  };

  await storeSkeleton(docId, "single", fallbackSkeleton, wordCount, undefined, userId);
  return fallbackSkeleton;
}

async function generateTwoTierSkeleton(
  text: string,
  docId: string,
  provider: string,
  userId?: number
): Promise<DocumentSkeletonData> {
  const words = text.split(/\s+/);
  const chunkSize = 50000;
  const megaChunks: string[] = [];

  for (let i = 0; i < words.length; i += chunkSize) {
    megaChunks.push(words.slice(i, i + chunkSize).join(' '));
  }

  const chunkSkeletons: DocumentSkeletonData[] = [];
  
  for (let i = 0; i < megaChunks.length; i++) {
    const chunkSkeleton = await generateSingleSkeleton(
      megaChunks[i],
      `${docId}-chunk-${i}`,
      provider,
      userId
    );
    chunkSkeletons.push(chunkSkeleton);

    await storeSkeleton(
      `${docId}-chunk-${i}`,
      "chunk",
      chunkSkeleton,
      megaChunks[i].split(/\s+/).length,
      { start: i * chunkSize, end: Math.min((i + 1) * chunkSize, words.length) },
      userId
    );
  }

  const metaPrompt = `You have skeletons from ${chunkSkeletons.length} sections of a very large document.
Synthesize these into a unified meta-skeleton.

CHUNK SKELETONS:
${chunkSkeletons.map((s, i) => `--- CHUNK ${i + 1} ---
Thesis: ${s.mainThesis}
Key Arguments: ${s.keyArguments.join(', ')}
Central Concepts: ${s.centralConcepts.join(', ')}`).join('\n\n')}

Return unified skeleton JSON with:
- mainThesis: The overarching thesis across ALL chunks
- overarchingTheme: The unifying theme
- sections: High-level section breakdown (combine similar sections)
- keyArguments: Most important arguments from entire document
- centralConcepts: Core concepts
- narrativeArc: How the full document develops`;

  const metaResponse = await callLLM(provider, metaPrompt);

  try {
    const jsonMatch = metaResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const metaSkeleton = JSON.parse(jsonMatch[0]);

      await storeSkeleton(docId, "meta", metaSkeleton, words.length, undefined, userId);

      return {
        documentId: docId,
        mainThesis: metaSkeleton.mainThesis || "",
        overarchingTheme: metaSkeleton.overarchingTheme || "",
        sections: metaSkeleton.sections || [],
        keyArguments: metaSkeleton.keyArguments || [],
        centralConcepts: metaSkeleton.centralConcepts || [],
        narrativeArc: metaSkeleton.narrativeArc || "",
        totalWordCount: words.length
      };
    }
  } catch (e) {
    console.error("Failed to parse meta-skeleton:", e);
  }

  return {
    documentId: docId,
    mainThesis: chunkSkeletons[0]?.mainThesis || "",
    overarchingTheme: chunkSkeletons[0]?.overarchingTheme || "",
    sections: chunkSkeletons.flatMap(s => s.sections),
    keyArguments: chunkSkeletons.flatMap(s => s.keyArguments).slice(0, 20),
    centralConcepts: Array.from(new Set(chunkSkeletons.flatMap(s => s.centralConcepts))).slice(0, 15),
    narrativeArc: "Multi-part document",
    totalWordCount: words.length
  };
}

export async function getOrCreateSkeleton(
  docId: string,
  text: string,
  provider: string,
  userId?: number
): Promise<DocumentSkeletonData> {
  const existing = await retrieveSkeleton(docId);
  if (existing) {
    return existing as DocumentSkeletonData;
  }
  return generateSkeleton(text, provider, userId);
}
