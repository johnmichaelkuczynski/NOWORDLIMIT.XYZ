export interface RawFeatures {
  wordCount: number;
  egoPronounRate: number;
  avgSentenceLength: number;
  maxSentenceLength: number;
  subordinationDepth: number;
  semicolonFreq: number;
  colonFreq: number;
  dashFreq: number;
  questionFreq: number;
  impersonalRate: number;
}

export interface StylometricAnalysis {
  rawFeatures: RawFeatures;
  metaphorDensity?: string;
  anecdoteFrequency?: string;
  verticalityScore: number;
  abstractionLevel: string;
  abstractionDescription: string;
}

export function computeRawFeatures(text: string): RawFeatures {
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  
  const egoPronounsList = ['i', 'me', 'my', 'mine', 'myself', 'we', 'us', 'our', 'ours', 'ourselves'];
  const egoPronounCount = words.filter(word => 
    egoPronounsList.includes(word.toLowerCase().replace(/[.,;:!?"']/g, ''))
  ).length;
  const egoPronounRate = wordCount > 0 ? (egoPronounCount / wordCount) * 1000 : 0;
  
  const sentences = text.split(/[.!?]+\s+/).filter(s => s.split(/\s+/).filter(Boolean).length > 2);
  const sentenceWordCounts = sentences.map(s => s.split(/\s+/).filter(Boolean).length);
  const avgSentenceLength = sentenceWordCounts.length > 0 
    ? sentenceWordCounts.reduce((a, b) => a + b, 0) / sentenceWordCounts.length 
    : 0;
  const maxSentenceLength = sentenceWordCounts.length > 0 ? Math.max(...sentenceWordCounts) : 0;
  
  const subordinators = [
    'that', 'which', 'who', 'whom', 'whose', 'where', 'when', 'while',
    'although', 'because', 'since', 'if', 'unless', 'until', 'before',
    'after', 'as', 'whereas', 'whenever', 'wherever', 'whether'
  ];
  const subordinatorCount = words.filter(word => 
    subordinators.includes(word.toLowerCase().replace(/[.,;:]/g, ''))
  ).length;
  const subordinationDepth = sentences.length > 0 
    ? Math.min(7, Math.max(1, (subordinatorCount / sentences.length) * 1.5))
    : 1;
  
  const semicolonCount = (text.match(/;/g) || []).length;
  const colonCount = (text.match(/:/g) || []).length - (text.match(/\d:\d/g) || []).length;
  const dashCount = (text.match(/—/g) || []).length + (text.match(/--/g) || []).length;
  const questionCount = (text.match(/\?/g) || []).length;
  
  const semicolonFreq = wordCount > 0 ? (semicolonCount / wordCount) * 1000 : 0;
  const colonFreq = wordCount > 0 ? (Math.max(0, colonCount) / wordCount) * 1000 : 0;
  const dashFreq = wordCount > 0 ? (dashCount / wordCount) * 1000 : 0;
  const questionFreq = wordCount > 0 ? (questionCount / wordCount) * 1000 : 0;
  
  const impersonalPatterns = [
    /\bit is\b/gi, /\bit was\b/gi, /\bit has been\b/gi, /\bit would be\b/gi,
    /\bthere is\b/gi, /\bthere are\b/gi, /\bthere was\b/gi, /\bthere were\b/gi,
    /\bthere exists?\b/gi, /\bone may\b/gi, /\bone can\b/gi, /\bone cannot\b/gi,
    /\bone must\b/gi, /\bone might\b/gi, /\bthis does not mean\b/gi,
    /\bwhat this indicates\b/gi, /\bit is to be noted\b/gi, /\bto the extent that\b/gi,
    /\binsofar as\b/gi, /\binasmuch as\b/gi
  ];
  const impersonalCount = impersonalPatterns.reduce((count, pattern) => 
    count + (text.match(pattern) || []).length, 0
  );
  const impersonalRate = wordCount > 0 ? (impersonalCount / wordCount) * 1000 : 0;
  
  return {
    wordCount,
    egoPronounRate: Math.round(egoPronounRate * 100) / 100,
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    maxSentenceLength,
    subordinationDepth: Math.round(subordinationDepth * 10) / 10,
    semicolonFreq: Math.round(semicolonFreq * 100) / 100,
    colonFreq: Math.round(colonFreq * 100) / 100,
    dashFreq: Math.round(dashFreq * 100) / 100,
    questionFreq: Math.round(questionFreq * 100) / 100,
    impersonalRate: Math.round(impersonalRate * 100) / 100
  };
}

function normalize(value: number, minVal: number, maxVal: number): number {
  return Math.max(0, Math.min(1, (value - minVal) / (maxVal - minVal)));
}

export function computeVerticalityScore(
  rawFeatures: RawFeatures, 
  metaphorDensity: string = 'moderate', 
  anecdoteFrequency: string = 'occasional'
): number {
  const metaphorScores: Record<string, number> = { 
    'none': 1.0, 'low': 0.75, 'moderate': 0.5, 'high': 0.0 
  };
  const anecdoteScores: Record<string, number> = { 
    'none': 1.0, 'rare': 0.75, 'occasional': 0.5, 'frequent': 0.0 
  };
  
  const verticality = (
    0.25 * (1 - normalize(rawFeatures.egoPronounRate, 0, 80)) +
    0.15 * normalize(rawFeatures.impersonalRate, 0, 20) +
    0.15 * normalize(rawFeatures.subordinationDepth, 1, 7) +
    0.10 * normalize(rawFeatures.semicolonFreq, 0, 15) +
    0.10 * (1 - normalize(rawFeatures.dashFreq, 0, 20)) +
    0.10 * (1 - normalize(rawFeatures.questionFreq, 0, 10)) +
    0.075 * (metaphorScores[metaphorDensity] ?? 0.5) +
    0.075 * (anecdoteScores[anecdoteFrequency] ?? 0.5)
  );
  
  return Math.round(Math.max(0, Math.min(1, verticality)) * 100) / 100;
}

export function getAbstractionLevel(verticalityScore: number): { level: string; description: string } {
  if (verticalityScore >= 0.85) {
    return {
      level: "Extreme Abstraction",
      description: "Prose operates at the level of pure logical relations. No particulars survive. Variables, not names. Structure, not story."
    };
  } else if (verticalityScore >= 0.60) {
    return {
      level: "High Abstraction",
      description: "Conceptual architecture dominates. Concrete examples appear but are subordinated to logical structure."
    };
  } else if (verticalityScore >= 0.40) {
    return {
      level: "Mixed",
      description: "Abstraction and particularity in tension. Neither dominates."
    };
  } else if (verticalityScore >= 0.20) {
    return {
      level: "Low Abstraction",
      description: "Concrete particulars dominate. Concepts emerge from stories, examples, and sensory detail."
    };
  } else {
    return {
      level: "Extreme Concreteness",
      description: "Pure sensory/narrative immersion. Abstraction dissolved into bodies, voices, and experience."
    };
  }
}

export function getVerticalityClassification(score: number): string {
  if (score >= 0.85) return "Extreme Vertical";
  if (score >= 0.70) return "High Vertical";
  if (score >= 0.40) return "Mid-Range";
  if (score >= 0.20) return "Low Vertical / Moderate Horizontal";
  return "Extreme Horizontal";
}

export function generateProgressBar(score: number): string {
  const filledCount = Math.round(score * 40);
  const emptyCount = 40 - filledCount;
  return `[${'█'.repeat(filledCount)}${'░'.repeat(emptyCount)}]`;
}

export function buildSingleTextPrompt(
  authorName: string,
  sourceTitle: string,
  text: string,
  rawFeatures: RawFeatures
): string {
  return `You are a stylometric analyst. Analyze the following text and produce a detailed stylometric report.

AUTHOR NAME: ${authorName}
SOURCE/TITLE: ${sourceTitle || 'Not provided'}
WORD COUNT: ${rawFeatures.wordCount}

TEXT:
"""
${text}
"""

PRE-COMPUTED FEATURES (use these exact values):
- Ego-pronoun rate: ${rawFeatures.egoPronounRate} per 1000 words
- Average sentence length: ${rawFeatures.avgSentenceLength} words
- Max sentence length: ${rawFeatures.maxSentenceLength} words
- Subordination depth: ${rawFeatures.subordinationDepth} (1-7 scale)
- Semicolon frequency: ${rawFeatures.semicolonFreq} per 1000 words
- Colon frequency: ${rawFeatures.colonFreq} per 1000 words
- Dash frequency: ${rawFeatures.dashFreq} per 1000 words
- Rhetorical question rate: ${rawFeatures.questionFreq} per 1000 words
- Impersonal construction rate: ${rawFeatures.impersonalRate} per 1000 words

YOUR TASK:

1. CLASSIFY metaphor density as: none / low / moderate / high
   - none = zero metaphors or figurative language
   - low = 1-2 instances per 1000 words
   - moderate = 3-5 instances per 1000 words
   - high = 6+ instances per 1000 words

2. CLASSIFY anecdote frequency as: none / rare / occasional / frequent
   - none = zero personal stories or concrete narrative examples
   - rare = 1 brief anecdote
   - occasional = 2-3 anecdotes
   - frequent = anecdotes throughout, narrative-driven

3. COMPUTE verticality score using this formula:
   verticality = (
     0.25 × (1 - ego_pronoun_rate/80) +
     0.15 × (impersonal_rate/20) +
     0.15 × (subordination_depth/7) +
     0.10 × (semicolon_freq/15) +
     0.10 × (1 - dash_freq/20) +
     0.10 × (1 - question_freq/10) +
     0.075 × metaphor_score +
     0.075 × anecdote_score
   )
   where metaphor_score: none=1.0, low=0.75, moderate=0.5, high=0.0
   and anecdote_score: none=1.0, rare=0.75, occasional=0.5, frequent=0.0
   Clamp result to [0.00, 1.00]

4. DETERMINE abstraction level based on verticality score:
   - 0.85-1.00 = "Extreme Abstraction" — Prose operates at the level of pure logical relations. No particulars survive.
   - 0.60-0.84 = "High Abstraction" — Conceptual architecture dominates. Concrete examples subordinated to structure.
   - 0.40-0.59 = "Mixed" — Abstraction and particularity in tension.
   - 0.20-0.39 = "Low Abstraction" — Concrete particulars dominate. Concepts emerge from stories.
   - 0.00-0.19 = "Extreme Concreteness" — Pure sensory/narrative immersion. Abstraction dissolved into experience.

5. IDENTIFY 8-15 signature phrases and constructions (verbal tics, scaffolding phrases, characteristic patterns)

6. IDENTIFY 5-10 negative markers (things this author NEVER or almost never does)

7. SELECT 3-5 sample sentences that best exemplify the author's style

8. IDENTIFY closest author match from this reference list:
   EXTREME VERTICAL (0.85-1.00): Gottlob Frege, Ernest Nagel, John-Michael Kuczynski, Arthur Schopenhauer, Carl Hempel, Timothy Williamson, Wittgenstein (Tractatus)
   HIGH VERTICAL (0.70-0.84): Bertrand Russell (technical), W.V.O. Quine, Saul Kripke, Donald Davidson, Kit Fine
   MID-RANGE (0.40-0.69): David Hume, Adam Smith, John Stuart Mill, Sigmund Freud, Gilbert Ryle, J.L. Austin, Joan Didion, Annie Dillard, George Orwell
   LOW VERTICAL (0.20-0.39): William James, Voltaire, Wittgenstein (Investigations), David Foster Wallace, Henry James, Virginia Woolf
   EXTREME HORIZONTAL (0.00-0.19): James Joyce (Finnegans Wake), Jack Kerouac, William S. Burroughs
   
   Explain WHY this author is the closest match (specific shared features).

9. GENERATE psychological profile:
   - Cognitive empathy: none / low / moderate / high / extreme
   - Affective empathy: none / low / moderate / high / extreme
   - Need for closure: low / moderate / high / extreme
   - Schizoid features: absent / mild / moderate / marked / extreme
   - Social orientation: solitary / reserved / moderate / social / highly_social
   - Body/sensation: disembodied / low / moderate / embodied / hyper_embodied
   - Consensus attitude: respectful / neutral / skeptical / dismissive / contemptuous
   - Humor style: none / dry_rare / ironic / warm / frequent_performative

10. WRITE a 3-5 sentence narrative psychological summary. Be BLUNT and SPECIFIC. Do not hedge.

11. IDENTIFY clustering:
    - Very close to: (1-3 authors from reference list)
    - Moderately close to: (2-4 authors)
    - Far from: (2-4 authors)

OUTPUT FORMAT - Your response must be valid JSON with this exact structure:
{
  "metaphorDensity": "none|low|moderate|high",
  "anecdoteFrequency": "none|rare|occasional|frequent",
  "verticalityScore": 0.00,
  "classification": "string",
  "abstractionLevel": "string",
  "abstractionDescription": "string",
  "signaturePhrases": ["phrase1", "phrase2", ...],
  "negativeMarkers": ["marker1", "marker2", ...],
  "sampleSentences": [
    {"text": "sentence text", "source": "source attribution"},
    ...
  ],
  "closestAuthorMatch": "Author Name",
  "matchExplanation": "explanation",
  "secondaryMatch": "Author Name or null",
  "farFrom": ["Author1", "Author2", ...],
  "psychologicalProfile": {
    "cognitiveEmpathy": "level",
    "affectiveEmpathy": "level",
    "needForClosure": "level",
    "schizoidFeatures": "level",
    "socialOrientation": "level",
    "bodySensation": "level",
    "consensusAttitude": "level",
    "humorStyle": "level"
  },
  "narrativeSummary": "3-5 sentence blunt psychological portrait",
  "clustering": {
    "veryCloseTo": ["author1", "author2"],
    "moderatelyCloseTo": ["author1", "author2", "author3"],
    "farFrom": ["author1", "author2"]
  }
}`;
}

export function buildComparisonPrompt(
  textA: { authorName: string; text: string; rawFeatures: RawFeatures },
  textB: { authorName: string; text: string; rawFeatures: RawFeatures }
): string {
  return `You are a stylometric analyst. Compare the following two texts and produce a detailed comparative stylometric report.

TEXT A:
Author/Label: ${textA.authorName}
Word Count: ${textA.rawFeatures.wordCount}
"""
${textA.text}
"""

TEXT A PRE-COMPUTED FEATURES:
- Ego-pronoun rate: ${textA.rawFeatures.egoPronounRate} per 1000 words
- Average sentence length: ${textA.rawFeatures.avgSentenceLength} words
- Max sentence length: ${textA.rawFeatures.maxSentenceLength} words
- Subordination depth: ${textA.rawFeatures.subordinationDepth}
- Semicolon frequency: ${textA.rawFeatures.semicolonFreq} per 1000 words
- Colon frequency: ${textA.rawFeatures.colonFreq} per 1000 words
- Dash frequency: ${textA.rawFeatures.dashFreq} per 1000 words
- Rhetorical question rate: ${textA.rawFeatures.questionFreq} per 1000 words
- Impersonal construction rate: ${textA.rawFeatures.impersonalRate} per 1000 words

TEXT B:
Author/Label: ${textB.authorName}
Word Count: ${textB.rawFeatures.wordCount}
"""
${textB.text}
"""

TEXT B PRE-COMPUTED FEATURES:
- Ego-pronoun rate: ${textB.rawFeatures.egoPronounRate} per 1000 words
- Average sentence length: ${textB.rawFeatures.avgSentenceLength} words
- Max sentence length: ${textB.rawFeatures.maxSentenceLength} words
- Subordination depth: ${textB.rawFeatures.subordinationDepth}
- Semicolon frequency: ${textB.rawFeatures.semicolonFreq} per 1000 words
- Colon frequency: ${textB.rawFeatures.colonFreq} per 1000 words
- Dash frequency: ${textB.rawFeatures.dashFreq} per 1000 words
- Rhetorical question rate: ${textB.rawFeatures.questionFreq} per 1000 words
- Impersonal construction rate: ${textB.rawFeatures.impersonalRate} per 1000 words

YOUR TASK:

1. For EACH text, classify metaphor density and anecdote frequency
2. Compute verticality score for EACH text using the formula provided
3. Determine abstraction level for EACH text
4. Identify signature phrases for EACH text
5. Identify negative markers for EACH text
6. Select representative quote for EACH text
7. Identify closest author match for EACH text
8. Generate psychological profile for EACH text
9. Write comparative analysis:
   - Key stylistic differences (3-5 major divergences with specific evidence)
   - "If these authors were in the same room" scenario (vivid, specific, entertaining)
   - Collaborative potential assessment
10. Identify clustering for each text

OUTPUT FORMAT - Your response must be valid JSON with this exact structure:
{
  "textA": {
    "metaphorDensity": "none|low|moderate|high",
    "anecdoteFrequency": "none|rare|occasional|frequent",
    "verticalityScore": 0.00,
    "classification": "string",
    "abstractionLevel": "string",
    "abstractionDescription": "string",
    "signaturePhrases": ["phrase1", "phrase2"],
    "negativeMarkers": ["marker1", "marker2"],
    "representativeQuote": "quote text",
    "quoteAnalysis": "what this quote shows",
    "closestAuthorMatch": "Author Name",
    "matchExplanation": "why",
    "psychologicalProfile": {...},
    "narrativeSummary": "3-4 sentence portrait",
    "clustering": {...}
  },
  "textB": {
    ... same structure as textA ...
  },
  "comparison": {
    "verticalityDifference": 0.00,
    "keyDivergences": [
      {"feature": "feature name", "textA": "value/description", "textB": "value/description", "analysis": "what this means"}
    ],
    "sameRoomScenario": "vivid, specific, entertaining paragraph",
    "collaborativePotential": "specific assessment"
  },
  "verdict": "2-3 sentence summary of the fundamental difference"
}`;
}

export function formatSingleTextReport(
  authorName: string,
  sourceTitle: string,
  rawFeatures: RawFeatures,
  llmResult: any
): string {
  const verticalityScore = llmResult.verticalityScore || 0;
  const progressBar = generateProgressBar(verticalityScore);
  const classification = llmResult.classification || getVerticalityClassification(verticalityScore);
  const abstraction = llmResult.abstractionLevel ? 
    { level: llmResult.abstractionLevel, description: llmResult.abstractionDescription } : 
    getAbstractionLevel(verticalityScore);

  let report = `## STYLOMETRIC ANALYSIS

**Author:** ${authorName}
${sourceTitle ? `**Source:** ${sourceTitle}` : ''}
**Word Count:** ${rawFeatures.wordCount}

---

### VERTICALITY SCORE: ${verticalityScore.toFixed(2)}

\`\`\`
${progressBar}
Horizontal ◄────────────────────────────────► Vertical
\`\`\`

**Classification:** ${classification}

---

### ABSTRACTION LEVEL: ${abstraction.level}

${abstraction.description}

---

### RAW FEATURE VALUES

| Feature | Value | Notes |
|---------|-------|-------|
| **Ego-pronoun rate** | ${rawFeatures.egoPronounRate} per 1000 words | ${rawFeatures.egoPronounRate < 10 ? 'Very low' : rawFeatures.egoPronounRate < 30 ? 'Low' : rawFeatures.egoPronounRate < 50 ? 'Moderate' : 'High'} |
| **Average sentence length** | ${rawFeatures.avgSentenceLength} words | ${rawFeatures.avgSentenceLength < 20 ? 'Short' : rawFeatures.avgSentenceLength < 35 ? 'Moderate' : 'Long'} |
| **Max sentence length** | ${rawFeatures.maxSentenceLength} words | |
| **Subordination depth** | ${rawFeatures.subordinationDepth} | ${rawFeatures.subordinationDepth < 2 ? 'Simple' : rawFeatures.subordinationDepth < 4 ? 'Moderate' : 'High nesting'} |
| **Semicolon frequency** | ${rawFeatures.semicolonFreq} per 1000 words | ${rawFeatures.semicolonFreq < 3 ? 'Low' : rawFeatures.semicolonFreq < 8 ? 'Moderate' : 'High'} |
| **Colon frequency** | ${rawFeatures.colonFreq} per 1000 words | |
| **Dash frequency** | ${rawFeatures.dashFreq} per 1000 words | |
| **Rhetorical question rate** | ${rawFeatures.questionFreq} per 1000 words | |
| **Metaphor density** | ${llmResult.metaphorDensity || 'moderate'} | |
| **Anecdote frequency** | ${llmResult.anecdoteFrequency || 'occasional'} | |
| **Impersonal constructions** | ${rawFeatures.impersonalRate} per 1000 words | ${rawFeatures.impersonalRate < 5 ? 'Low' : rawFeatures.impersonalRate < 10 ? 'Moderate' : 'High'} |

---

### SIGNATURE PHRASES AND CONSTRUCTIONS

${(llmResult.signaturePhrases || []).map((p: string) => `- ${p}`).join('\n')}

---

### NEGATIVE MARKERS (What This Author Never Does)

${(llmResult.negativeMarkers || []).map((m: string) => `- ${m}`).join('\n')}

---

### SAMPLE SENTENCES

${(llmResult.sampleSentences || []).map((s: any, i: number) => 
  `${i + 1}. "${s.text}"\n   — ${s.source || 'From analyzed text'}`
).join('\n\n')}

---

### CLOSEST AUTHOR MATCH

**Primary Match:** ${llmResult.closestAuthorMatch || 'Unknown'}

**Why:** ${llmResult.matchExplanation || 'Analysis pending'}

${llmResult.secondaryMatch ? `**Secondary Match:** ${llmResult.secondaryMatch}` : ''}

**Far From:** ${(llmResult.farFrom || llmResult.clustering?.farFrom || []).join(', ')}

---

### PSYCHOLOGICAL PROFILE

| Trait | Assessment |
|-------|------------|
| **Cognitive empathy** | ${llmResult.psychologicalProfile?.cognitiveEmpathy || 'moderate'} |
| **Affective empathy** | ${llmResult.psychologicalProfile?.affectiveEmpathy || 'moderate'} |
| **Need for closure** | ${llmResult.psychologicalProfile?.needForClosure || 'moderate'} |
| **Schizoid features** | ${llmResult.psychologicalProfile?.schizoidFeatures || 'absent'} |
| **Social orientation** | ${llmResult.psychologicalProfile?.socialOrientation || 'moderate'} |
| **Body/sensation** | ${llmResult.psychologicalProfile?.bodySensation || 'moderate'} |
| **Consensus attitude** | ${llmResult.psychologicalProfile?.consensusAttitude || 'neutral'} |
| **Humor style** | ${llmResult.psychologicalProfile?.humorStyle || 'none'} |

**Narrative Summary:**

${llmResult.narrativeSummary || 'Analysis pending.'}

---

### CLUSTERING

- **Very close to:** ${(llmResult.clustering?.veryCloseTo || []).join(', ') || 'None identified'}
- **Moderately close to:** ${(llmResult.clustering?.moderatelyCloseTo || []).join(', ') || 'None identified'}
- **Far from:** ${(llmResult.clustering?.farFrom || []).join(', ') || 'None identified'}

---`;

  return report;
}

export function formatComparisonReport(
  textA: { authorName: string; rawFeatures: RawFeatures },
  textB: { authorName: string; rawFeatures: RawFeatures },
  llmResult: any
): string {
  const resultA = llmResult.textA || {};
  const resultB = llmResult.textB || {};
  const comparison = llmResult.comparison || {};

  const progressBarA = generateProgressBar(resultA.verticalityScore || 0);
  const progressBarB = generateProgressBar(resultB.verticalityScore || 0);

  return `## COMPARATIVE STYLOMETRIC ANALYSIS

---

### TEXTS COMPARED

| | TEXT A | TEXT B |
|---|---|---|
| **Author** | ${textA.authorName} | ${textB.authorName} |
| **Word Count** | ${textA.rawFeatures.wordCount} | ${textB.rawFeatures.wordCount} |
| **Verticality Score** | ${(resultA.verticalityScore || 0).toFixed(2)} | ${(resultB.verticalityScore || 0).toFixed(2)} |
| **Abstraction Level** | ${resultA.abstractionLevel || 'Mixed'} | ${resultB.abstractionLevel || 'Mixed'} |
| **Classification** | ${resultA.classification || 'Mid-Range'} | ${resultB.classification || 'Mid-Range'} |
| **Closest Match** | ${resultA.closestAuthorMatch || 'Unknown'} | ${resultB.closestAuthorMatch || 'Unknown'} |

---

### VERTICALITY COMPARISON

\`\`\`
TEXT A: ${progressBarA} ${(resultA.verticalityScore || 0).toFixed(2)}
TEXT B: ${progressBarB} ${(resultB.verticalityScore || 0).toFixed(2)}

Horizontal ◄────────────────────────────────► Vertical
\`\`\`

**Verdict:** ${(resultA.verticalityScore || 0) > (resultB.verticalityScore || 0) ? 
  `Text A is more vertical by ${((resultA.verticalityScore || 0) - (resultB.verticalityScore || 0)).toFixed(2)}` : 
  `Text B is more vertical by ${((resultB.verticalityScore || 0) - (resultA.verticalityScore || 0)).toFixed(2)}`}

**Verticality Difference:** ${Math.abs((resultA.verticalityScore || 0) - (resultB.verticalityScore || 0)).toFixed(2)}

---

### RAW FEATURE COMPARISON

| Feature | Text A | Text B | More Vertical |
|---------|--------|--------|---------------|
| Ego-pronoun rate | ${textA.rawFeatures.egoPronounRate} | ${textB.rawFeatures.egoPronounRate} | ${textA.rawFeatures.egoPronounRate < textB.rawFeatures.egoPronounRate ? 'Text A' : 'Text B'} |
| Avg sentence length | ${textA.rawFeatures.avgSentenceLength} | ${textB.rawFeatures.avgSentenceLength} | — |
| Subordination depth | ${textA.rawFeatures.subordinationDepth} | ${textB.rawFeatures.subordinationDepth} | ${textA.rawFeatures.subordinationDepth > textB.rawFeatures.subordinationDepth ? 'Text A' : 'Text B'} |
| Semicolon frequency | ${textA.rawFeatures.semicolonFreq} | ${textB.rawFeatures.semicolonFreq} | ${textA.rawFeatures.semicolonFreq > textB.rawFeatures.semicolonFreq ? 'Text A' : 'Text B'} |
| Impersonal rate | ${textA.rawFeatures.impersonalRate} | ${textB.rawFeatures.impersonalRate} | ${textA.rawFeatures.impersonalRate > textB.rawFeatures.impersonalRate ? 'Text A' : 'Text B'} |
| Metaphor density | ${resultA.metaphorDensity || 'moderate'} | ${resultB.metaphorDensity || 'moderate'} | — |
| Anecdote frequency | ${resultA.anecdoteFrequency || 'occasional'} | ${resultB.anecdoteFrequency || 'occasional'} | — |

**Key Divergences:**

${(comparison.keyDivergences || []).map((d: any, i: number) => 
  `${i + 1}. **${d.feature}:** ${d.analysis}`
).join('\n\n')}

---

### SIGNATURE PHRASE COMPARISON

| Text A | Text B |
|--------|--------|
${Math.max((resultA.signaturePhrases || []).length, (resultB.signaturePhrases || []).length) > 0 ?
  Array.from({ length: Math.max((resultA.signaturePhrases || []).length, (resultB.signaturePhrases || []).length) })
    .map((_, i) => `| ${(resultA.signaturePhrases || [])[i] || '—'} | ${(resultB.signaturePhrases || [])[i] || '—'} |`)
    .join('\n') : '| — | — |'}

---

### REPRESENTATIVE QUOTE COMPARISON

**Text A:**
> ${resultA.representativeQuote || 'No quote selected'}

${resultA.quoteAnalysis || ''}

**Text B:**
> ${resultB.representativeQuote || 'No quote selected'}

${resultB.quoteAnalysis || ''}

---

### PSYCHOLOGICAL PROFILE COMPARISON

| Trait | Text A | Text B |
|-------|--------|--------|
| Cognitive empathy | ${resultA.psychologicalProfile?.cognitiveEmpathy || 'moderate'} | ${resultB.psychologicalProfile?.cognitiveEmpathy || 'moderate'} |
| Affective empathy | ${resultA.psychologicalProfile?.affectiveEmpathy || 'moderate'} | ${resultB.psychologicalProfile?.affectiveEmpathy || 'moderate'} |
| Need for closure | ${resultA.psychologicalProfile?.needForClosure || 'moderate'} | ${resultB.psychologicalProfile?.needForClosure || 'moderate'} |
| Schizoid features | ${resultA.psychologicalProfile?.schizoidFeatures || 'absent'} | ${resultB.psychologicalProfile?.schizoidFeatures || 'absent'} |
| Social orientation | ${resultA.psychologicalProfile?.socialOrientation || 'moderate'} | ${resultB.psychologicalProfile?.socialOrientation || 'moderate'} |
| Consensus attitude | ${resultA.psychologicalProfile?.consensusAttitude || 'neutral'} | ${resultB.psychologicalProfile?.consensusAttitude || 'neutral'} |

---

### NARRATIVE COMPARISON

**Text A:**
${resultA.narrativeSummary || 'Analysis pending.'}

**Text B:**
${resultB.narrativeSummary || 'Analysis pending.'}

---

### IF THESE TWO AUTHORS WERE IN THE SAME ROOM

${comparison.sameRoomScenario || 'Scenario pending.'}

---

### COLLABORATIVE POTENTIAL

${comparison.collaborativePotential || 'Assessment pending.'}

---

### CLUSTERING SUMMARY

| | Text A | Text B |
|---|---|---|
| **Very close to** | ${(resultA.clustering?.veryCloseTo || []).join(', ') || '—'} | ${(resultB.clustering?.veryCloseTo || []).join(', ') || '—'} |
| **Moderately close to** | ${(resultA.clustering?.moderatelyCloseTo || []).join(', ') || '—'} | ${(resultB.clustering?.moderatelyCloseTo || []).join(', ') || '—'} |
| **Far from** | ${(resultA.clustering?.farFrom || []).join(', ') || '—'} | ${(resultB.clustering?.farFrom || []).join(', ') || '—'} |

---

### FINAL VERDICT

**Verticality Difference:** ${Math.abs((resultA.verticalityScore || 0) - (resultB.verticalityScore || 0)).toFixed(2)}

${llmResult.verdict || 'Comparison complete.'}

---`;
}
