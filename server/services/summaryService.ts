import { callLLM } from "../llm";

export interface SummarySection {
  title: string;
  level: number;
  summary: string;
  startIndex?: number;
  endIndex?: number;
}

export interface SummaryResult {
  sections: SummarySection[];
  resolution: number;
  totalSections: number;
  recognitionMode: "formal" | "content";
}

export interface SummaryProgress {
  current: number;
  total: number;
  message: string;
}

async function detectDocumentStructure(
  text: string,
  provider: string,
  recognizeContentSections: boolean
): Promise<{ levels: string[], sections: { title: string, level: number, content: string }[] }> {
  const prompt = `Analyze this document and identify its hierarchical structure.

${recognizeContentSections ? `
IMPORTANT: Look for BOTH formal section markers (Part, Chapter, Section, numbered headings) AND informal content-based divisions.
If the text lacks formal markers but has natural thematic breaks or topic shifts, identify these as implicit sections.
` : `
Only identify FORMALLY marked sections (Part, Chapter, Section, numbered headings, etc.).
If the text has no formal section markers, treat it as a single undivided unit.
`}

Identify the hierarchy levels present (e.g., Parts > Chapters > Sections > Subsections).
For each section found, provide its title, level (0 = highest/book, 1 = part, 2 = chapter, 3 = section, 4 = subsection), and approximate word position.

TEXT (first 8000 chars):
${text.substring(0, 8000)}

${text.length > 8000 ? `\n... [TEXT CONTINUES - ${text.split(/\s+/).length} total words] ...\n\n${text.substring(text.length - 2000)}` : ''}

Respond in this exact JSON format:
{
  "levels": ["book", "part", "chapter", "section", "subsection"],
  "sections": [
    {"title": "Title or description", "level": 2, "startPercent": 0, "endPercent": 15},
    {"title": "Next section", "level": 2, "startPercent": 15, "endPercent": 35}
  ]
}

Only include levels that actually exist in this document. The "levels" array should list from highest to lowest granularity.`;

  const response = await callLLM(provider, prompt);
  
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const sections = parsed.sections.map((s: any) => {
        const startIdx = Math.floor((s.startPercent / 100) * text.length);
        const endIdx = Math.floor((s.endPercent / 100) * text.length);
        return {
          title: s.title,
          level: s.level,
          content: text.substring(startIdx, endIdx)
        };
      });
      return { levels: parsed.levels || ["book"], sections };
    }
  } catch (e) {
    console.error("Failed to parse structure:", e);
  }
  
  return { 
    levels: ["book"], 
    sections: [{ title: "Full Document", level: 0, content: text }] 
  };
}

async function generateSectionSummary(
  sectionTitle: string,
  sectionContent: string,
  provider: string,
  context: string = ""
): Promise<string> {
  const wordCount = sectionContent.split(/\s+/).length;
  
  const prompt = `Write a concise, one-paragraph summary of the following section.
${context ? `\nContext: This is part of a larger work. ${context}` : ''}

SECTION: "${sectionTitle}"
CONTENT (${wordCount} words):
${sectionContent.substring(0, 12000)}
${sectionContent.length > 12000 ? '\n... [truncated]' : ''}

Write a clear, informative paragraph that captures the key points, arguments, and conclusions of this section. 
Focus on substance over style. Be specific about claims and evidence.
Do not start with "This section..." - just state the content directly.`;

  return await callLLM(provider, prompt);
}

async function generateOverallSummary(
  text: string,
  provider: string,
  paragraphs: number = 2
): Promise<string> {
  const wordCount = text.split(/\s+/).length;
  
  const prompt = `Write a ${paragraphs === 1 ? 'one-paragraph' : 'one-to-two paragraph'} summary of this entire work.

TEXT (${wordCount} words):
${text.substring(0, 15000)}
${text.length > 15000 ? `\n... [${wordCount} total words - showing first portion] ...` : ''}

Provide a comprehensive summary that captures:
- The main thesis or purpose
- Key arguments or points
- Major conclusions or implications

Be specific and substantive. Do not start with generic phrases like "This text discusses..." - dive directly into the content.`;

  return await callLLM(provider, prompt);
}

export async function generateStructuredSummary(
  text: string,
  resolution: number,
  recognizeContentSections: boolean,
  provider: string,
  onProgress?: (progress: SummaryProgress) => void
): Promise<SummaryResult> {
  const wordCount = text.split(/\s+/).length;
  
  onProgress?.({ current: 0, total: 5, message: "Analyzing document structure..." });
  
  if (resolution === 0) {
    onProgress?.({ current: 1, total: 2, message: "Generating overall summary..." });
    const summary = await generateOverallSummary(text, provider, 2);
    onProgress?.({ current: 2, total: 2, message: "Complete" });
    
    return {
      sections: [{ title: "Overall Summary", level: 0, summary }],
      resolution: 0,
      totalSections: 1,
      recognitionMode: recognizeContentSections ? "content" : "formal"
    };
  }
  
  const structure = await detectDocumentStructure(text, provider, recognizeContentSections);
  
  onProgress?.({ current: 1, total: 5, message: `Found ${structure.levels.length} hierarchy levels` });
  
  const maxAvailableLevel = Math.max(...structure.sections.map(s => s.level), 0);
  const targetLevel = Math.min(resolution, maxAvailableLevel);
  
  let sectionsAtLevel = structure.sections.filter(s => s.level === targetLevel);
  
  if (sectionsAtLevel.length === 0) {
    for (let lvl = targetLevel - 1; lvl >= 0; lvl--) {
      sectionsAtLevel = structure.sections.filter(s => s.level === lvl);
      if (sectionsAtLevel.length > 0) break;
    }
  }
  
  if (sectionsAtLevel.length === 0) {
    onProgress?.({ current: 2, total: 3, message: "No sections at target level, generating overall summary..." });
    const summary = await generateOverallSummary(text, provider, 2);
    return {
      sections: [{ title: "Overall Summary", level: 0, summary }],
      resolution,
      totalSections: 1,
      recognitionMode: recognizeContentSections ? "content" : "formal"
    };
  }
  
  const summaries: SummarySection[] = [];
  const totalSections = sectionsAtLevel.length;
  
  for (let i = 0; i < sectionsAtLevel.length; i++) {
    const section = sectionsAtLevel[i];
    onProgress?.({ 
      current: i + 2, 
      total: totalSections + 2, 
      message: `Summarizing: ${section.title} (${i + 1}/${totalSections})` 
    });
    
    const summary = await generateSectionSummary(
      section.title,
      section.content,
      provider
    );
    
    summaries.push({
      title: section.title,
      level: section.level,
      summary
    });
  }
  
  onProgress?.({ current: totalSections + 2, total: totalSections + 2, message: "Summary complete" });
  
  return {
    sections: summaries,
    resolution,
    totalSections: summaries.length,
    recognitionMode: recognizeContentSections ? "content" : "formal"
  };
}

export function getResolutionLabel(resolution: number, maxLevels: number): string {
  if (resolution === 0) return "Lowest (1-2 paragraphs for entire work)";
  if (resolution === 1) return "Low (per major part/division)";
  if (resolution === 2) return "Medium (per chapter)";
  if (resolution === 3) return "High (per section)";
  if (resolution >= 4) return "Highest (per subsection)";
  return `Level ${resolution}`;
}
