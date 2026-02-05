import { callLLM } from "../../llm";
import { chunkText, autoDetectMode, extractInitialState } from "./coherenceProcessor";
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

export interface FullRewriteResult {
  documentId: string;
  rewrittenText: string;
  mode: CoherenceModeType;
  chunkCount: number;
  coherenceStatus: string;
}

export interface StreamingProgress extends ProgressUpdate {
  content?: string;
  current?: number;
  total?: number;
}

function parseTargetWordCount(instructions: string): number | null {
  const patterns = [
    /(\d{1,3}(?:,\d{3})*|\d+)\s*words?/i,
    /approximately\s+(\d{1,3}(?:,\d{3})*|\d+)/i,
    /about\s+(\d{1,3}(?:,\d{3})*|\d+)\s*words?/i,
    /target[:\s]+(\d{1,3}(?:,\d{3})*|\d+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = instructions.match(pattern);
    if (match) {
      const numStr = match[1].replace(/,/g, '');
      const num = parseInt(numStr, 10);
      if (num >= 500 && num <= 100000) {
        return num;
      }
    }
  }
  return null;
}

function formatStateForPrompt(mode: CoherenceModeType, state: CoherenceState): string {
  const s = state as any;
  
  switch (mode) {
    case "logical-cohesiveness":
      return `Thesis: ${s.thesis || "(not yet established)"}
Current stage: ${s.current_stage}
Key terms defined: ${Object.keys(s.key_terms || {}).join(", ") || "(none)"}
Assertions made: ${(s.assertions_made || []).slice(-10).join("; ") || "(none)"}`;

    case "logical-consistency":
      return `Assertions: ${(s.assertions || []).slice(-15).join("; ") || "(none)"}
Negations: ${(s.negations || []).slice(-10).join("; ") || "(none)"}`;

    case "philosophical":
      return `Core concepts: ${Object.entries(s.core_concepts || {}).map(([k, v]) => `${k}: ${v}`).join("; ") || "(none)"}
Dialectic: Thesis: ${s.dialectic?.thesis || "?"}, Antithesis: ${s.dialectic?.antithesis || "?"}`;

    default:
      return `Mode: ${mode}, Stage: ${s.current_stage || 'processing'}`;
  }
}

export async function fullRewriteCoherent(
  text: string,
  instructions: string,
  provider: string,
  onProgress?: (progress: StreamingProgress) => void,
  userId?: number
): Promise<FullRewriteResult> {
  const docId = generateDocumentId();
  const inputWordCount = text.split(/\s+/).length;
  
  const targetTotalWords = parseTargetWordCount(instructions);
  
  const chunks = chunkText(text, 1000);
  const numChunks = chunks.length;
  
  const targetWordsPerChunk = targetTotalWords 
    ? Math.ceil(targetTotalWords / numChunks)
    : null;

  onProgress?.({ 
    phase: "detecting", 
    message: `Detecting document structure... (${inputWordCount} words input${targetTotalWords ? `, targeting ${targetTotalWords} words output` : ''})`,
    current: 0,
    total: numChunks
  });

  const mode = await autoDetectMode(chunks[0], provider);

  onProgress?.({ 
    phase: "extracting", 
    message: `Mode: ${mode}. Extracting initial state...`,
    current: 0,
    total: numChunks
  });

  const initialState = await extractInitialState(mode, chunks[0], provider);
  await initializeCoherenceRun(docId, mode, initialState, inputWordCount, numChunks, userId);

  let currentState = initialState;
  const outputs: string[] = [];
  let totalOutputWords = 0;

  for (let i = 0; i < numChunks; i++) {
    const chunkWordCount = chunks[i].split(/\s+/).length;
    
    const remainingChunks = numChunks - i;
    const remainingTargetWords = targetTotalWords ? targetTotalWords - totalOutputWords : null;
    const adjustedTargetForThisChunk = remainingTargetWords 
      ? Math.ceil(remainingTargetWords / remainingChunks)
      : targetWordsPerChunk;

    onProgress?.({
      phase: "processing",
      current: i + 1,
      total: numChunks,
      message: `Rewriting section ${i + 1} of ${numChunks}${adjustedTargetForThisChunk ? ` (target: ~${adjustedTargetForThisChunk} words)` : ''}...`
    });

    const stateDescription = formatStateForPrompt(mode, currentState);

    const isExpansion = adjustedTargetForThisChunk && adjustedTargetForThisChunk > chunkWordCount * 1.3;
    const expansionRatio = adjustedTargetForThisChunk ? (adjustedTargetForThisChunk / chunkWordCount).toFixed(1) : "1.0";
    
    const wordCountInstruction = adjustedTargetForThisChunk 
      ? `\n\nCRITICAL WORD COUNT REQUIREMENT: This section MUST be approximately ${adjustedTargetForThisChunk} words. The input chunk is ${chunkWordCount} words. ${isExpansion ? `You are EXPANDING by ${expansionRatio}x. This means you MUST produce ${adjustedTargetForThisChunk} words of output. DO NOT SUMMARIZE. DO NOT CONDENSE. Add elaboration, examples, deeper analysis, extended explanations, additional context, supporting details, and thorough exploration of each point.` : `Maintain similar length while improving clarity and flow.`}`
      : '';

    let prompt: string;
    
    if (isExpansion) {
      // For expansion, use a non-JSON format to maximize content generation
      prompt = `You are EXPANDING a document section. Your task is to take the input and produce a much longer, more detailed version.

EXPANSION TARGET: ${chunkWordCount} words -> ${adjustedTargetForThisChunk} words (${expansionRatio}x expansion)

COHERENCE MODE: ${mode}
CURRENT STATE: ${stateDescription}

=== INPUT SECTION (${chunkWordCount} words) ===
${chunks[i]}
=== END INPUT ===

REWRITE INSTRUCTIONS: ${instructions}

MANDATORY EXPANSION REQUIREMENTS:
1. Your output MUST be approximately ${adjustedTargetForThisChunk} words - this is non-negotiable
2. DO NOT SUMMARIZE - you are EXPANDING, not condensing
3. For every idea in the original, add:
   - Deeper explanation of what it means
   - Examples or illustrations
   - Related concepts and connections
   - Implications and significance
   - Supporting evidence or reasoning
4. Maintain the original meaning and coherence with prior sections
5. Write in flowing prose, not bullet points

OUTPUT FORMAT:
First write your expanded text (aim for ${adjustedTargetForThisChunk} words).
Then on a new line write: |||STATE_UPDATE|||
Then write any new key terms or assertions as JSON.

BEGIN YOUR EXPANDED REWRITE NOW:`;
    } else {
      prompt = `You are rewriting a document chunk-by-chunk while maintaining coherence.

COHERENCE MODE: ${mode}

CURRENT ACCUMULATED STATE:
${stateDescription}

CHUNK ${i + 1} OF ${numChunks} (input: ${chunkWordCount} words):
${chunks[i]}

REWRITE INSTRUCTIONS: ${instructions}${wordCountInstruction}

TASK:
1. Rewrite this chunk according to the instructions
2. ${adjustedTargetForThisChunk ? `OUTPUT MUST BE APPROXIMATELY ${adjustedTargetForThisChunk} WORDS` : 'Maintain similar length to input'}
3. Maintain coherence with the accumulated state
4. Do not contradict prior assertions
5. Continue the established thesis and argument structure

Return JSON:
{
  "rewritten_text": "Your rewritten chunk here",
  "state_update": {
    "assertions_made": ["new assertions in this chunk"],
    "key_terms": {"new_term": "definition if any"}
  }
}`;
    }

    try {
      let rewrittenText = chunks[i];
      let stateUpdate: Partial<CoherenceState> = {};
      
      const parseExpansionResponse = (response: string): { text: string; state: Partial<CoherenceState> } => {
        const parts = response.split('|||STATE_UPDATE|||');
        let text = parts[0].trim()
          .replace(/^```[\w]*\n?/gm, '')
          .replace(/```$/gm, '')
          .replace(/^BEGIN YOUR EXPANDED REWRITE NOW:?\s*/i, '')
          .trim();
        
        let state: Partial<CoherenceState> = {};
        if (parts[1]) {
          try {
            const jsonMatch = parts[1].match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              state = JSON.parse(jsonMatch[0]);
            }
          } catch (e) {}
        }
        return { text, state };
      };

      if (isExpansion) {
        const minAcceptableWords = Math.floor(adjustedTargetForThisChunk! * 0.85); // Need at least 85% of target
        const maxRetries = 3; // More attempts for expansion
        let bestResult = "";
        let bestWordCount = 0;
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          let currentPrompt = prompt;
          
          if (attempt > 0) {
            // Retry with corrective prompt
            currentPrompt = `CRITICAL CORRECTION NEEDED.

Your previous attempt produced only ${bestWordCount} words when ${adjustedTargetForThisChunk} words were required.

YOU MUST WRITE MORE. This is a ${expansionRatio}x expansion task.

ORIGINAL INPUT (${chunkWordCount} words):
${chunks[i]}

TARGET OUTPUT: ${adjustedTargetForThisChunk} words MINIMUM.

EXPANSION INSTRUCTIONS: ${instructions}

You MUST expand every single idea. Add:
- Detailed explanations of each concept
- Concrete examples and illustrations
- Historical or contextual background
- Implications and consequences
- Related ideas and connections
- Supporting evidence and reasoning

DO NOT STOP UNTIL YOU REACH ${adjustedTargetForThisChunk} WORDS.

Write your expanded text now (MUST be ${adjustedTargetForThisChunk}+ words):`;
          }
          
          onProgress?.({
            phase: "processing",
            current: i + 1,
            total: numChunks,
            message: attempt > 0 
              ? `Section ${i + 1}: Retry ${attempt} (previous: ${bestWordCount} words, need ${adjustedTargetForThisChunk})...`
              : `Expanding section ${i + 1} of ${numChunks} (target: ~${adjustedTargetForThisChunk} words)...`
          });
          
          const response = await callLLM(provider, currentPrompt);
          const parsed = parseExpansionResponse(response);
          const outputWords = parsed.text.split(/\s+/).filter(Boolean).length;
          
          if (outputWords > bestWordCount) {
            bestResult = parsed.text;
            bestWordCount = outputWords;
            stateUpdate = parsed.state;
          }
          
          // If we got acceptable output, stop retrying
          if (outputWords >= minAcceptableWords) {
            console.log(`Expansion attempt ${attempt + 1}: ${outputWords} words (target: ${adjustedTargetForThisChunk}, min: ${minAcceptableWords}) - ACCEPTED`);
            break;
          } else {
            console.log(`Expansion attempt ${attempt + 1}: ${outputWords} words (target: ${adjustedTargetForThisChunk}, min: ${minAcceptableWords}) - RETRYING`);
          }
        }
        
        // Use best result we got - for expansion, always use the longest output even if below target
        // Only fall back to original if we got less words than input (a summary, not expansion)
        if (bestWordCount >= chunkWordCount) {
          rewrittenText = bestResult;
          if (bestWordCount < adjustedTargetForThisChunk!) {
            console.warn(`Expansion under target: got ${bestWordCount}/${adjustedTargetForThisChunk} words. Accepting best effort.`);
          }
        } else {
          console.warn(`Expansion failed completely (${bestWordCount} < ${chunkWordCount} input). Using original.`);
          rewrittenText = chunks[i];
        }
      } else {
        const response = await callLLM(provider, prompt);
        try {
          const jsonMatch = response.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            rewrittenText = result.rewritten_text || chunks[i];
            stateUpdate = result.state_update || {};
          }
        } catch (e) {
          rewrittenText = response.replace(/```[\s\S]*?```/g, '').trim() || chunks[i];
        }
      }

      const sectionWords = rewrittenText.split(/\s+/).length;
      totalOutputWords += sectionWords;
      
      outputs.push(rewrittenText);

      onProgress?.({
        phase: "content",
        current: i + 1,
        total: numChunks,
        message: `Section ${i + 1} complete (${sectionWords} words, total: ${totalOutputWords})`,
        content: (i === 0 ? "" : "\n\n") + rewrittenText
      });

      const evaluation: ChunkEvaluationResult = {
        status: "preserved",
        violations: [],
        repairs: [],
        state_update: stateUpdate
      };

      currentState = applyStateUpdate(currentState, stateUpdate);
      await updateCoherenceState(docId, mode, currentState);
      await writeChunkEvaluation(docId, mode, i, chunks[i], rewrittenText, evaluation, currentState);

    } catch (e) {
      console.error(`Failed to process chunk ${i}:`, e);
      outputs.push(chunks[i]);
      totalOutputWords += chunks[i].split(/\s+/).length;
      onProgress?.({
        phase: "content",
        current: i + 1,
        total: numChunks,
        message: `Section ${i + 1} (original preserved)`,
        content: (i === 0 ? "" : "\n\n") + chunks[i]
      });
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  await markDocumentComplete(docId);

  onProgress?.({
    phase: "complete",
    current: numChunks,
    total: numChunks,
    message: `Rewrite complete. ${numChunks} sections, ${totalOutputWords} words total${targetTotalWords ? ` (target was ${targetTotalWords})` : ''}.`
  });

  return {
    documentId: docId,
    rewrittenText: outputs.join('\n\n'),
    mode: mode,
    chunkCount: numChunks,
    coherenceStatus: "preserved"
  };
}
