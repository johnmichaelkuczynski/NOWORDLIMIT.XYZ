import { callLLM } from "../../llm";
import { generateSkeleton, DocumentSkeletonData } from "./skeletonGenerator";
import { chunkText } from "./coherenceProcessor";
import { ProgressUpdate } from "./stateSchemas";

export interface ExtractedArgument {
  author: string;
  conclusion: string;
  premises: string[];
  source: string;
  counterarguments?: string[];
  strength: "strong" | "moderate" | "weak";
  sourceChunk?: number;
  importance?: number;
  argumentType?: string;
}

export interface ArgumentExtractionResult {
  documentId: string;
  arguments: ExtractedArgument[];
  skeleton: DocumentSkeletonData;
  totalExtracted: number;
  markdown?: string;
}

export async function argumentsCoherent(
  text: string,
  options: { author?: string; depth?: number },
  provider: string,
  onProgress?: (progress: ProgressUpdate) => void,
  userId?: number
): Promise<ArgumentExtractionResult> {
  onProgress?.({ phase: "skeleton", message: "Generating document skeleton..." });
  const skeleton = await generateSkeleton(text, provider, userId);

  const chunks = chunkText(text, 1500);
  const allArguments: ExtractedArgument[] = [];
  const depth = options.depth || 7;

  for (let i = 0; i < chunks.length; i++) {
    onProgress?.({
      phase: "extraction",
      currentChunk: i + 1,
      totalChunks: chunks.length,
      message: `Extracting arguments from chunk ${i + 1} of ${chunks.length}...`
    });

    const sectionContext = skeleton.sections.find(s => s.index === i) || skeleton.sections[0];

    const prompt = `Extract formal arguments from this text.

DOCUMENT CONTEXT:
- Main Thesis: ${skeleton.mainThesis}
- Key Arguments: ${skeleton.keyArguments.slice(0, 5).join('; ')}
- This Section's Role: ${sectionContext?.role || 'body'}

CHUNK ${i + 1} OF ${chunks.length}:
${chunks[i]}

TASK:
Extract ${depth} formal arguments that support the thesis: "${skeleton.mainThesis}"

For each argument, identify:
1. The conclusion (what is being argued)
2. The premises (reasons given)
3. Any counterarguments addressed
4. Strength of the argument

Return JSON array:
[
  {
    "conclusion": "The main claim being argued",
    "premises": ["First premise", "Second premise"],
    "counterarguments": ["Counterargument addressed, if any"],
    "strength": "strong|moderate|weak"
  }
]`;

    try {
      const response = await callLLM(provider, prompt);
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const chunkArgs = JSON.parse(jsonMatch[0]);
        allArguments.push(...chunkArgs.map((a: any) => ({ 
          ...a, 
          sourceChunk: i,
          author: options.author || "Unknown",
          source: `Chunk ${i + 1}`,
          importance: a.strength === "strong" ? 1 : a.strength === "moderate" ? 0.5 : 0.3
        })));
      }
    } catch (e) {
      console.error(`Failed to extract arguments from chunk ${i}:`, e);
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  const markdown = formatArgumentsAsMarkdown(allArguments, skeleton);

  return {
    documentId: skeleton.documentId,
    arguments: allArguments,
    skeleton: skeleton,
    totalExtracted: allArguments.length,
    markdown
  };
}

function formatArgumentsAsMarkdown(args: ExtractedArgument[], skeleton: DocumentSkeletonData): string {
  let md = `# Arguments Analysis\n\n`;
  md += `**Main Thesis:** ${skeleton.mainThesis}\n\n`;
  md += `---\n\n`;

  args.forEach((arg, i) => {
    md += `## Argument ${i + 1}\n\n`;
    md += `**Conclusion:** ${arg.conclusion}\n\n`;
    md += `**Premises:**\n`;
    arg.premises.forEach((p, j) => {
      md += `${j + 1}. ${p}\n`;
    });
    md += `\n`;
    if (arg.counterarguments && arg.counterarguments.length > 0) {
      md += `**Counterarguments Addressed:**\n`;
      arg.counterarguments.forEach(c => {
        md += `- ${c}\n`;
      });
      md += `\n`;
    }
    md += `**Strength:** ${arg.strength}\n\n`;
    md += `---\n\n`;
  });

  return md;
}
