import { processDocumentSequentially } from "./coherenceProcessor";
import { ProgressUpdate } from "./stateSchemas";

export interface TractatusResult {
  documentId: string;
  rewrittenText: string;
  chunkCount: number;
}

export async function tractatusCoherent(
  text: string,
  options: { showBullets?: boolean; ragContext?: string },
  provider: string,
  onProgress?: (progress: ProgressUpdate) => void,
  userId?: number
): Promise<TractatusResult> {
  const ragSection = options.ragContext ? `
${options.ragContext}

USE THE ABOVE PHILOSOPHICAL POSITIONS TO INFORM YOUR OUTPUT:
- Reference these positions where relevant to the text being analyzed
- Compare the text's claims with known philosophical positions
- Note alignments or tensions with established views

---

` : "";

  const instructions = `${ragSection}Rewrite this text in the style of Wittgenstein's Tractatus Logico-Philosophicus.

NUMBERING SYSTEM (CRITICAL):
- Each chapter/section uses its chapter number as the prefix
- Chapter 1 content: 1., 1.1, 1.11, 1.12, 1.2, 1.21, etc.
- Chapter 2 content: 2., 2.1, 2.11, 2.12, 2.2, 2.21, etc.
- Chapter 3 content: 3., 3.1, 3.11, etc.
- The main chapter number indicates the theme; decimals indicate logical elaboration
- DO NOT restart numbering at 1. for each new section - use continuous chapter numbers

REQUIREMENTS:
- Each proposition must be a single, self-contained statement
- Maintain logical relationships using the hierarchical numbering
- N.1 elaborates on N.; N.11 elaborates on N.1
${options.showBullets ? "- Include bullet markers (•) before each proposition" : ""}
- Keep propositions concise and aphoristic

EXAMPLE:
• 1. The main thesis of chapter one.
• 1.1 First major elaboration.
• 1.11 Detail about first elaboration.
• 2. The main thesis of chapter two.
• 2.1 First major elaboration of chapter two.`;

  const result = await processDocumentSequentially(
    text,
    "philosophical",
    provider,
    "rewrite",
    instructions,
    onProgress,
    userId
  );

  return {
    documentId: result.documentId,
    rewrittenText: result.finalOutput,
    chunkCount: result.chunkCount
  };
}
