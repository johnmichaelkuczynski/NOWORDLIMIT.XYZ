import { callLLM } from "../llm";

export interface TractatusStatement {
  number: string;
  text: string;
  depth: number;
}

export interface TractatusTreeResult {
  columns: TractatusStatement[][];
  maxDepth: number;
  totalStatements: number;
}

function parseTractatusNumber(numStr: string): number[] {
  return numStr.split('.').map(n => parseInt(n, 10)).filter(n => !isNaN(n));
}

function getDepth(numStr: string): number {
  const parts = parseTractatusNumber(numStr);
  if (parts.length === 0) return 0;
  if (parts.length === 1) return 0;
  if (parts.length === 2 && parts[1] === 0) return 0;
  return parts.length - 1;
}

function parseTractatusOutput(text: string): TractatusStatement[] {
  const lines = text.split('\n').filter(line => line.trim());
  const statements: TractatusStatement[] = [];
  
  for (const line of lines) {
    const match = line.match(/^[•\-\*]?\s*(\d+(?:\.\d+)*)\s*[\.:\-]?\s*(.+)$/);
    if (match) {
      const number = match[1];
      const statementText = match[2].trim();
      const depth = getDepth(number);
      statements.push({ number, text: statementText, depth });
    }
  }
  
  return statements;
}

function filterByMaxDepth(statements: TractatusStatement[], maxDepth: number): TractatusStatement[] {
  return statements.filter(s => s.depth <= maxDepth);
}

export function buildTractatusTree(statements: TractatusStatement[]): TractatusTreeResult {
  if (statements.length === 0) {
    return { columns: [], maxDepth: 0, totalStatements: 0 };
  }
  
  const maxDepth = Math.max(...statements.map(s => s.depth));
  const minDepth = Math.min(...statements.map(s => s.depth));
  const columns: TractatusStatement[][] = [];
  
  // Start from the minimum depth found (in case LLM starts at 1.1 instead of 1.0)
  // progressively add more detail up to max depth
  for (let depth = minDepth; depth <= maxDepth; depth++) {
    const columnStatements = filterByMaxDepth(statements, depth);
    // Only add non-empty columns
    if (columnStatements.length > 0) {
      columns.push(columnStatements);
    }
  }
  
  return {
    columns,
    maxDepth,
    totalStatements: statements.length
  };
}

export async function generateTractatusTree(
  text: string,
  provider: string = "openai",
  onProgress?: (progress: { current: number; total: number; message: string }) => void
): Promise<TractatusTreeResult> {
  const wordCount = text.split(/\s+/).length;
  const estimatedSections = Math.ceil(wordCount / 2000);
  
  onProgress?.({ current: 0, total: estimatedSections + 1, message: "Generating Tractatus structure..." });
  
  const prompt = `You are a master of philosophical compression, inspired by Ludwig Wittgenstein's Tractatus Logico-Philosophicus.

Your task is to rewrite the following text as a series of hierarchically numbered propositions. Each proposition must be:
1. A single, self-contained statement expressing one idea
2. Numbered using decimal notation showing logical relationships (1.0, 1.1, 1.1.1, 1.1.2, 1.2, 2.0, etc.)
3. Progressively more specific as the decimal places increase (1.0 is the most general thesis, 1.1 elaborates on it, 1.1.1 further specifies 1.1)

CRITICAL RULES:
- Create a DEEP hierarchy with 3-5 levels of depth (e.g., statements like 2.3.4.1 or even 3.1.2.4.2)
- YOU MUST generate MULTIPLE top-level statements (1.0, 2.0, 3.0, 4.0, etc.) - at least ${Math.max(3, Math.min(10, Math.ceil(wordCount / 500)))} of them
- Top-level statements (1.0, 2.0, 3.0, 4.0, 5.0, etc.) should be broad theses representing DIFFERENT major topics or arguments in the text
- Do NOT put everything under 1.0 - identify the distinct major themes/sections and give each one its own top-level number
- Each sub-level should logically elaborate or specify its parent
- Every statement must stand alone as a meaningful proposition
- Preserve ALL important ideas from the original text
- Use clear, precise language

FORMAT:
1.0 [Top-level thesis]
1.1 [Elaboration of 1.0]
1.1.1 [Specification of 1.1]
1.1.2 [Another specification of 1.1]
1.2 [Another elaboration of 1.0]
1.2.1 [Specification of 1.2]
2.0 [Second top-level thesis]
...

TEXT TO TRANSFORM:
${text}

Generate the hierarchical Tractatus structure now:`;

  const response = await callLLM(provider, prompt);
  
  onProgress?.({ current: 1, total: estimatedSections + 1, message: "Parsing hierarchical structure..." });
  
  const statements = parseTractatusOutput(response);
  
  if (statements.length === 0) {
    const lines = response.split('\n').filter(l => l.trim());
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        statements.push({
          number: `${Math.floor(i / 3) + 1}.${i % 3}`,
          text: line.replace(/^[•\-\*\d\.]+\s*/, ''),
          depth: 1
        });
      }
    }
  }
  
  onProgress?.({ current: estimatedSections + 1, total: estimatedSections + 1, message: "Building tree columns..." });
  
  return buildTractatusTree(statements);
}

export function formatTreeColumn(statements: TractatusStatement[]): string {
  return statements.map(s => `${s.number} ${s.text}`).join('\n');
}
