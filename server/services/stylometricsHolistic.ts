import { generateOutline, Outline, Section } from "./outlineService";
import { callLLM } from "../llm";
import { computeRawFeatures, RawFeatures, computeVerticalityScore, getAbstractionLevel, getVerticalityClassification, generateProgressBar } from "../stylometrics";

export interface StylometricsProgress {
  stage: "outlining" | "analyzing" | "calculating" | "comparing" | "complete" | "error";
  message: string;
  current?: number;
  total?: number;
}

export interface SectionStylometrics {
  sectionTitle: string;
  rawFeatures: RawFeatures;
  metaphorDensity: string;
  anecdoteFrequency: string;
  verticalityScore: number;
  signaturePhrases: string[];
  negativeMarkers: string[];
}

export interface HolisticStylometricsResult {
  authorName: string;
  wordCount: number;
  globalRawFeatures: RawFeatures;
  sectionAnalyses: SectionStylometrics[];
  aggregatedVerticalityScore: number;
  classification: string;
  abstractionLevel: string;
  abstractionDescription: string;
  signaturePhrases: string[];
  negativeMarkers: string[];
  closestAuthorMatch: string;
  matchExplanation: string;
  psychologicalProfile: {
    cognitiveEmpathy: string;
    affectiveEmpathy: string;
    needForClosure: string;
    schizoidFeatures: string;
    socialOrientation: string;
    bodySensation: string;
    consensusAttitude: string;
    humorStyle: string;
  };
  narrativeSummary: string;
  signalRatio: number;
  signalScore: number;
  mode: "outline" | "chunk";
}

export interface HolisticComparisonResult {
  textA: HolisticStylometricsResult;
  textB: HolisticStylometricsResult;
  comparison: {
    verticalityDifference: number;
    keyDivergences: {
      feature: string;
      textA: string;
      textB: string;
      analysis: string;
    }[];
    sameRoomScenario: string;
    collaborativePotential: string;
  };
  verdict: string;
}

async function callLLMWithJSON(provider: string, prompt: string): Promise<any> {
  const fullPrompt = prompt + "\n\nIMPORTANT: You must respond with valid JSON only. No markdown, no extra text.";
  const content = await callLLM(provider, fullPrompt);
  
  try {
    return JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]);
    }
    throw new Error("Failed to parse LLM response as JSON");
  }
}

function sliceTextBySections(text: string, sections: Section[]): { section: Section; content: string }[] {
  const result: { section: Section; content: string }[] = [];
  const words = text.split(/\s+/);
  const totalWords = words.length;
  
  let currentPosition = 0;
  
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const sectionWordCount = section.wordCount || Math.floor(totalWords / sections.length);
    
    const sectionStart = currentPosition;
    const sectionEnd = Math.min(currentPosition + sectionWordCount, totalWords);
    
    const sectionWords = words.slice(sectionStart, sectionEnd);
    const content = sectionWords.join(' ');
    
    result.push({ section, content });
    currentPosition = sectionEnd;
  }
  
  return result;
}

function aggregateFeatures(sectionFeatures: RawFeatures[]): RawFeatures {
  if (sectionFeatures.length === 0) {
    return {
      wordCount: 0,
      egoPronounRate: 0,
      avgSentenceLength: 0,
      maxSentenceLength: 0,
      subordinationDepth: 0,
      semicolonFreq: 0,
      colonFreq: 0,
      dashFreq: 0,
      questionFreq: 0,
      impersonalRate: 0
    };
  }
  
  const totalWords = sectionFeatures.reduce((sum, f) => sum + f.wordCount, 0);
  
  const weightedAvg = (key: keyof RawFeatures) => {
    if (key === 'wordCount' || key === 'maxSentenceLength') return 0;
    const sum = sectionFeatures.reduce((acc, f) => acc + (f[key] as number) * f.wordCount, 0);
    return totalWords > 0 ? sum / totalWords : 0;
  };
  
  return {
    wordCount: totalWords,
    egoPronounRate: Math.round(weightedAvg('egoPronounRate') * 100) / 100,
    avgSentenceLength: Math.round(weightedAvg('avgSentenceLength') * 10) / 10,
    maxSentenceLength: Math.max(...sectionFeatures.map(f => f.maxSentenceLength)),
    subordinationDepth: Math.round(weightedAvg('subordinationDepth') * 10) / 10,
    semicolonFreq: Math.round(weightedAvg('semicolonFreq') * 100) / 100,
    colonFreq: Math.round(weightedAvg('colonFreq') * 100) / 100,
    dashFreq: Math.round(weightedAvg('dashFreq') * 100) / 100,
    questionFreq: Math.round(weightedAvg('questionFreq') * 100) / 100,
    impersonalRate: Math.round(weightedAvg('impersonalRate') * 100) / 100
  };
}

function calculateSignalRatio(sectionAnalyses: SectionStylometrics[], totalTextLength: number): number {
  let highAbstractionLength = 0;
  
  for (const section of sectionAnalyses) {
    if (section.verticalityScore >= 0.6) {
      highAbstractionLength += section.rawFeatures.wordCount * 5;
    } else if (section.verticalityScore >= 0.4) {
      highAbstractionLength += section.rawFeatures.wordCount * 3;
    }
  }
  
  return totalTextLength > 0 ? Math.min(1, highAbstractionLength / totalTextLength) : 0;
}

export async function analyzeStylometricsHolistic(
  text: string,
  provider: string,
  authorName: string,
  onProgress?: (progress: StylometricsProgress) => void
): Promise<HolisticStylometricsResult> {
  const globalRawFeatures = computeRawFeatures(text);
  
  onProgress?.({ stage: "outlining", message: "Generating structural outline..." });
  
  let outline: Outline;
  try {
    outline = await generateOutline(text.substring(0, 100000));
    if (!outline.sections || outline.sections.length === 0) {
      throw new Error("Outline generation returned no sections");
    }
  } catch (error: any) {
    onProgress?.({ stage: "outlining", message: "Outline failed, using chunk mode..." });
    return analyzeStylometricsChunked(text, provider, authorName, onProgress);
  }
  
  onProgress?.({ 
    stage: "outlining", 
    message: `Outline complete: ${outline.sections.length} sections` 
  });
  
  const slicedSections = sliceTextBySections(text, outline.sections);
  const sectionAnalyses: SectionStylometrics[] = [];
  const allSignaturePhrases: string[] = [];
  const allNegativeMarkers: string[] = [];
  
  for (let i = 0; i < slicedSections.length; i++) {
    const { section, content } = slicedSections[i];
    
    onProgress?.({
      stage: "analyzing",
      message: `Analyzing section ${i + 1}/${slicedSections.length}: "${section.title}"`,
      current: i + 1,
      total: slicedSections.length
    });
    
    if (content.trim().length < 100) continue;
    
    const sectionRawFeatures = computeRawFeatures(content);
    
    const sectionPrompt = `You are a stylometric analyzer. Analyze this text section with full context from the document outline.

DOCUMENT CONTEXT:
- Full Document Summary: ${outline.taskSummary}
- All Sections: ${outline.sections.map(s => s.title).join(", ")}
- Current Section: "${section.title}" (${i + 1}/${outline.sections.length})
- Section Themes: ${section.keyThemes.join(", ")}

SECTION TEXT (${sectionRawFeatures.wordCount} words):
"""
${content.substring(0, 15000)}
"""

PRE-COMPUTED FEATURES:
- Ego-pronoun rate: ${sectionRawFeatures.egoPronounRate} per 1000 words
- Average sentence length: ${sectionRawFeatures.avgSentenceLength} words
- Subordination depth: ${sectionRawFeatures.subordinationDepth}
- Semicolon frequency: ${sectionRawFeatures.semicolonFreq} per 1000 words
- Dash frequency: ${sectionRawFeatures.dashFreq} per 1000 words
- Rhetorical question rate: ${sectionRawFeatures.questionFreq} per 1000 words
- Impersonal rate: ${sectionRawFeatures.impersonalRate} per 1000 words

TASK: Analyze stylometric features for this section.

1. CLASSIFY metaphor density: none / low / moderate / high
2. CLASSIFY anecdote frequency: none / rare / occasional / frequent
3. IDENTIFY 3-5 signature phrases (verbal tics, scaffolding phrases, characteristic patterns)
4. IDENTIFY 2-3 negative markers (things author avoids)

Output JSON only:
{
  "metaphorDensity": "none|low|moderate|high",
  "anecdoteFrequency": "none|rare|occasional|frequent",
  "signaturePhrases": ["phrase1", "phrase2", ...],
  "negativeMarkers": ["marker1", "marker2", ...]
}`;

    try {
      const sectionResult = await callLLMWithJSON(provider, sectionPrompt);
      
      const metaphorDensity = sectionResult.metaphorDensity || "moderate";
      const anecdoteFrequency = sectionResult.anecdoteFrequency || "occasional";
      const verticalityScore = computeVerticalityScore(sectionRawFeatures, metaphorDensity, anecdoteFrequency);
      
      sectionAnalyses.push({
        sectionTitle: section.title,
        rawFeatures: sectionRawFeatures,
        metaphorDensity,
        anecdoteFrequency,
        verticalityScore,
        signaturePhrases: sectionResult.signaturePhrases || [],
        negativeMarkers: sectionResult.negativeMarkers || []
      });
      
      allSignaturePhrases.push(...(sectionResult.signaturePhrases || []));
      allNegativeMarkers.push(...(sectionResult.negativeMarkers || []));
    } catch (error) {
      console.error(`Error analyzing section ${i + 1}:`, error);
      const verticalityScore = computeVerticalityScore(sectionRawFeatures, "moderate", "occasional");
      sectionAnalyses.push({
        sectionTitle: section.title,
        rawFeatures: sectionRawFeatures,
        metaphorDensity: "moderate",
        anecdoteFrequency: "occasional",
        verticalityScore,
        signaturePhrases: [],
        negativeMarkers: []
      });
    }
  }
  
  onProgress?.({ stage: "calculating", message: "Aggregating results and generating profile..." });
  
  const aggregatedFeatures = aggregateFeatures(sectionAnalyses.map(s => s.rawFeatures));
  const avgVerticality = sectionAnalyses.length > 0 
    ? sectionAnalyses.reduce((sum, s) => sum + s.verticalityScore * s.rawFeatures.wordCount, 0) / 
      sectionAnalyses.reduce((sum, s) => sum + s.rawFeatures.wordCount, 0)
    : 0;
  
  const uniqueSignatures = Array.from(new Set(allSignaturePhrases)).slice(0, 15);
  const uniqueNegatives = Array.from(new Set(allNegativeMarkers)).slice(0, 10);
  
  const abstraction = getAbstractionLevel(avgVerticality);
  const classification = getVerticalityClassification(avgVerticality);
  
  const profilePrompt = `Based on this stylometric analysis of ${authorName}'s text:

VERTICALITY: ${avgVerticality.toFixed(2)} (${classification})
ABSTRACTION: ${abstraction.level}
EGO-PRONOUN RATE: ${aggregatedFeatures.egoPronounRate} per 1000 words
IMPERSONAL RATE: ${aggregatedFeatures.impersonalRate} per 1000 words
AVG SENTENCE LENGTH: ${aggregatedFeatures.avgSentenceLength} words
SUBORDINATION DEPTH: ${aggregatedFeatures.subordinationDepth}
SIGNATURE PHRASES: ${uniqueSignatures.slice(0, 8).join(", ")}

Generate psychological profile and author matching.

Output JSON:
{
  "closestAuthorMatch": "Author Name from reference list",
  "matchExplanation": "Why this author matches",
  "psychologicalProfile": {
    "cognitiveEmpathy": "none|low|moderate|high|extreme",
    "affectiveEmpathy": "none|low|moderate|high|extreme",
    "needForClosure": "low|moderate|high|extreme",
    "schizoidFeatures": "absent|mild|moderate|marked|extreme",
    "socialOrientation": "solitary|reserved|moderate|social|highly_social",
    "bodySensation": "disembodied|low|moderate|embodied|hyper_embodied",
    "consensusAttitude": "respectful|neutral|skeptical|dismissive|contemptuous",
    "humorStyle": "none|dry_rare|ironic|warm|frequent_performative"
  },
  "narrativeSummary": "3-5 sentence blunt psychological portrait"
}

REFERENCE LIST for closestAuthorMatch:
EXTREME VERTICAL (0.85-1.00): Gottlob Frege, Ernest Nagel, Arthur Schopenhauer, Carl Hempel, Timothy Williamson
HIGH VERTICAL (0.70-0.84): Bertrand Russell, W.V.O. Quine, Saul Kripke, Donald Davidson
MID-RANGE (0.40-0.69): David Hume, Adam Smith, John Stuart Mill, Sigmund Freud, Gilbert Ryle, George Orwell
LOW VERTICAL (0.20-0.39): William James, Voltaire, David Foster Wallace, Virginia Woolf
EXTREME HORIZONTAL (0.00-0.19): James Joyce (Finnegans Wake), Jack Kerouac`;

  let profileResult = {
    closestAuthorMatch: "Unknown",
    matchExplanation: "Could not determine",
    psychologicalProfile: {
      cognitiveEmpathy: "moderate",
      affectiveEmpathy: "moderate",
      needForClosure: "moderate",
      schizoidFeatures: "absent",
      socialOrientation: "moderate",
      bodySensation: "moderate",
      consensusAttitude: "neutral",
      humorStyle: "dry_rare"
    },
    narrativeSummary: "Analysis incomplete."
  };
  
  try {
    profileResult = await callLLMWithJSON(provider, profilePrompt);
  } catch (error) {
    console.error("Profile generation failed:", error);
  }
  
  const signalRatio = calculateSignalRatio(sectionAnalyses, text.length);
  const signalScore = Math.round(signalRatio * 100);
  
  onProgress?.({ stage: "complete", message: `Analysis complete: Verticality ${avgVerticality.toFixed(2)}` });
  
  return {
    authorName,
    wordCount: globalRawFeatures.wordCount,
    globalRawFeatures,
    sectionAnalyses,
    aggregatedVerticalityScore: Math.round(avgVerticality * 100) / 100,
    classification,
    abstractionLevel: abstraction.level,
    abstractionDescription: abstraction.description,
    signaturePhrases: uniqueSignatures,
    negativeMarkers: uniqueNegatives,
    closestAuthorMatch: profileResult.closestAuthorMatch || "Unknown",
    matchExplanation: profileResult.matchExplanation || "",
    psychologicalProfile: profileResult.psychologicalProfile || {
      cognitiveEmpathy: "moderate",
      affectiveEmpathy: "moderate",
      needForClosure: "moderate",
      schizoidFeatures: "absent",
      socialOrientation: "moderate",
      bodySensation: "moderate",
      consensusAttitude: "neutral",
      humorStyle: "dry_rare"
    },
    narrativeSummary: profileResult.narrativeSummary || "",
    signalRatio: Math.round(signalRatio * 1000) / 1000,
    signalScore,
    mode: "outline"
  };
}

async function analyzeStylometricsChunked(
  text: string,
  provider: string,
  authorName: string,
  onProgress?: (progress: StylometricsProgress) => void
): Promise<HolisticStylometricsResult> {
  const globalRawFeatures = computeRawFeatures(text);
  const verticalityScore = computeVerticalityScore(globalRawFeatures, "moderate", "occasional");
  const abstraction = getAbstractionLevel(verticalityScore);
  const classification = getVerticalityClassification(verticalityScore);
  
  onProgress?.({ stage: "analyzing", message: "Analyzing text (chunk mode)..." });
  
  const signalRatio = verticalityScore >= 0.6 ? 0.7 : verticalityScore >= 0.4 ? 0.4 : 0.2;
  
  onProgress?.({ stage: "complete", message: `Analysis complete: Verticality ${verticalityScore.toFixed(2)}` });
  
  return {
    authorName,
    wordCount: globalRawFeatures.wordCount,
    globalRawFeatures,
    sectionAnalyses: [],
    aggregatedVerticalityScore: verticalityScore,
    classification,
    abstractionLevel: abstraction.level,
    abstractionDescription: abstraction.description,
    signaturePhrases: [],
    negativeMarkers: [],
    closestAuthorMatch: "Unknown",
    matchExplanation: "Chunk mode - limited analysis",
    psychologicalProfile: {
      cognitiveEmpathy: "moderate",
      affectiveEmpathy: "moderate",
      needForClosure: "moderate",
      schizoidFeatures: "absent",
      socialOrientation: "moderate",
      bodySensation: "moderate",
      consensusAttitude: "neutral",
      humorStyle: "dry_rare"
    },
    narrativeSummary: "Analysis performed in chunk mode with limited context.",
    signalRatio,
    signalScore: Math.round(signalRatio * 100),
    mode: "chunk"
  };
}

export async function compareStylometricsHolistic(
  textA: string,
  textB: string,
  provider: string,
  authorNameA: string,
  authorNameB: string,
  onProgress?: (progress: StylometricsProgress) => void
): Promise<HolisticComparisonResult> {
  onProgress?.({ stage: "analyzing", message: "Analyzing Text A..." });
  const resultA = await analyzeStylometricsHolistic(textA, provider, authorNameA, (p) => {
    onProgress?.({ ...p, message: `Text A: ${p.message}` });
  });
  
  onProgress?.({ stage: "analyzing", message: "Analyzing Text B..." });
  const resultB = await analyzeStylometricsHolistic(textB, provider, authorNameB, (p) => {
    onProgress?.({ ...p, message: `Text B: ${p.message}` });
  });
  
  onProgress?.({ stage: "comparing", message: "Generating comparison..." });
  
  const verticalityDifference = Math.abs(resultA.aggregatedVerticalityScore - resultB.aggregatedVerticalityScore);
  
  const comparisonPrompt = `Compare two authors' stylometric profiles:

TEXT A - ${authorNameA}:
- Verticality: ${resultA.aggregatedVerticalityScore.toFixed(2)} (${resultA.classification})
- Abstraction: ${resultA.abstractionLevel}
- Signature phrases: ${resultA.signaturePhrases.slice(0, 5).join(", ")}
- Closest match: ${resultA.closestAuthorMatch}

TEXT B - ${authorNameB}:
- Verticality: ${resultB.aggregatedVerticalityScore.toFixed(2)} (${resultB.classification})
- Abstraction: ${resultB.abstractionLevel}
- Signature phrases: ${resultB.signaturePhrases.slice(0, 5).join(", ")}
- Closest match: ${resultB.closestAuthorMatch}

Generate comparison analysis as JSON:
{
  "keyDivergences": [
    {"feature": "feature name", "textA": "value", "textB": "value", "analysis": "meaning"}
  ],
  "sameRoomScenario": "vivid paragraph describing if these authors met",
  "collaborativePotential": "assessment of working together",
  "verdict": "2-3 sentence fundamental difference summary"
}`;

  let comparisonResult = {
    keyDivergences: [] as { feature: string; textA: string; textB: string; analysis: string }[],
    sameRoomScenario: "Analysis incomplete.",
    collaborativePotential: "Unknown",
    verdict: `${authorNameA} vs ${authorNameB}: Verticality difference of ${verticalityDifference.toFixed(2)}`
  };
  
  try {
    comparisonResult = await callLLMWithJSON(provider, comparisonPrompt);
  } catch (error) {
    console.error("Comparison generation failed:", error);
  }
  
  onProgress?.({ stage: "complete", message: "Comparison complete" });
  
  return {
    textA: resultA,
    textB: resultB,
    comparison: {
      verticalityDifference: Math.round(verticalityDifference * 100) / 100,
      keyDivergences: comparisonResult.keyDivergences || [],
      sameRoomScenario: comparisonResult.sameRoomScenario || "",
      collaborativePotential: comparisonResult.collaborativePotential || ""
    },
    verdict: comparisonResult.verdict || ""
  };
}
