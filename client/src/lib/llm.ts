export type AnalysisResult = {
  quotes: string[];
  annotatedQuotes: { quote: string; context: string }[];
  summary: string;
  database: string;
  analyzer: string;
  views?: { 
    view: string; 
    stance?: "endorsed" | "rejected" | "attributed";
    attributedTo?: string | null;
    context?: string;
    evidence: string[] 
  }[];
};

export async function analyzeText(
  text: string, 
  provider: string,
  functionType: 'quotes' | 'context' | 'rewrite' | 'database' | 'analyzer' | 'views',
  username?: string
): Promise<AnalysisResult> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ text, provider, functionType, username }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Analysis failed");
  }

  return response.json();
}

export type IntelligenceResult = {
  wordCount: number;
  sharpQuotes: string[];
  quoteCount: number;
  density: number;
  score: number;
  analysis: string;
};

export type IntelligenceCompareResult = {
  textA: IntelligenceResult;
  textB: IntelligenceResult;
  winner: string;
  verdict: string;
};

export async function measureIntelligence(
  text: string,
  provider: string,
  username?: string
): Promise<IntelligenceResult> {
  const response = await fetch("/api/intelligence", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ text, provider, username }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Intelligence analysis failed");
  }

  return response.json();
}

export async function compareIntelligence(
  textA: string,
  textB: string,
  provider: string,
  username?: string
): Promise<IntelligenceCompareResult> {
  const response = await fetch("/api/intelligence/compare", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ textA, textB, provider, username }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Intelligence comparison failed");
  }

  return response.json();
}

export async function analyzeTextStreaming(
  text: string,
  provider: string,
  functionType: 'quotes' | 'context' | 'rewrite' | 'database' | 'analyzer' | 'views',
  onChunk: (chunk: string) => void,
  onComplete?: () => void,
  username?: string
): Promise<void> {
  const response = await fetch("/api/analyze/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ text, provider, functionType, username }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Analysis failed");
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            throw new Error(parsed.error);
          }
          if (parsed.done) {
            onComplete?.();
            return;
          }
          if (parsed.content) {
            onChunk(parsed.content);
          }
        } catch (e) {
          if (e instanceof Error && e.message !== 'Unexpected end of JSON input') {
            throw e;
          }
        }
      }
    }
  }
  
  onComplete?.();
}
