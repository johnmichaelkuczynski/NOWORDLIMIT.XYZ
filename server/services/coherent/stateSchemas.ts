export type CoherenceModeType = 
  | "logical-consistency"
  | "logical-cohesiveness"
  | "scientific-explanatory"
  | "thematic-psychological"
  | "instructional"
  | "motivational"
  | "mathematical"
  | "philosophical";

export interface LogicalConsistencyState {
  mode: "logical-consistency";
  assertions: string[];
  negations: string[];
  disjoint_pairs: [string, string][];
}

export interface LogicalCohesivenessState {
  mode: "logical-cohesiveness";
  thesis: string;
  support_queue: string[];
  current_stage: "setup" | "support" | "objection" | "reply" | "synthesis" | "conclusion";
  bridge_required: string;
  assertions_made: string[];
  key_terms: Record<string, string>;
}

export interface ScientificExplanatoryState {
  mode: "scientific-explanatory";
  causal_nodes: string[];
  causal_edges: { from: string; to: string; direction: "+" | "-"; mechanism: string }[];
  level: "physical" | "socio-economic" | "institutional" | "mixed";
  active_feedback_loops: { name: string; participants: string[]; status: "active" | "resolved" }[];
  mechanism_requirements: Record<string, string>;
}

export interface ThematicPsychologicalState {
  mode: "thematic-psychological";
  dominant_affect: string;
  tempo: "slow" | "moderate" | "rapid";
  stance: string;
  emotional_arc: string[];
  recurring_motifs: string[];
}

export interface InstructionalState {
  mode: "instructional";
  goal: string;
  steps_done: string[];
  prerequisites: string[];
  open_loops: string[];
  current_topic: string;
}

export interface MotivationalState {
  mode: "motivational";
  direction: string;
  intensity: "low" | "moderate" | "high";
  target: string;
  appeals_used: string[];
}

export interface MathematicalState {
  mode: "mathematical";
  givens: string[];
  proved: string[];
  goal: string;
  proof_method: string;
  open_cases: string[];
}

export interface PhilosophicalState {
  mode: "philosophical";
  core_concepts: Record<string, string>;
  distinctions: [string, string][];
  dialectic: {
    thesis: string;
    antithesis: string;
    synthesis: string;
  };
  objections_raised: string[];
  objections_answered: string[];
  lastChapterNumber?: number;
}

export type CoherenceState = 
  | LogicalConsistencyState
  | LogicalCohesivenessState
  | ScientificExplanatoryState
  | ThematicPsychologicalState
  | InstructionalState
  | MotivationalState
  | MathematicalState
  | PhilosophicalState;

export interface Violation {
  type: "contradiction" | "drift" | "unresolved" | "repetition";
  description: string;
  location?: string;
}

export interface ChunkEvaluationResult {
  status: "preserved" | "weakened" | "broken";
  violations: Violation[];
  repairs: { location: string; suggestion: string }[];
  state_update: Partial<CoherenceState>;
}

export interface ProgressUpdate {
  documentId?: string;
  phase?: string;
  currentChunk?: number;
  totalChunks?: number;
  status?: string;
  message?: string;
}

export interface ProcessingResult {
  documentId: string;
  mode: CoherenceModeType;
  finalOutput: string;
  finalState: CoherenceState;
  chunkCount: number;
}
