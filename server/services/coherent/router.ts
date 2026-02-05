import { ProgressUpdate } from "./stateSchemas";

const WORD_COUNT_THRESHOLD = 2000;

export function shouldUseCoherentProcessing(text: string): boolean {
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
  return wordCount >= WORD_COUNT_THRESHOLD;
}

export function getWordCount(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

export async function routeFullRewrite(
  text: string,
  instructions: string,
  provider: string,
  onProgress?: (progress: ProgressUpdate) => void,
  userId?: number
) {
  if (shouldUseCoherentProcessing(text)) {
    const { fullRewriteCoherent } = await import("./fullRewriteCoherent");
    return fullRewriteCoherent(text, instructions, provider, onProgress, userId);
  } else {
    return { rewrittenText: text, mode: "legacy" };
  }
}

export async function routePositions(
  text: string,
  options: { author?: string; depth?: number; showMinor?: boolean },
  provider: string,
  onProgress?: (progress: ProgressUpdate) => void,
  userId?: number
) {
  if (shouldUseCoherentProcessing(text)) {
    const { positionsCoherent } = await import("./positionsCoherent");
    return positionsCoherent(text, options, provider, onProgress, userId);
  } else {
    const { extractPositionsHolistic } = await import("../positionExtractor");
    return extractPositionsHolistic(text, provider, undefined, true);
  }
}

export async function routeQuotes(
  text: string,
  options: { author?: string; depth?: number },
  provider: string,
  onProgress?: (progress: ProgressUpdate) => void,
  userId?: number
) {
  if (shouldUseCoherentProcessing(text)) {
    const { quotesCoherent } = await import("./quotesCoherent");
    return quotesCoherent(text, options, provider, onProgress, userId);
  } else {
    const { extractQuotesHolistic } = await import("../quoteExtractor");
    return extractQuotesHolistic(text, provider, options.author || "Unknown", undefined, true);
  }
}

export async function routeArguments(
  text: string,
  options: { author?: string; depth?: number },
  provider: string,
  onProgress?: (progress: ProgressUpdate) => void,
  userId?: number
) {
  if (shouldUseCoherentProcessing(text)) {
    const { argumentsCoherent } = await import("./argumentsCoherent");
    return argumentsCoherent(text, options, provider, onProgress, userId);
  } else {
    const { extractArgumentsWithOutline } = await import("../argumentExtractor");
    return extractArgumentsWithOutline(text, provider, options.author, undefined, options.depth);
  }
}

export async function routeTractatus(
  text: string,
  options: { showBullets?: boolean },
  provider: string,
  onProgress?: (progress: ProgressUpdate) => void,
  userId?: number
) {
  if (shouldUseCoherentProcessing(text)) {
    const { tractatusCoherent } = await import("./tractatusCoherent");
    return tractatusCoherent(text, options, provider, onProgress, userId);
  } else {
    const { rewriteAsTractatusSimple } = await import("../tractatusRewrite");
    return rewriteAsTractatusSimple(text, provider, options.showBullets);
  }
}

export async function routeIntelligence(
  text: string,
  provider: string,
  author?: string,
  onProgress?: (progress: ProgressUpdate) => void,
  userId?: number
) {
  const { analyzeIntelligenceHolistic } = await import("../intelligenceAnalyzer");
  return analyzeIntelligenceHolistic(text, provider, author, onProgress, true);
}

export async function routeCustom(
  text: string,
  instructions: string,
  provider: string,
  onProgress?: (progress: ProgressUpdate) => void,
  userId?: number
) {
  if (shouldUseCoherentProcessing(text)) {
    const { customCoherent } = await import("./customCoherent");
    return customCoherent(text, instructions, provider, onProgress, userId);
  } else {
    const { runCustomAnalysisWithOutline } = await import("../customAnalyzer");
    return runCustomAnalysisWithOutline(text, provider, instructions, undefined);
  }
}

export async function routeOutline(
  text: string,
  provider: string,
  onProgress?: (progress: ProgressUpdate) => void,
  userId?: number
) {
  if (shouldUseCoherentProcessing(text)) {
    const { outlineCoherent } = await import("./outlineCoherent");
    return outlineCoherent(text, provider, onProgress, userId);
  } else {
    const { generateOutline } = await import("../outlineService");
    return generateOutline(text);
  }
}
