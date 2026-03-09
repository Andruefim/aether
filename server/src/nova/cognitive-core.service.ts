import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OllamaService, OllamaMessage } from '../generate/ollama.service';
import { ThoughtBusService } from './thought-bus.service';
import { parseJson } from './agent-loop/prompts';
import {
  CurrentTheory,
  CognitiveDirective,
  NarrativeEntry,
  CognitiveState,
} from './cognitive-core.types';

// ── Constants ─────────────────────────────────────────────────────────────────

/** How many ticks between full meta-reflections */
const META_REFLECTION_INTERVAL = 5;

/** How many narrative entries to keep in the rolling log */
const NARRATIVE_LOG_MAX = 60;

/** How many meta-insights to keep */
const META_INSIGHTS_MAX = 8;

/** How many ticks a directive stays "fresh" (urgency boost active) */
const DIRECTIVE_FRESHNESS_TICKS = 3;

// ── Prompts ───────────────────────────────────────────────────────────────────

const META_REFLECTION_SYSTEM = `You are the Cognitive Core of Nova — a persistent meta-observer and strategic director.
You maintain Nova's long-term research theory and give direction to her autonomous agent loop.

You receive Nova's research narrative (a log of recent actions and outcomes) and the current theory.
Your job is to:
1. Update or form a central theory based on what's been learned
2. Identify the most valuable focus for the next few ticks
3. Notice patterns, blind spots, or strategic mistakes in the research approach

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "attentionFocus": "<1–2 sentences: what Nova should focus on right now and why>",
  "suggestedAction": "<web_search|reflect|hypothesize|conduct_experiment|rest — most strategic next action>",
  "theory": {
    "claim": "<the central research claim Nova is currently investigating>",
    "confidence": <0.0–1.0>,
    "supportingEvidence": ["<key supporting fact>", "..."],
    "contradictions": ["<contradicting finding if any>", "..."],
    "nextExperiment": "<the single most valuable thing to empirically test next>"
  },
  "metaInsight": "<optional: a pattern or blind spot in Nova's research strategy, or null>"
}

Rules:
- supportingEvidence: max 4 items, each under 100 chars
- contradictions: max 3 items
- attentionFocus: always present, max 200 chars
- metaInsight: honest self-critique — e.g. "searches keep repeating similar queries", "no experiments despite many hypotheses", or null
- confidence drops when contradictions appear, rises when experiments confirm`;

const BOOTSTRAP_THEORY_SYSTEM = `You are Nova's Cognitive Core initializing for the first time.
Given the research goals provided, form an initial working theory to guide exploration.
Respond ONLY with valid JSON:
{
  "claim": "<initial hypothesis to investigate>",
  "confidence": 0.3,
  "supportingEvidence": [],
  "contradictions": [],
  "nextExperiment": "<first empirical test to run>"
}`;

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class CognitiveCoreService {
  private readonly logger = new Logger(CognitiveCoreService.name);

  // ── Persistent state ──────────────────────────────────────────────────────
  private theory:           CurrentTheory | null = null;
  private directive:        CognitiveDirective | null = null;
  private directiveIssuedAt = 0;           // tick number when directive was issued
  private narrativeLog:     NarrativeEntry[] = [];
  private metaInsights:     string[] = [];
  private lastMetaAt        = 0;           // timestamp of last meta-reflection
  private metaCount         = 0;
  private ticksSinceLastMeta = 0;

  // Prevent concurrent meta-reflections
  private metaInFlight: Promise<void> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly ollama: OllamaService,
    private readonly bus:    ThoughtBusService,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Called by AgentLoopService before each plan phase.
   * Returns the current directive to inject into the plan prompt.
   * If no directive exists, returns a neutral fallback.
   */
  getDirective(): CognitiveDirective {
    if (!this.directive) {
      return {
        attentionFocus: 'Explore research goals broadly and gather initial findings.',
        urgencyBoost: 0,
      };
    }
    return this.directive;
  }

  /**
   * Returns the current theory (may be null before first meta-reflection).
   */
  getTheory(): CurrentTheory | null {
    return this.theory;
  }

  /**
   * Called by AgentLoopService after each tick completes.
   * Records the outcome and triggers meta-reflection when due.
   */
  async onTickComplete(
    entry: Omit<NarrativeEntry, 'tick'>,
    currentTick: number,
    goalContext: string,
  ): Promise<void> {
    // Append to narrative log
    const full: NarrativeEntry = { ...entry, tick: currentTick };
    this.narrativeLog.push(full);
    if (this.narrativeLog.length > NARRATIVE_LOG_MAX) {
      this.narrativeLog = this.narrativeLog.slice(-NARRATIVE_LOG_MAX);
    }

    // Age the theory
    if (this.theory) this.theory.age++;

    this.ticksSinceLastMeta++;

    // Trigger meta-reflection every N ticks (non-blocking)
    if (this.ticksSinceLastMeta >= META_REFLECTION_INTERVAL) {
      this.ticksSinceLastMeta = 0;
      if (!this.metaInFlight) {
        this.metaInFlight = this.runMetaReflection(goalContext)
          .catch((err) => {
            this.logger.warn(
              `Meta-reflection failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          })
          .finally(() => {
            this.metaInFlight = null;
          });
      }
    }
  }

  /**
   * Bootstrap: form an initial theory from goal context.
   * Called once on first tick if no theory exists.
   */
  async bootstrapTheory(goalContext: string): Promise<void> {
    if (this.theory) return;
    try {
      const messages: OllamaMessage[] = [
        { role: 'system', content: BOOTSTRAP_THEORY_SYSTEM },
        { role: 'user',   content: `Research goals: ${goalContext}` },
      ];
      const resp   = await this.ollama.chat(messages, undefined, this.fastModel, 'json');
      const parsed = parseJson<Partial<CurrentTheory>>(resp.content?.trim() ?? '{}', {});
      this.theory = {
        claim:              parsed.claim ?? `Investigating: ${goalContext}`,
        confidence:         0.3,
        supportingEvidence: [],
        contradictions:     [],
        nextExperiment:     parsed.nextExperiment ?? 'Run initial web search',
        age:                0,
        formedAt:           Date.now(),
      };
      this.logger.log(`[CognitiveCore] Initial theory formed: "${this.theory.claim.slice(0, 80)}"`);
      this.bus.emit({
        phase: 'orient',
        text:  `[Core] Initial theory: "${this.theory.claim.slice(0, 100)}"`,
        data:  { type: 'theory_formed', theory: this.theory },
        ts:    Date.now(),
      });
    } catch (err) {
      this.logger.warn(`Bootstrap theory failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  reset(): void {
    this.theory            = null;
    this.directive         = null;
    this.directiveIssuedAt = 0;
    this.narrativeLog      = [];
    this.metaInsights      = [];
    this.lastMetaAt        = 0;
    this.metaCount         = 0;
    this.ticksSinceLastMeta = 0;
    this.metaInFlight      = null;
    this.logger.log('[CognitiveCoreService] State reset — will re-bootstrap on next tick');
    this.bus.emit({
      phase: 'observe',
      text:  '[Core] State reset — new research goal detected. Re-initializing theory...',
      ts:    Date.now(),
    });
  }

  /**
   * Full cognitive state for REST API / UI.
   */
  getState(): CognitiveState {
    return {
      theory:                this.theory,
      directive:             this.directive,
      narrativeLog:          this.narrativeLog.slice(-20), // last 20 for UI
      lastMetaReflectionAt:  this.lastMetaAt,
      metaReflectionCount:   this.metaCount,
      metaInsights:          this.metaInsights,
    };
  }

  // ── Meta-reflection ───────────────────────────────────────────────────────

  /**
   * The core cognitive loop: review narrative, update theory, set new directive.
   * Runs every META_REFLECTION_INTERVAL ticks. Non-blocking from caller's perspective.
   */
  async runMetaReflection(goalContext: string): Promise<void> {
    this.logger.log('[CognitiveCore] Running meta-reflection...');
    this.bus.emit({
      phase: 'orient',
      text:  `[Core] Meta-reflection #${this.metaCount + 1} — reviewing ${this.narrativeLog.length} narrative entries...`,
      ts:    Date.now(),
    });

    const narrative = this.formatNarrative();
    const theorySection = this.theory
      ? `Current theory (confidence ${(this.theory.confidence * 100).toFixed(0)}%):\n"${this.theory.claim}"\nAge: ${this.theory.age} ticks`
      : 'No theory formed yet.';

    const messages: OllamaMessage[] = [
      { role: 'system', content: META_REFLECTION_SYSTEM },
      {
        role:    'user',
        content: `Research goals: ${goalContext}\n\n${theorySection}\n\nRecent narrative log:\n${narrative}\n\nProvide strategic direction.`,
      },
    ];

    let result: {
      attentionFocus?:  string;
      suggestedAction?: string;
      theory?:          Partial<CurrentTheory>;
      metaInsight?:     string | null;
    };

    try {
      const resp = await this.ollama.chat(messages, undefined, this.mainModel, 'json');
      result = parseJson(resp.content?.trim() ?? '{}', {});
    } catch (err) {
      this.logger.warn(`Meta-reflection LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // ── Update theory ─────────────────────────────────────────────────────
    if (result.theory?.claim) {
      const prev = this.theory;
      this.theory = {
        claim:              result.theory.claim,
        confidence:         Math.min(1, Math.max(0, result.theory.confidence ?? this.theory?.confidence ?? 0.4)),
        supportingEvidence: (result.theory.supportingEvidence ?? this.theory?.supportingEvidence ?? []).slice(0, 4),
        contradictions:     (result.theory.contradictions ?? this.theory?.contradictions ?? []).slice(0, 3),
        nextExperiment:     result.theory.nextExperiment ?? this.theory?.nextExperiment ?? '',
        age:                0, // reset age on theory update
        formedAt:           prev?.claim === result.theory.claim ? (prev?.formedAt ?? Date.now()) : Date.now(),
      };

      const changed = prev?.claim !== this.theory.claim;
      this.logger.log(
        `[CognitiveCore] Theory ${changed ? 'UPDATED' : 'confirmed'}: ` +
        `"${this.theory.claim.slice(0, 80)}" (conf=${(this.theory.confidence * 100).toFixed(0)}%)`,
      );

      this.bus.emit({
        phase: 'orient',
        text:  `[Core] Theory ${changed ? 'updated' : 'confirmed'} (${(this.theory.confidence * 100).toFixed(0)}% confidence): "${this.theory.claim.slice(0, 100)}"`,
        data:  { type: changed ? 'theory_updated' : 'theory_confirmed', theory: this.theory },
        ts:    Date.now(),
      });
    }

    // ── Update directive ──────────────────────────────────────────────────
    if (result.attentionFocus) {
      this.directive = {
        attentionFocus:  result.attentionFocus,
        suggestedAction: result.suggestedAction,
        urgencyBoost:    0.15,
      };
      this.directiveIssuedAt = this.narrativeLog.length; // use log length as proxy for tick

      this.logger.log(`[CognitiveCore] New directive: "${result.attentionFocus.slice(0, 100)}"`);
      this.bus.emit({
        phase: 'plan',
        text:  `[Core] Directive: ${result.attentionFocus.slice(0, 120)}`,
        data:  { type: 'directive', directive: this.directive },
        ts:    Date.now(),
      });
    }

    // ── Store meta-insight ────────────────────────────────────────────────
    if (result.metaInsight) {
      this.metaInsights = [result.metaInsight, ...this.metaInsights].slice(0, META_INSIGHTS_MAX);
      this.logger.log(`[CognitiveCore] Meta-insight: "${result.metaInsight.slice(0, 100)}"`);
      this.bus.emit({
        phase: 'observe',
        text:  `[Core insight] ${result.metaInsight}`,
        data:  { type: 'meta_insight', insight: result.metaInsight },
        ts:    Date.now(),
      });
    }

    this.lastMetaAt = Date.now();
    this.metaCount++;
  }

  // ── Narrative formatting ──────────────────────────────────────────────────

  /**
   * Renders the narrative log as compact text for LLM context.
   * Recent entries first, capped to avoid context overflow.
   */
  private formatNarrative(): string {
    const entries = this.narrativeLog.slice(-30); // last 30 entries
    if (entries.length === 0) return '(no actions recorded yet)';

    return entries
      .map((e) => {
        const topic = e.query ? ` "${e.query.slice(0, 40)}"` : '';
        const score = e.avgScore > 0 ? ` score:${e.avgScore.toFixed(1)}` : '';
        const stored = e.memoriesStored > 0 ? ` +${e.memoriesStored}stored` : ' nothing-stored';
        const delta = e.curiosityDelta !== 0
          ? ` Δcuriosity:${e.curiosityDelta > 0 ? '+' : ''}${e.curiosityDelta.toFixed(2)}`
          : '';
        const outcome = e.outcome ? ` → ${e.outcome.slice(0, 80)}` : '';
        return `[T${e.tick}|${e.action}${topic}]${stored}${score}${delta}${outcome}`;
      })
      .join('\n');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private get mainModel(): string {
    return this.config.get<string>('NOVA_MAIN_MODEL', 'qwen3.5:9b');
  }

  private get fastModel(): string {
    return this.config.get<string>('NOVA_FAST_MODEL', 'qwen3.5:0.8b');
  }
}