import { callLLM } from "../llm";

export interface LongAnswerProgress {
  phase: string;
  message: string;
  content?: string;
  current?: number;
  total?: number;
}

interface SkeletonSection {
  id: number;
  heading: string;
  goal: string;
  targetWords: number;
  keyPoints: string[];
}

interface Skeleton {
  title: string;
  thesis: string;
  sections: SkeletonSection[];
  constraints: string[];
  totalTargetWords: number;
}

export interface LongAnswerResult {
  title: string;
  generatedText: string;
  wordCount: number;
  sectionCount: number;
}

const MAX_MEMORY_CHARS = 4000;
const MAX_SECTION_WORDS = 4000;
const MIN_SECTION_WORDS = 1500;

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function compressMemory(previousSections: string[], maxChars: number): string {
  const fullText = previousSections.join("\n\n");
  if (fullText.length <= maxChars) return fullText;

  const result: string[] = [];
  let totalLen = 0;

  for (let i = previousSections.length - 1; i >= 0; i--) {
    const section = previousSections[i];
    if (totalLen + section.length <= maxChars) {
      result.unshift(section);
      totalLen += section.length;
    } else {
      const remaining = maxChars - totalLen;
      if (remaining > 200) {
        result.unshift(`[Earlier sections truncated]...\n${section.slice(-remaining)}`);
      }
      break;
    }
  }

  return result.join("\n\n");
}

async function generateSkeleton(
  prompt: string,
  targetWords: number,
  provider: string,
  sourcePacket?: string
): Promise<Skeleton> {
  const numSections = Math.max(8, Math.ceil(targetWords / MAX_SECTION_WORDS));
  const wordsPerSection = Math.ceil(targetWords / numSections);

  const sourceContext = sourcePacket
    ? `\n\nPRIMARY SOURCE MATERIAL (you MUST base your outline on this material):\n${sourcePacket.substring(0, 6000)}\n`
    : "";

  const skeletonPrompt = `You are an expert document architect. Create a detailed structural skeleton for the following writing task.

USER QUESTION / PROMPT:
${prompt}
${sourceContext}
TARGET LENGTH: Approximately ${targetWords} words total
NUMBER OF SECTIONS: ${numSections} sections (about ${wordsPerSection} words each)

CONSTRAINTS:
- Do NOT repeat arguments across sections
- Maintain internal cross-references and logical flow
- Each section must advance the overall argument
- No filler or padding content

Return ONLY valid JSON (no markdown, no explanation):
{
  "title": "Document title",
  "thesis": "Central thesis or main argument",
  "totalTargetWords": ${targetWords},
  "constraints": ["Do not repeat arguments", "Maintain internal consistency", "Cross-reference earlier sections"],
  "sections": [
    {
      "id": 1,
      "heading": "Section heading",
      "goal": "What this section accomplishes in the overall argument",
      "targetWords": ${wordsPerSection},
      "keyPoints": ["point 1", "point 2", "point 3"]
    }
  ]
}

Create exactly ${numSections} sections that build logically from introduction through development to conclusion.`;

  const response = await callLLM(provider, skeletonPrompt);

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        title: parsed.title || "Long Answer",
        thesis: parsed.thesis || prompt,
        totalTargetWords: targetWords,
        constraints: parsed.constraints || [],
        sections: (parsed.sections || []).map((s: any, i: number) => ({
          id: s.id || i + 1,
          heading: s.heading || `Section ${i + 1}`,
          goal: s.goal || "",
          targetWords: s.targetWords || wordsPerSection,
          keyPoints: s.keyPoints || [],
        })),
      };
    }
  } catch (e) {
    console.error("Failed to parse skeleton:", e);
  }

  return {
    title: "Long Answer",
    thesis: prompt,
    totalTargetWords: targetWords,
    constraints: [],
    sections: Array.from({ length: numSections }, (_, i) => ({
      id: i + 1,
      heading: `Section ${i + 1}`,
      goal: `Part ${i + 1} of the answer`,
      targetWords: wordsPerSection,
      keyPoints: [],
    })),
  };
}

async function summarizeForMemory(
  text: string,
  provider: string
): Promise<string> {
  const summarizePrompt = `Compress the following text into a dense summary preserving all key claims, definitions, arguments, and conclusions. Maximum 800 words.

TEXT:
${text.substring(0, 12000)}

Return ONLY the summary text, no JSON.`;

  try {
    return await callLLM(provider, summarizePrompt);
  } catch {
    return text.substring(0, 2000);
  }
}

export async function generateLongAnswerStream(options: {
  prompt: string;
  provider: string;
  mode: "normal" | "pure";
  maxWords?: number;
  sourcePacket?: string;
  onProgress?: (progress: LongAnswerProgress) => void;
}): Promise<LongAnswerResult> {
  const { prompt, provider, mode, maxWords = 20000, sourcePacket, onProgress } = options;

  const targetWords = Math.min(Math.max(maxWords, 2000), 100000);

  onProgress?.({
    phase: "skeleton",
    message: `Generating document skeleton for ~${targetWords.toLocaleString()} words...`,
    current: 0,
    total: 1,
  });

  const skeleton = await generateSkeleton(prompt, targetWords, provider, sourcePacket);
  const sections = skeleton.sections;

  onProgress?.({
    phase: "skeleton",
    message: `Skeleton created: "${skeleton.title}" — ${sections.length} sections planned`,
    current: 0,
    total: sections.length,
  });

  const skeletonOverview = sections
    .map((s) => `${s.id}. ${s.heading} (${s.targetWords} words) — ${s.goal}`)
    .join("\n");

  const outputs: string[] = [];
  const sectionSummaries: string[] = [];
  let totalWordCount = 0;
  let rollingMemory = "";

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];

    onProgress?.({
      phase: "writing",
      message: `Writing section ${i + 1}/${sections.length}: "${section.heading}"...`,
      current: i,
      total: sections.length,
    });

    if (i > 0 && i % 5 === 0 && sectionSummaries.join("\n").length > MAX_MEMORY_CHARS) {
      onProgress?.({
        phase: "memory",
        message: `Compressing memory (${sectionSummaries.length} sections)...`,
        current: i,
        total: sections.length,
      });
      const fullPrior = sectionSummaries.join("\n\n");
      rollingMemory = await summarizeForMemory(fullPrior, provider);
      sectionSummaries.length = 0;
      sectionSummaries.push(`[COMPRESSED MEMORY]\n${rollingMemory}`);
    }

    const memoryContext = compressMemory(sectionSummaries, MAX_MEMORY_CHARS);

    const pureInstructions = mode === "pure" && sourcePacket
      ? `\n\nCRITICAL PURE MODE RULES:
- You are FORBIDDEN from using external knowledge or reputation metadata.
- You may NOT mention schools, jobs, prizes, fame, or biographical info not in the sources.
- You MUST quote directly from the provided primary source material.
- If evidence is missing, state: "Insufficient primary material uploaded."
- Every evaluative claim MUST be backed by a direct quote from sources.

PRIMARY SOURCE MATERIAL:
${sourcePacket.substring(0, 8000)}`
      : "";

    const writePrompt = `You are writing section ${i + 1} of ${sections.length} of a comprehensive document.

ORIGINAL QUESTION/PROMPT:
${prompt}

DOCUMENT TITLE: ${skeleton.title}
CENTRAL THESIS: ${skeleton.thesis}

FULL SKELETON:
${skeletonOverview}

CONSTRAINTS:
${skeleton.constraints.map((c) => `- ${c}`).join("\n")}
${pureInstructions}

${memoryContext ? `PRIOR CONTENT SUMMARY:\n${memoryContext}\n` : ""}

CURRENT SECTION TO WRITE:
Section ${section.id}: ${section.heading}
Goal: ${section.goal}
Key points: ${section.keyPoints.join(", ")}
Target length: ${section.targetWords} words

INSTRUCTIONS:
1. Write this section as polished, scholarly prose — ${section.targetWords} words minimum
2. Maintain coherence with prior sections (do not repeat what was already stated)
3. Advance the thesis with new material specific to this section's goal
4. ${i === 0 ? "Open with an engaging introduction that frames the entire document" : i === sections.length - 1 ? "Conclude by synthesizing all arguments into a final assessment" : "Build on earlier sections and transition smoothly to what follows"}
5. Write ONLY the section content — no JSON, no metadata, no section numbering

Begin writing section "${section.heading}" now:`;

    try {
      const response = await callLLM(provider, writePrompt);

      let sectionText = response
        .replace(/^```[\s\S]*?```$/gm, "")
        .replace(/^\{[\s\S]*?\}$/gm, "")
        .trim();

      if (!sectionText || sectionText.length < 100) {
        sectionText = response.trim();
      }

      const sectionWordCount = countWords(sectionText);
      totalWordCount += sectionWordCount;

      const formattedSection =
        i === 0
          ? `# ${skeleton.title}\n\n## ${section.heading}\n\n${sectionText}`
          : `## ${section.heading}\n\n${sectionText}`;

      outputs.push(formattedSection);

      const sectionBrief = `[Section ${section.id}: ${section.heading}] ${sectionText.substring(0, 500)}...`;
      sectionSummaries.push(sectionBrief);

      onProgress?.({
        phase: "content",
        message: `Section ${i + 1} complete (${sectionWordCount} words, total: ${totalWordCount})`,
        content: (i === 0 ? "" : "\n\n") + formattedSection,
        current: i + 1,
        total: sections.length,
      });
    } catch (e: any) {
      console.error(`Failed to write section ${i + 1}:`, e);
      const fallback = `## ${section.heading}\n\n[Section generation failed: ${e.message || "Unknown error"}. Please try again.]`;
      outputs.push(fallback);
      onProgress?.({
        phase: "content",
        message: `Section ${i + 1} failed`,
        content: (i === 0 ? "" : "\n\n") + fallback,
        current: i + 1,
        total: sections.length,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  onProgress?.({
    phase: "complete",
    message: `Document complete: ${sections.length} sections, ${totalWordCount.toLocaleString()} words.`,
    current: sections.length,
    total: sections.length,
  });

  return {
    title: skeleton.title,
    generatedText: outputs.join("\n\n"),
    wordCount: totalWordCount,
    sectionCount: sections.length,
  };
}
