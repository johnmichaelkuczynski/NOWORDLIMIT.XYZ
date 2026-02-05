import { callLLM } from "../llm";
import { generateOutline, Outline } from "./outlineService";

export interface TractatusRewriteProgress {
  stage: "outlining" | "rewriting" | "formatting" | "complete" | "error";
  message: string;
  current?: number;
  total?: number;
}

export interface TractatusRewriteResult {
  rewrittenText: string;
  sectionsProcessed: number;
  statementsCount: number;
}

function sliceTextBySections(text: string, sections: any[]): { section: any; content: string }[] {
  const result: { section: any; content: string }[] = [];
  const textLower = text.toLowerCase();
  
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const titleLower = section.title.toLowerCase();
    
    const titleIndex = textLower.indexOf(titleLower);
    let startIndex = titleIndex !== -1 ? titleIndex : 0;
    
    let endIndex = text.length;
    if (i < sections.length - 1) {
      const nextTitleLower = sections[i + 1].title.toLowerCase();
      const nextIndex = textLower.indexOf(nextTitleLower, startIndex + 1);
      if (nextIndex !== -1) {
        endIndex = nextIndex;
      }
    }
    
    const content = text.substring(startIndex, endIndex).trim();
    if (content.length > 50) {
      result.push({ section, content });
    }
  }
  
  if (result.length === 0) {
    const chunkSize = Math.ceil(text.length / Math.max(sections.length, 1));
    for (let i = 0; i < sections.length && i * chunkSize < text.length; i++) {
      const content = text.substring(i * chunkSize, (i + 1) * chunkSize).trim();
      if (content.length > 50) {
        result.push({ section: sections[i], content });
      }
    }
  }
  
  return result;
}

const TRACTATUS_SYSTEM_PROMPT = `You are an expert at distilling complex texts into clear, one-line statements in the style of Wittgenstein's Tractatus Logico-Philosophicus.

Your task is to rewrite the given text as a series of concise, standalone statements with HIERARCHICAL NUMBERING. Each statement should:
1. Capture ONE complete idea or claim
2. Be self-contained and understandable on its own
3. Be expressed in clear, direct language
4. Preserve the logical structure and argumentation of the original
5. Use the author's terminology where appropriate

NUMBERING SYSTEM (Wittgenstein's Tractatus style):
- The CHAPTER NUMBER is given to you (e.g., 1, 2, 3...)
- Main propositions use: N. (e.g., "1.", "2.", "3.")
- First-level elaborations: N.1, N.2, N.3... (e.g., "1.1", "1.2")
- Second-level elaborations: N.X1, N.X2... (e.g., "1.11", "1.12", "1.21")
- Third-level elaborations: N.XY1, N.XY2... (e.g., "1.111", "1.121")
- The numbering indicates logical dependency: 1.11 elaborates on 1.1, which elaborates on 1.

EXAMPLE for Chapter 2:
• 2. The main thesis of this chapter.
• 2.1 First major point elaborating on thesis.
• 2.11 A detail about the first major point.
• 2.12 Another detail about the first major point.
• 2.2 Second major point.
• 2.21 Detail about second point.
• 2.3 Third major point.

Do NOT restart numbering within a chapter - all statements in chapter N must start with "N."
Each statement must begin with its number followed by the text.`;

export async function rewriteAsTractatusWithOutline(
  text: string,
  provider: string = "openai",
  includeBulletMarkers: boolean = true,
  onProgress?: (progress: TractatusRewriteProgress) => void,
  ragContext?: string
): Promise<TractatusRewriteResult> {
  const wordCount = text.split(/\s+/).length;
  
  onProgress?.({ stage: "outlining", message: "Generating structured outline..." });

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
    message: `Outline complete: ${outline.sections.length} sections. Beginning rewrite...` 
  });

  const slicedSections = sliceTextBySections(text, outline.sections);
  const rewrittenSections: string[] = [];
  let totalStatements = 0;

  for (let i = 0; i < slicedSections.length; i++) {
    const { section, content } = slicedSections[i];

    onProgress?.({ 
      stage: "rewriting", 
      message: `Rewriting section ${i + 1}/${slicedSections.length}: "${section.title}"...`,
      current: i + 1,
      total: slicedSections.length
    });

    if (content.trim().length < 100) continue;

    const chapterNumber = i + 1;
    const ragSection = ragContext ? `
RELEVANT PHILOSOPHICAL POSITIONS:
${ragContext}

Reference these positions where relevant to the text. Note alignments or tensions with established views.

---

` : "";

    const rewritePrompt = `${ragSection}Rewrite the following section as a series of one-line statements with TRACTATUS-STYLE NUMBERING.

THIS IS CHAPTER ${chapterNumber}. All statement numbers MUST start with "${chapterNumber}."

SECTION: "${section.title}"
DESCRIPTION: ${section.description}

TEXT TO REWRITE:
"""
${content.substring(0, 15000)}
"""

NUMBERING RULES FOR THIS CHAPTER:
- Main thesis: ${chapterNumber}. [statement]
- First-level points: ${chapterNumber}.1, ${chapterNumber}.2, ${chapterNumber}.3...
- Second-level details: ${chapterNumber}.11, ${chapterNumber}.12, ${chapterNumber}.21, ${chapterNumber}.22...
- Third-level: ${chapterNumber}.111, ${chapterNumber}.112...

Output format:
- Start with "${chapterNumber}. [main thesis of this section]"
- Each statement begins with its number (${chapterNumber}.X, ${chapterNumber}.XX, etc.)
- Each statement on its own line
- Blank lines between logical groups
- Include bullet markers (•) before each numbered statement`;

    try {
      const rewrittenSection = await callLLM(provider, `${TRACTATUS_SYSTEM_PROMPT}\n\n${rewritePrompt}`);
      rewrittenSections.push(rewrittenSection.trim());
      
      const statements = rewrittenSection.split('\n').filter(line => 
        line.trim().length > 0 && !line.trim().match(/^[A-Z\s]+$/)
      );
      totalStatements += statements.length;
    } catch (error: any) {
      console.error(`Failed to rewrite section "${section.title}":`, error);
      rewrittenSections.push(`[ERROR: Failed to rewrite section "${section.title}"]`);
    }

    if (i < slicedSections.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  onProgress?.({ stage: "formatting", message: "Formatting final output..." });

  let finalText = rewrittenSections.join('\n\n\n');

  if (includeBulletMarkers) {
    const lines = finalText.split('\n');
    const formattedLines = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return '';
      if (trimmed.match(/^[A-Z][A-Z\s\-\(\)]+$/)) return trimmed;
      if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*')) {
        return trimmed;
      }
      return `• ${trimmed}`;
    });
    finalText = formattedLines.join('\n');
  }

  onProgress?.({ 
    stage: "complete", 
    message: `Rewrite complete: ${totalStatements} statements across ${slicedSections.length} sections` 
  });

  return {
    rewrittenText: finalText,
    sectionsProcessed: slicedSections.length,
    statementsCount: totalStatements
  };
}

export async function rewriteAsTractatusSimple(
  text: string,
  provider: string = "openai",
  includeBulletMarkers: boolean = true,
  onProgress?: (progress: TractatusRewriteProgress) => void,
  ragContext?: string
): Promise<TractatusRewriteResult> {
  onProgress?.({ stage: "rewriting", message: "Rewriting text as statements..." });

  const ragSection = ragContext ? `
RELEVANT PHILOSOPHICAL POSITIONS:
${ragContext}

Reference these positions where relevant to the text. Note alignments or tensions with established views.

---

` : "";

  const rewritePrompt = `${ragSection}Rewrite the following text as a series of clear, one-line statements in the style of Wittgenstein's Tractatus with HIERARCHICAL NUMBERING.

TEXT TO REWRITE:
"""
${text.substring(0, 30000)}
"""

REQUIREMENTS:
1. Each statement captures ONE complete idea
2. Statements are self-contained and clear
3. Use Tractatus-style hierarchical numbering throughout
4. Preserve the logical structure and argumentation
5. Include bullet markers (•) before each numbered statement
6. Separate logical groups with blank lines

NUMBERING SYSTEM:
- Identify major themes/chapters and number them 1., 2., 3., etc.
- First-level elaborations: N.1, N.2, N.3...
- Second-level details: N.11, N.12, N.21, N.22...
- Third-level: N.111, N.112...

EXAMPLE:
• 1. The main thesis of the first major theme.
• 1.1 First point elaborating on theme one.
• 1.11 A detail about that first point.
• 2. The main thesis of the second major theme.
• 2.1 First point elaborating on theme two.

The numbering should be CONTINUOUS - do not restart at 1. for each section.`;

  try {
    let rewrittenText = await callLLM(provider, `${TRACTATUS_SYSTEM_PROMPT}\n\n${rewritePrompt}`);
    
    const statements = rewrittenText.split('\n').filter(line => 
      line.trim().length > 0 && !line.trim().match(/^[A-Z\s]+$/)
    );

    if (includeBulletMarkers) {
      const lines = rewrittenText.split('\n');
      const formattedLines = lines.map(line => {
        const trimmed = line.trim();
        if (trimmed.length === 0) return '';
        if (trimmed.match(/^[A-Z][A-Z\s\-\(\)]+$/)) return trimmed;
        if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*')) {
          return trimmed;
        }
        return `• ${trimmed}`;
      });
      rewrittenText = formattedLines.join('\n');
    }

    onProgress?.({ 
      stage: "complete", 
      message: `Rewrite complete: ${statements.length} statements` 
    });

    return {
      rewrittenText,
      sectionsProcessed: 1,
      statementsCount: statements.length
    };
  } catch (error: any) {
    onProgress?.({ stage: "error", message: error.message });
    throw error;
  }
}
