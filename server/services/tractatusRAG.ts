import { storage } from "../storage";
import { callLLM } from "../llm";
import { PhilosophicalPosition } from "@shared/schema";

export interface RAGContext {
  positions: PhilosophicalPosition[];
  topics: string[];
  thinkers: string[];
}

export async function extractTopicsFromText(text: string, provider: string): Promise<string[]> {
  const sampleText = text.substring(0, 5000);
  
  const prompt = `Analyze this philosophical/academic text and extract the main topics or themes being discussed.

TEXT:
${sampleText}

Return ONLY a JSON array of 3-8 topic strings, e.g., ["ethics", "justice", "natural law"]
No explanations, just the JSON array.`;

  try {
    const response = await callLLM(provider, prompt);
    const match = response.match(/\[[\s\S]*?\]/);
    if (match) {
      return JSON.parse(match[0]) as string[];
    }
  } catch (e) {
    console.error("Failed to extract topics:", e);
  }
  return [];
}

export async function extractThinkerMentions(text: string): Promise<string[]> {
  const commonPhilosophers = [
    "Aristotle", "Plato", "Kant", "Hegel", "Nietzsche", "Wittgenstein",
    "Descartes", "Locke", "Hume", "Hobbes", "Rousseau", "Mill",
    "Bentham", "Rawls", "Nozick", "Dworkin", "Hart", "Fuller",
    "Austin", "Kelsen", "Aquinas", "Augustine", "Marx", "Weber",
    "Foucault", "Derrida", "Habermas", "Popper", "Kuhn", "Quine",
    "Russell", "Frege", "Spinoza", "Leibniz", "Berkeley", "Schopenhauer"
  ];
  
  const textLower = text.toLowerCase();
  const found: string[] = [];
  
  for (const philosopher of commonPhilosophers) {
    if (textLower.includes(philosopher.toLowerCase())) {
      found.push(philosopher);
    }
  }
  
  return found;
}

export async function fetchRelevantPositions(
  text: string,
  provider: string,
  limit: number = 50
): Promise<RAGContext> {
  const topics = await extractTopicsFromText(text, provider);
  const thinkers = await extractThinkerMentions(text);
  
  const positionsSet = new Map<number, PhilosophicalPosition>();
  
  // Search by topics
  for (const topic of topics) {
    const positions = await storage.searchPhilosophicalPositions(topic);
    for (const pos of positions.slice(0, 10)) {
      positionsSet.set(pos.id, pos);
    }
  }
  
  // Search by thinkers
  for (const thinker of thinkers) {
    const positions = await storage.getPhilosophicalPositionsByThinker(thinker);
    for (const pos of positions.slice(0, 10)) {
      positionsSet.set(pos.id, pos);
    }
  }
  
  const positions = Array.from(positionsSet.values()).slice(0, limit);
  
  return {
    positions,
    topics,
    thinkers
  };
}

export function formatPositionsForPrompt(positions: PhilosophicalPosition[]): string {
  if (positions.length === 0) {
    return "";
  }
  
  const grouped: { [thinker: string]: PhilosophicalPosition[] } = {};
  for (const pos of positions) {
    if (!grouped[pos.thinker]) {
      grouped[pos.thinker] = [];
    }
    grouped[pos.thinker].push(pos);
  }
  
  let formatted = "RELEVANT PHILOSOPHICAL POSITIONS FROM DATABASE:\n\n";
  
  for (const [thinker, thinkerPositions] of Object.entries(grouped)) {
    formatted += `=== ${thinker.toUpperCase()} ===\n`;
    for (const pos of thinkerPositions) {
      formatted += `• [${pos.topic}] ${pos.statement}`;
      if (pos.source) {
        formatted += ` (${pos.source})`;
      }
      formatted += "\n";
    }
    formatted += "\n";
  }
  
  return formatted;
}

export function buildRAGEnhancedPrompt(
  basePrompt: string,
  ragContext: RAGContext
): string {
  if (ragContext.positions.length === 0) {
    return basePrompt;
  }
  
  const positionsBlock = formatPositionsForPrompt(ragContext.positions);
  
  return `${positionsBlock}

USE THE ABOVE POSITIONS TO INFORM YOUR OUTPUT:
- Reference these philosophical positions where relevant
- Compare and contrast different thinkers' views on similar topics
- Use these as context for the text analysis
- When the text aligns with or contradicts known positions, note this connection

---

${basePrompt}`;
}
