// ─── Types for Nova's Cognitive Core ─────────────────────────────────────────

/**
 * The central theory Nova is currently trying to prove or disprove.
 * This is the primary object of conscious focus — not just a list of facts,
 * but an active claim about the world with confidence tracking.
 */
export interface CurrentTheory {
    claim: string;                  // the central hypothesis
    confidence: number;             // 0–1: how confident Nova is in this claim
    supportingEvidence: string[];   // facts that support it (max 5)
    contradictions: string[];       // facts that challenge it (max 3)
    nextExperiment: string;         // the most valuable thing to test next
    age: number;                    // ticks since this theory was formed/last revised
    formedAt: number;               // timestamp
  }
  
  /**
   * Strategic directive issued by CognitiveCore to the agent loop.
   * Injected into the plan prompt to give the tick a sense of purpose.
   */
  export interface CognitiveDirective {
    attentionFocus: string;         // what to focus on this tick (1-2 sentences)
    suggestedAction?: string;       // optional preferred action type
    urgencyBoost: number;           // 0–0.3: added to plan urgency when directive is fresh
  }
  
  /**
   * One entry in the rolling narrative log.
   * Stored as structured data, rendered as text for the LLM.
   */
  export interface NarrativeEntry {
    tick: number;
    action: string;
    query?: string;
    outcome: string;               // brief human-readable outcome
    memoriesStored: number;
    avgScore: number;
    curiosityDelta: number;
    ts: number;
  }
  
  /**
   * Full cognitive state — exposed via REST for the UI.
   */
  export interface CognitiveState {
    theory: CurrentTheory | null;
    directive: CognitiveDirective | null;
    narrativeLog: NarrativeEntry[];
    lastMetaReflectionAt: number;
    metaReflectionCount: number;
    metaInsights: string[];        // rolling last-5 meta-observations
  }