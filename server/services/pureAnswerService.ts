import { callLLM } from "../llm";
import { storage } from "../storage";

export interface PureSourcePacket {
  authorName: string;
  sources: {
    workTitle: string;
    chunks: string[];
  }[];
}

export async function extractEntitiesFromPrompt(prompt: string, provider: string): Promise<string[]> {
  const extractPrompt = `Extract all person names, author names, and entity names from this text. Return ONLY a JSON array of strings.

TEXT:
${prompt}

Example output: ["John Smith", "Immanuel Kant"]
If no names found, return: []`;

  try {
    const response = await callLLM(provider, extractPrompt);
    const match = response.match(/\[[\s\S]*?\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch (e) {
    console.error("Entity extraction failed:", e);
  }
  return [];
}

export async function buildSourcePacket(
  entityNames: string[],
  prompt: string,
  adhocTexts?: { authorName: string; title: string; text: string }[]
): Promise<{ packet: string; sources: PureSourcePacket[] }> {
  const allSources: PureSourcePacket[] = [];
  const packetParts: string[] = [];

  const keywords = prompt
    .split(/\s+/)
    .filter((w) => w.length > 4)
    .slice(0, 10);
  const searchTerms = keywords.join(" ");

  for (const name of entityNames) {
    const author = await storage.findCorpusAuthorByName(name);
    if (!author) continue;

    const works = await storage.getCorpusWorks(author.id);
    if (works.length === 0) continue;

    const sourceEntry: PureSourcePacket = {
      authorName: author.name,
      sources: [],
    };

    for (const work of works) {
      const searchResults = await storage.searchCorpusByAuthor(
        author.name,
        searchTerms.substring(0, 100)
      );

      const relevantChunks = searchResults
        .filter((r) => r.workTitle === work.title)
        .map((r) => r.section.content)
        .slice(0, 20);

      if (relevantChunks.length === 0) {
        const allSections = await storage.getWorkSections(work.id);
        const fallbackChunks = allSections
          .slice(0, 15)
          .map((s) => s.content);
        if (fallbackChunks.length > 0) {
          sourceEntry.sources.push({
            workTitle: work.title,
            chunks: fallbackChunks,
          });
        }
      } else {
        sourceEntry.sources.push({
          workTitle: work.title,
          chunks: relevantChunks,
        });
      }
    }

    if (sourceEntry.sources.length > 0) {
      allSources.push(sourceEntry);
      for (const src of sourceEntry.sources) {
        packetParts.push(
          `=== SOURCE: ${sourceEntry.authorName}, ${src.workTitle} ===\n${src.chunks.join("\n\n---\n\n")}`
        );
      }
    }
  }

  if (adhocTexts && adhocTexts.length > 0) {
    for (const adhoc of adhocTexts) {
      const chunks = splitTextIntoChunks(adhoc.text, 2500);
      packetParts.push(
        `=== SOURCE (AD HOC): ${adhoc.authorName}, ${adhoc.title} ===\n${chunks.join("\n\n---\n\n")}`
      );
      allSources.push({
        authorName: adhoc.authorName,
        sources: [{ workTitle: adhoc.title, chunks }],
      });
    }
  }

  return {
    packet: packetParts.join("\n\n"),
    sources: allSources,
  };
}

function splitTextIntoChunks(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf(".", end);
      const lastNewline = text.lastIndexOf("\n", end);
      const breakPoint = Math.max(lastPeriod, lastNewline);
      if (breakPoint > start + chunkSize * 0.5) {
        end = breakPoint + 1;
      }
    }
    chunks.push(text.substring(start, end).trim());
    start = end;
  }
  return chunks.filter((c) => c.length > 0);
}

export async function generatePureAnswerStream(options: {
  prompt: string;
  provider: string;
  sourcePacket: string;
  onProgress?: (progress: { phase: string; message: string; content?: string }) => void;
}): Promise<{ answer: string; wordCount: number }> {
  const { prompt, provider, sourcePacket, onProgress } = options;

  if (!sourcePacket || sourcePacket.trim().length === 0) {
    const refusal =
      "Insufficient primary source material in database. Upload texts for the entities mentioned in your question before using Pure mode.";
    onProgress?.({
      phase: "complete",
      message: refusal,
      content: refusal,
    });
    return { answer: refusal, wordCount: refusal.split(/\s+/).length };
  }

  onProgress?.({
    phase: "generating",
    message: "Generating Pure mode answer from primary sources only...",
  });

  const purePrompt = `You are operating in PURE EVALUATION MODE.

ABSOLUTE RULES:
1. You are FORBIDDEN from using external knowledge, Wikipedia, or general reputation information.
2. You may NOT mention schools, jobs, prizes, fame, academic positions, or any biographical metadata NOT found in the provided sources.
3. Every evaluative claim MUST be supported by a DIRECT QUOTE from the provided primary source material.
4. If evidence is insufficient to answer a question, you MUST say: "Insufficient primary material uploaded."
5. You MUST cite each quote with author name and work title.
6. NO hallucinated biography. NO Wikipedia-style answers.

PRIMARY SOURCE MATERIAL:
${sourcePacket}

USER QUESTION:
${prompt}

Now answer the question using ONLY the primary source material above. Quote directly and cite sources. If you cannot answer from the sources, say so explicitly.`;

  try {
    const response = await callLLM(provider, purePrompt);

    onProgress?.({
      phase: "complete",
      message: "Pure mode answer complete.",
      content: response,
    });

    return {
      answer: response,
      wordCount: response.split(/\s+/).filter(Boolean).length,
    };
  } catch (e: any) {
    const errorMsg = `Pure mode generation failed: ${e.message}`;
    onProgress?.({
      phase: "error",
      message: errorMsg,
    });
    throw new Error(errorMsg);
  }
}
