import { z } from "zod";

const SectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  keyThemes: z.array(z.string()),
  mainPoints: z.array(z.string()).optional(),
  keyTerms: z.array(z.string()).optional(),
  wordCount: z.number()
});

const OutlineSchema = z.object({
  taskSummary: z.string(),
  documentType: z.string().optional(),
  mainThesis: z.string().optional(),
  totalSections: z.number(),
  sections: z.array(SectionSchema)
});

export type Section = z.infer<typeof SectionSchema>;
export type Outline = z.infer<typeof OutlineSchema>;

export async function generateOutline(text: string): Promise<Outline> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured. Add it as an environment variable.");
  }

  const systemPrompt = `You are an expert structural analyst specializing in academic and philosophical texts. Your task is to create COMPREHENSIVE, DETAILED outlines that capture the full intellectual structure of a document. Do NOT be threadbare - include substantial detail about arguments, concepts, and key points in each section.`;

  const userPrompt = `Analyze this text and create a DETAILED structural outline:

"""
${text}
"""

Create a comprehensive outline with SUBSTANTIAL DETAIL. For each section, include:
- A clear title
- A DETAILED description (3-5 sentences minimum) explaining what the section covers
- The main points or arguments made (3-8 bullet points per section)
- Key terms or concepts introduced
- Key themes

Output JSON:
{
  "taskSummary": "2-3 sentence comprehensive summary of the entire document's purpose and argument",
  "documentType": "type of document (philosophical treatise, academic paper, essay, etc.)",
  "mainThesis": "the central argument or thesis of the document",
  "totalSections": number,
  "sections": [
    {
      "id": "sec-1",
      "title": "Clear descriptive title",
      "description": "Detailed 3-5 sentence description of what this section covers, the arguments made, and how it connects to the overall thesis",
      "mainPoints": ["First major point or argument", "Second major point", "Third major point"],
      "keyTerms": ["important term 1", "important term 2"],
      "keyThemes": ["theme1", "theme2", "theme3"],
      "wordCount": estimated word count
    }
  ]
}

IMPORTANT: 
- Create 8-20 sections for long documents to capture granular structure
- Each description must be SUBSTANTIVE (not just "discusses X")
- Include specific arguments, not vague summaries
- mainPoints should capture the actual claims and reasoning`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI API Error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  
  if (!content) {
    throw new Error("No response from OpenAI");
  }

  try {
    const parsed = JSON.parse(content);
    return OutlineSchema.parse(parsed);
  } catch {
    const parsed = JSON.parse(content);
    return {
      taskSummary: parsed.taskSummary || "Summary not available",
      documentType: parsed.documentType,
      mainThesis: parsed.mainThesis,
      totalSections: parsed.totalSections || parsed.sections?.length || 0,
      sections: (parsed.sections || []).map((s: any, i: number) => ({
        id: s.id || `sec-${i + 1}`,
        title: s.title || `Section ${i + 1}`,
        description: s.description || "",
        keyThemes: s.keyThemes || [],
        mainPoints: s.mainPoints || [],
        keyTerms: s.keyTerms || [],
        wordCount: s.wordCount || 0
      }))
    };
  }
}
