// ─── Shared types & constants for the Nova agent loop ────────────────────────

export const BASE_TICK_MS     = 40_000;
export const MIN_TICK_MS      = 10_000;
export const MAX_TICK_MS      = 120_000;
export const SLEEP_THRESHOLD  = 15;
export const CONSOLIDATION_MS = 20_000;

/** How many consecutive same-action repeats trigger a forced override */
export const EXPLORATION_REPEAT_THRESHOLD = 3;

export type Mood =
  | 'curious'
  | 'focused'
  | 'uncertain'
  | 'satisfied'
  | 'restless'
  | 'reflective';

/** Per-action self-evaluation record */
export interface ActionRecord {
  action:          string;
  query?:          string;
  memoriesStored:  number;   // facts actually stored after judge
  avgJudgeScore:   number;   // average LLM judge score (0–10) for this action
  curiosityDelta:  number;   // Δcuriosity after action (positive = productive)
  ts:              number;
}

export interface ConsciousnessState {
  mood:           Mood;
  energy:         number;       // 0–1. Depletes each tick, restores on sleep
  curiosity:      number;       // 0–1. Rises when new facts found, falls on repeats
  openQuestions:  string[];     // self-generated questions to explore
  recentTopics:   string[];     // last 6 search queries (circular)
  tickCount:      number;
  lastActionType: string;
  /** Rolling window of last 10 actions with self-evaluation scores */
  actionHistory:  ActionRecord[];
  /**
   * Written by action services during a tick so agent-loop can read the
   * actual judge scores for self-evaluation. Reset to [] at start of each act().
   */
  _tickJudgeScores: number[];
  _tickStoredCount: number;
}

export const initialState = (): ConsciousnessState => ({
  mood:             'curious',
  energy:           1.0,
  curiosity:        0.8,
  openQuestions:    [],
  recentTopics:     [],
  tickCount:        0,
  lastActionType:   '',
  actionHistory:    [],
  _tickJudgeScores: [],
  _tickStoredCount: 0,
});
