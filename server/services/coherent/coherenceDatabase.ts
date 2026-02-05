import { db } from "../../db";
import { coherenceDocuments, coherenceChunks, documentSkeletons } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { 
  CoherenceState, 
  CoherenceModeType, 
  ChunkEvaluationResult,
  Violation 
} from "./stateSchemas";
import crypto from "crypto";

export function generateDocumentId(): string {
  return crypto.randomUUID();
}

export function createInitialState(mode: CoherenceModeType): CoherenceState {
  switch (mode) {
    case "logical-consistency":
      return {
        mode: "logical-consistency",
        assertions: [],
        negations: [],
        disjoint_pairs: []
      };
    case "logical-cohesiveness":
      return {
        mode: "logical-cohesiveness",
        thesis: "",
        support_queue: [],
        current_stage: "setup",
        bridge_required: "",
        assertions_made: [],
        key_terms: {}
      };
    case "scientific-explanatory":
      return {
        mode: "scientific-explanatory",
        causal_nodes: [],
        causal_edges: [],
        level: "mixed",
        active_feedback_loops: [],
        mechanism_requirements: {}
      };
    case "thematic-psychological":
      return {
        mode: "thematic-psychological",
        dominant_affect: "",
        tempo: "moderate",
        stance: "",
        emotional_arc: [],
        recurring_motifs: []
      };
    case "instructional":
      return {
        mode: "instructional",
        goal: "",
        steps_done: [],
        prerequisites: [],
        open_loops: [],
        current_topic: ""
      };
    case "motivational":
      return {
        mode: "motivational",
        direction: "",
        intensity: "moderate",
        target: "",
        appeals_used: []
      };
    case "mathematical":
      return {
        mode: "mathematical",
        givens: [],
        proved: [],
        goal: "",
        proof_method: "",
        open_cases: []
      };
    case "philosophical":
      return {
        mode: "philosophical",
        core_concepts: {},
        distinctions: [],
        dialectic: { thesis: "", antithesis: "", synthesis: "" },
        objections_raised: [],
        objections_answered: [],
        lastChapterNumber: 0
      };
    default:
      return {
        mode: "logical-cohesiveness",
        thesis: "",
        support_queue: [],
        current_stage: "setup",
        bridge_required: "",
        assertions_made: [],
        key_terms: {}
      };
  }
}

export async function initializeCoherenceRun(
  docId: string,
  mode: CoherenceModeType,
  state: CoherenceState,
  wordCount: number,
  totalChunks: number,
  userId?: number
): Promise<void> {
  await db.insert(coherenceDocuments).values({
    documentId: docId,
    coherenceMode: mode,
    globalState: state,
    originalWordCount: wordCount,
    totalChunks: totalChunks,
    processedChunks: 0,
    status: "in_progress",
    userId: userId
  });
}

export async function readCoherenceState(docId: string, mode: string): Promise<CoherenceState | null> {
  const result = await db
    .select()
    .from(coherenceDocuments)
    .where(and(
      eq(coherenceDocuments.documentId, docId),
      eq(coherenceDocuments.coherenceMode, mode)
    ))
    .limit(1);

  return (result[0]?.globalState as CoherenceState) ?? null;
}

export async function updateCoherenceState(
  docId: string,
  mode: string,
  newState: CoherenceState
): Promise<void> {
  await db
    .update(coherenceDocuments)
    .set({
      globalState: newState,
      updatedAt: new Date(),
      processedChunks: sql`processed_chunks + 1`
    })
    .where(and(
      eq(coherenceDocuments.documentId, docId),
      eq(coherenceDocuments.coherenceMode, mode)
    ));
}

export async function writeChunkEvaluation(
  docId: string,
  mode: string,
  chunkIndex: number,
  chunkText: string,
  output: string,
  evaluationResult: ChunkEvaluationResult,
  stateAfter: CoherenceState
): Promise<void> {
  await db.insert(coherenceChunks).values({
    documentId: docId,
    coherenceMode: mode,
    chunkIndex: chunkIndex,
    chunkText: chunkText,
    processedOutput: output,
    evaluationResult: evaluationResult,
    stateAfter: stateAfter
  });
}

export async function readAllChunkOutputs(docId: string, mode: string): Promise<string[]> {
  const chunks = await db
    .select()
    .from(coherenceChunks)
    .where(and(
      eq(coherenceChunks.documentId, docId),
      eq(coherenceChunks.coherenceMode, mode)
    ))
    .orderBy(coherenceChunks.chunkIndex);

  return chunks.map(c => c.processedOutput || "");
}

export async function markDocumentComplete(docId: string): Promise<void> {
  await db
    .update(coherenceDocuments)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(coherenceDocuments.documentId, docId));
}

export async function markDocumentFailed(docId: string, error: string): Promise<void> {
  await db
    .update(coherenceDocuments)
    .set({ status: `failed: ${error}`, updatedAt: new Date() })
    .where(eq(coherenceDocuments.documentId, docId));
}

export function applyStateUpdate(
  currentState: CoherenceState,
  update: Partial<CoherenceState>
): CoherenceState {
  const newState = { ...currentState } as any;

  for (const key of Object.keys(update)) {
    const updateValue = (update as any)[key];
    const currentValue = (currentState as any)[key];

    if (Array.isArray(currentValue) && Array.isArray(updateValue)) {
      newState[key] = [...currentValue, ...updateValue];
    } else if (typeof updateValue === 'object' && updateValue !== null && !Array.isArray(updateValue)) {
      newState[key] = { ...currentValue, ...updateValue };
    } else if (updateValue !== undefined) {
      newState[key] = updateValue;
    }
  }

  return newState as CoherenceState;
}

export function checkViolations(
  state: CoherenceState,
  update: Partial<CoherenceState>
): Violation[] {
  const violations: Violation[] = [];

  if (state.mode === "logical-consistency") {
    const s = state as any;
    const u = update as any;
    for (const newAssertion of (u.assertions || [])) {
      if (s.negations?.includes(newAssertion)) {
        violations.push({
          type: "contradiction",
          description: `New assertion "${newAssertion}" contradicts prior negation`
        });
      }
    }
    for (const newNegation of (u.negations || [])) {
      if (s.assertions?.includes(newNegation)) {
        violations.push({
          type: "contradiction",
          description: `New negation "${newNegation}" contradicts prior assertion`
        });
      }
    }
  }

  if (state.mode === "logical-cohesiveness") {
    const s = state as any;
    const u = update as any;
    if (u.thesis && s.thesis && u.thesis !== s.thesis) {
      const similarity = u.thesis.toLowerCase().includes(s.thesis.toLowerCase().substring(0, 20));
      if (!similarity) {
        violations.push({
          type: "drift",
          description: `Thesis appears to have drifted from "${s.thesis.substring(0, 50)}..." to "${u.thesis.substring(0, 50)}..."`
        });
      }
    }
  }

  return violations;
}

export async function storeSkeleton(
  docId: string,
  skeletonType: "single" | "meta" | "chunk",
  skeleton: any,
  wordCount: number,
  chunkRange?: { start: number; end: number },
  userId?: number
): Promise<void> {
  await db.insert(documentSkeletons).values({
    documentId: docId,
    skeletonType,
    skeleton,
    wordCount,
    chunkRange,
    userId
  });
}

export async function retrieveSkeleton(docId: string): Promise<any | null> {
  const result = await db
    .select()
    .from(documentSkeletons)
    .where(eq(documentSkeletons.documentId, docId))
    .limit(1);

  return result[0]?.skeleton ?? null;
}
