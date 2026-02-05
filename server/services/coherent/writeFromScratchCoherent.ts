import { callLLM } from "../../llm";
import { 
  generateDocumentId, 
  createInitialState, 
  initializeCoherenceRun,
  updateCoherenceState,
  writeChunkEvaluation,
  applyStateUpdate,
  markDocumentComplete
} from "./coherenceDatabase";
import { ProgressUpdate, CoherenceModeType, CoherenceState, ChunkEvaluationResult } from "./stateSchemas";

export interface WriteFromScratchResult {
  documentId: string;
  generatedText: string;
  mode: CoherenceModeType;
  chunkCount: number;
  wordCount: number;
  coherenceStatus: string;
}

export interface StreamingProgress extends ProgressUpdate {
  content?: string;
  current?: number;
  total?: number;
}

interface OutlineSection {
  title: string;
  description: string;
  targetWords: number;
  keyPoints: string[];
}

interface DocumentOutline {
  title: string;
  thesis: string;
  sections: OutlineSection[];
  totalTargetWords: number;
  mode: CoherenceModeType;
}

async function generateOutline(
  prompt: string,
  targetWords: number,
  provider: string
): Promise<DocumentOutline> {
  const numSections = Math.max(5, Math.ceil(targetWords / 2000));
  const wordsPerSection = Math.ceil(targetWords / numSections);

  const outlinePrompt = `You are a document architect. Create a detailed outline for the following writing request.

USER REQUEST:
${prompt}

TARGET LENGTH: Approximately ${targetWords} words total
NUMBER OF SECTIONS: ${numSections} sections (about ${wordsPerSection} words each)

Analyze the topic and determine the appropriate coherence mode:
- logical-cohesiveness: For argumentative/analytical writing
- scientific-explanatory: For scientific/technical explanations  
- philosophical: For philosophical treatises
- instructional: For how-to guides
- thematic-psychological: For narrative/exploratory writing

Return JSON:
{
  "title": "Document title",
  "thesis": "Central thesis or main argument",
  "mode": "logical-cohesiveness",
  "totalTargetWords": ${targetWords},
  "sections": [
    {
      "title": "Section title",
      "description": "What this section covers",
      "targetWords": ${wordsPerSection},
      "keyPoints": ["point 1", "point 2", "point 3"]
    }
  ]
}

Create ${numSections} sections that build logically toward a complete treatment of the topic.`;

  const response = await callLLM(provider, outlinePrompt);
  
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('Failed to parse outline:', e);
  }

  return {
    title: "Generated Document",
    thesis: prompt,
    mode: "logical-cohesiveness",
    totalTargetWords: targetWords,
    sections: Array.from({ length: numSections }, (_, i) => ({
      title: `Section ${i + 1}`,
      description: `Part ${i + 1} of the document`,
      targetWords: wordsPerSection,
      keyPoints: ["Key point"]
    }))
  };
}

function formatStateForPrompt(mode: CoherenceModeType, state: CoherenceState): string {
  const s = state as any;
  
  switch (mode) {
    case "logical-cohesiveness":
      return `Thesis: ${s.thesis || "(establishing)"}
Current stage: ${s.current_stage}
Key terms: ${Object.entries(s.key_terms || {}).map(([k, v]) => `${k}: ${v}`).join("; ") || "(none)"}
Assertions: ${(s.assertions_made || []).slice(-10).join("; ") || "(none)"}
Claims needing support: ${(s.support_queue || []).join("; ") || "(none)"}`;

    case "scientific-explanatory":
      return `Phenomena explained: ${(s.phenomena || []).join("; ") || "(none)"}
Mechanisms: ${(s.mechanisms || []).join("; ") || "(none)"}
Causal chains: ${(s.causal_chains || []).join(" -> ") || "(none)"}`;

    case "philosophical":
      return `Core concepts: ${Object.entries(s.core_concepts || {}).map(([k, v]) => `${k}: ${v}`).join("; ") || "(none)"}
Distinctions: ${(s.distinctions || []).map((d: string[]) => `${d[0]} vs ${d[1]}`).join("; ") || "(none)"}
Dialectic: Thesis: ${s.dialectic?.thesis || "?"}`;

    default:
      return `Mode: ${mode}, Stage: ${s.current_stage || 'developing'}`;
  }
}

export async function writeFromScratchCoherent(
  prompt: string,
  targetWords: number,
  provider: string,
  onProgress?: (progress: StreamingProgress) => void,
  userId?: number
): Promise<WriteFromScratchResult> {
  const docId = generateDocumentId();

  onProgress?.({ 
    phase: "planning", 
    message: "Creating document outline...",
    current: 0,
    total: 1
  });

  const outline = await generateOutline(prompt, targetWords, provider);
  const mode = outline.mode;
  const sections = outline.sections;

  onProgress?.({ 
    phase: "planning", 
    message: `Outline created: "${outline.title}" with ${sections.length} sections`,
    current: 0,
    total: sections.length
  });

  const initialState = createInitialState(mode);
  (initialState as any).thesis = outline.thesis;
  (initialState as any).current_stage = "introduction";

  await initializeCoherenceRun(docId, mode, initialState, targetWords, sections.length, userId);

  let currentState = initialState;
  const outputs: string[] = [];
  let totalWordCount = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    
    onProgress?.({
      phase: "writing",
      current: i + 1,
      total: sections.length,
      message: `Writing section ${i + 1}/${sections.length}: "${section.title}"...`
    });

    const stateDescription = formatStateForPrompt(mode, currentState);

    const previousSummary = outputs.length > 0 
      ? `\n\nPREVIOUS CONTENT SUMMARY (last ${Math.min(500, outputs.join('\n\n').length)} chars):\n${outputs.join('\n\n').slice(-500)}`
      : '';

    const writePrompt = `You are writing section ${i + 1} of ${sections.length} of a document.

DOCUMENT TITLE: ${outline.title}
CENTRAL THESIS: ${outline.thesis}

COHERENCE MODE: ${mode}
ACCUMULATED STATE:
${stateDescription}
${previousSummary}

CURRENT SECTION TO WRITE:
Title: ${section.title}
Description: ${section.description}
Key points to cover: ${section.keyPoints.join(", ")}
Target length: ${section.targetWords} words

INSTRUCTIONS:
1. Write this section in polished, academic prose
2. Maintain coherence with previous sections
3. Do not contradict established assertions
4. Advance the thesis with new supporting material
5. ${i === 0 ? 'Begin with an engaging introduction to the topic' : i === sections.length - 1 ? 'Conclude by synthesizing all arguments' : 'Build on previous sections and prepare for what follows'}

Return JSON:
{
  "section_text": "Your written section here (${section.targetWords} words, pure prose, no JSON or formatting)",
  "state_update": {
    "assertions_made": ["new assertions made"],
    "key_terms": {"new_term": "definition"},
    "current_stage": "${i === 0 ? 'development' : i === sections.length - 1 ? 'conclusion' : 'development'}"
  }
}`;

    try {
      const response = await callLLM(provider, writePrompt);
      
      let sectionText = "";
      let stateUpdate: Partial<CoherenceState> = {};

      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          sectionText = result.section_text || "";
          stateUpdate = result.state_update || {};
        }
      } catch (e) {
        sectionText = response.replace(/```[\s\S]*?```/g, '').replace(/\{[\s\S]*?\}/g, '').trim();
      }

      if (!sectionText) {
        sectionText = response.replace(/```[\s\S]*?```/g, '').trim();
      }

      const sectionWordCount = sectionText.split(/\s+/).length;
      totalWordCount += sectionWordCount;
      
      const formattedSection = i === 0 
        ? `# ${outline.title}\n\n## ${section.title}\n\n${sectionText}`
        : `## ${section.title}\n\n${sectionText}`;

      outputs.push(formattedSection);

      onProgress?.({
        phase: "content",
        current: i + 1,
        total: sections.length,
        message: `Section ${i + 1} complete (${sectionWordCount} words)`,
        content: (i === 0 ? "" : "\n\n") + formattedSection
      });

      const evaluation: ChunkEvaluationResult = {
        status: "preserved",
        violations: [],
        repairs: [],
        state_update: stateUpdate
      };

      currentState = applyStateUpdate(currentState, stateUpdate);
      await updateCoherenceState(docId, mode, currentState);
      await writeChunkEvaluation(docId, mode, i, section.description, sectionText, evaluation, currentState);

    } catch (e) {
      console.error(`Failed to write section ${i}:`, e);
      const fallback = `## ${section.title}\n\n[Section generation failed. Please try again.]`;
      outputs.push(fallback);
      onProgress?.({
        phase: "content",
        current: i + 1,
        total: sections.length,
        message: `Section ${i + 1} (error)`,
        content: (i === 0 ? "" : "\n\n") + fallback
      });
    }

    await new Promise(resolve => setTimeout(resolve, 300));
  }

  await markDocumentComplete(docId);

  onProgress?.({
    phase: "complete",
    current: sections.length,
    total: sections.length,
    message: `Document complete. ${sections.length} sections, ${totalWordCount} words generated.`
  });

  return {
    documentId: docId,
    generatedText: outputs.join('\n\n'),
    mode: mode,
    chunkCount: sections.length,
    wordCount: totalWordCount,
    coherenceStatus: "preserved"
  };
}
