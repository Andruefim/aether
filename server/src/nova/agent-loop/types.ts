// ─── Shared types & constants for the Nova agent loop ────────────────────────

export const BASE_TICK_MS    = 40_000;
export const MIN_TICK_MS     = 10_000;
export const MAX_TICK_MS     = 120_000;
export const SLEEP_THRESHOLD = 15;
export const CONSOLIDATION_MS = 20_000;

export type Mood =
  | 'curious'
  | 'focused'
  | 'uncertain'
  | 'satisfied'
  | 'restless'
  | 'reflective';

export interface ConsciousnessState {
  mood:           Mood;
  energy:         number;   // 0–1. Depletes each tick, restores on sleep
  curiosity:      number;   // 0–1. Rises when new facts found, falls on repeats
  openQuestions:  string[]; // self-generated questions to explore
  recentTopics:   string[]; // last 6 search queries (circular)
  tickCount:      number;
  lastActionType: string;
}

export const initialState = (): ConsciousnessState => ({
  mood:           'curious',
  energy:         1.0,
  curiosity:      0.8,
  openQuestions:  [],
  recentTopics:   [],
  tickCount:      0,
  lastActionType: '',
});
