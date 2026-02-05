import { callLLM } from "../../llm";
import { generateSkeleton, DocumentSkeletonData } from "./skeletonGenerator";
import { chunkText } from "./coherenceProcessor";
import { ProgressUpdate } from "./stateSchemas";

export interface OutlineSection {
  title: string;
  description: string;
  keyThemes: string[];
  wordRange?: [number, number];
}

export interface OutlineResult {
  documentId: string;
  sections: OutlineSection[];
  mainThesis: string;
  overarchingTheme: string;
  totalSections: number;
}

export async function outlineCoherent(
  text: string,
  provider: string,
  onProgress?: (progress: ProgressUpdate) => void,
  userId?: number
): Promise<OutlineResult> {
  onProgress?.({ phase: "skeleton", message: "Generating document skeleton..." });
  
  const skeleton = await generateSkeleton(text, provider, userId);

  onProgress?.({ phase: "refining", message: "Refining outline structure..." });

  const sections: OutlineSection[] = skeleton.sections.map((s, i) => ({
    title: s.title || `Section ${i + 1}`,
    description: s.role || "Body section",
    keyThemes: s.keyPoints || [],
    wordRange: s.wordRange
  }));

  if (sections.length === 0) {
    const chunks = chunkText(text, 2000);
    
    for (let i = 0; i < chunks.length; i++) {
      onProgress?.({
        phase: "analyzing",
        currentChunk: i + 1,
        totalChunks: chunks.length,
        message: `Analyzing section ${i + 1} of ${chunks.length}...`
      });

      const prompt = `Analyze this text section and provide a title and key themes.

TEXT SECTION ${i + 1}:
${chunks[i].substring(0, 3000)}

Return JSON:
{
  "title": "A descriptive title for this section",
  "description": "Brief description of what this section covers",
  "keyThemes": ["Theme 1", "Theme 2", "Theme 3"]
}`;

      try {
        const response = await callLLM(provider, prompt);
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const sectionData = JSON.parse(jsonMatch[0]);
          sections.push({
            title: sectionData.title || `Section ${i + 1}`,
            description: sectionData.description || "",
            keyThemes: sectionData.keyThemes || []
          });
        }
      } catch (e) {
        console.error(`Failed to analyze section ${i}:`, e);
        sections.push({
          title: `Section ${i + 1}`,
          description: "Unable to analyze",
          keyThemes: []
        });
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  onProgress?.({ phase: "complete", message: "Outline generation complete." });

  return {
    documentId: skeleton.documentId,
    sections,
    mainThesis: skeleton.mainThesis,
    overarchingTheme: skeleton.overarchingTheme,
    totalSections: sections.length
  };
}
