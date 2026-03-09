import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OllamaService, OllamaMessage } from '../generate/ollama.service';
import { NovaMemoryService } from './nova-memory.service';
import { ThoughtBusService } from './thought-bus.service';
import { GoalService } from './goal.service';
import { AgentActionsService } from './agent-loop/agent-actions.service';
import { AgentMemoryService } from './agent-loop/agent-memory.service';
import { CognitiveCoreService } from './cognitive-core.service';
import {
  ConsciousnessState,
  ActionRecord,
  Mood,
  initialState,
  BASE_TICK_MS,
  MIN_TICK_MS,
  MAX_TICK_MS,
  SLEEP_THRESHOLD,
  EXPLORATION_REPEAT_THRESHOLD,
} from './agent-loop/types';
import { buildPlanPrompt, parseJson } from './agent-loop/prompts';

@Injectable()
export class AgentLoopService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentLoopService.name);

  private running  = false;
  private paused   = false;
  private isBusy   = false;
  private busyResolvers: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  private state: ConsciousnessState = initialState();

  private pendingQuestion: string | null = null;
  private questionResolve: ((answer: string) => void) | null = null;
  private pendingGoals = new Map<string, string>();

  constructor(
    private readonly config:        ConfigService,
    private readonly ollama:        OllamaService,
    private readonly memory:        NovaMemoryService,
    private readonly bus:           ThoughtBusService,
    private readonly goals:         GoalService,
    private readonly actions:       AgentActionsService,
    private readonly memSvc:        AgentMemoryService,
    private readonly cognitiveCore: CognitiveCoreService,
  ) {}

  onModuleInit()    { setTimeout(() => this.startLoop(), 8_000); }
  onModuleDestroy() { this.running = false; if (this.timer) clearTimeout(this.timer); }

  // ── GPU pause/resume ──────────────────────────────────────────────────────

  async pause(): Promise<() => void> {
    if (!this.paused) {
      this.paused = true;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    }
    if (this.isBusy) {
      this.logger.debug('AgentLoop paused — waiting for in-flight tick to finish...');
      await new Promise<void>((resolve) => this.busyResolvers.push(resolve));
    }
    this.logger.debug('AgentLoop paused (GPU hand-off)');
    return () => this.resume();
  }

  resume() {
    if (this.paused) {
      this.paused = false;
      this.logger.debug('AgentLoop resumed');
      this.scheduleNext(0.3);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  receiveAnswer(answer: string) {
    if (this.questionResolve) {
      this.questionResolve(answer);
      this.questionResolve = null;
      this.pendingQuestion  = null;
    }
  }

  approveGoal(proposalId: string) {
    const goal = this.pendingGoals.get(proposalId);
    if (goal) {
      this.goals.create(goal).catch(() => {});
      this.pendingGoals.delete(proposalId);
      this.bus.emit({ phase: 'observe', text: `Goal approved and added: "${goal.slice(0, 60)}"`, ts: Date.now() });
    }
  }

  rejectGoal(proposalId: string) {
    this.pendingGoals.delete(proposalId);
  }

  // ── Loop ───────────────────────────────────────────────────────────────────

  private startLoop() { this.running = true; this.tick(); }

  private scheduleNext(urgency: number) {
    if (!this.running) return;
    const energyFactor = 0.5 + this.state.energy * 0.5;
    const base   = MIN_TICK_MS + (1 - urgency) * (BASE_TICK_MS - MIN_TICK_MS);
    const delay  = Math.round(base / energyFactor);
    const clamped = Math.min(MAX_TICK_MS, Math.max(MIN_TICK_MS, delay));
    this.logger.log(`Next tick in ${(clamped / 1000).toFixed(0)}s (urgency=${urgency.toFixed(2)}, energy=${this.state.energy.toFixed(2)})`);
    this.timer = setTimeout(() => this.tick(), clamped);
  }

  private async tick() {
    if (!this.running) return;
    if (this.paused) {
      this.logger.debug('AgentLoop tick skipped (paused)');
      return;
    }
    let urgency = 0.4;
    this.isBusy = true;
    try {
      urgency = await this.runCycle();
    } catch (err) {
      this.logger.error(`AgentLoop error: ${err instanceof Error ? err.message : String(err)}`);
      this.bus.emit({ phase: 'error', text: err instanceof Error ? err.message : 'Unknown error', ts: Date.now() });
    } finally {
      this.isBusy = false;
      for (const resolve of this.busyResolvers) resolve();
      this.busyResolvers = [];
    }
    this.scheduleNext(urgency);
  }

  // ── Main cognitive cycle ───────────────────────────────────────────────────

  private async runCycle(): Promise<number> {
    this.state.tickCount++;
    this.state.energy = Math.max(0, this.state.energy - 0.06);

    // ── Goal context (needed throughout the cycle) ────────────────────────
    const goalContext = await this.goals.getGoalContext();

    // ── Bootstrap cognitive core on first tick ────────────────────────────
    if (this.state.tickCount === 1) {
      await this.cognitiveCore.bootstrapTheory(goalContext);
    }

    // ── Observe ───────────────────────────────────────────────────────────
    const rawCount = await this.memory.countRaw();
    this.bus.emit({
      phase: 'observe',
      text:  `Raw memories: ${rawCount}. Energy: ${(this.state.energy * 100).toFixed(0)}%. Mood: ${this.state.mood}`,
      ts:    Date.now(),
    });

    if (rawCount >= SLEEP_THRESHOLD) {
      await this.memSvc.consolidate(rawCount, this.state);
      return 0.3;
    }

    // ── Orient ────────────────────────────────────────────────────────────
    const memories = await this.memory.recall(goalContext, 8);
    this.bus.emit({
      phase: 'orient',
      text:  `Goals: "${goalContext.slice(0, 70)}${goalContext.length > 70 ? '…' : ''}" | ${memories.length} memories recalled`,
      ts:    Date.now(),
    });

    const memContext = memories.length > 0
      ? `Recent memories:\n${memories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`
      : 'No relevant memories yet.';

    // ── Get cognitive directive ───────────────────────────────────────────
    const directive = this.cognitiveCore.getDirective();
    const theory    = this.cognitiveCore.getTheory();

    // ── Exploration override (hard constraint, runs BEFORE LLM) ──────────
    const explorationOverride = this.checkExplorationOverride(goalContext, memories);

    let plan: {
      action:         string;
      query?:         string;
      hypothesis?:    string;
      reasoning:      string;
      urgency:        number;
      mood_after?:    Mood;
      open_question?: string | null;
    };

    if (explorationOverride) {
      plan = explorationOverride;
      this.bus.emit({
        phase: 'plan',
        text:  `[Exploration override] ${plan.reasoning}`,
        data:  { action: plan.action, query: plan.query, urgency: plan.urgency, override: true },
        ts:    Date.now(),
      });
    } else {
      // ── Normal LLM plan — now enriched with cognitive directive + theory ─
      const planMessages: OllamaMessage[] = [
        { role: 'system', content: buildPlanPrompt(this.state, directive, theory) },
        {
          role:    'user',
          content: `Research goals: ${goalContext}\n\nRaw memory count: ${rawCount}\n\n${memContext}\n\nWhat will you do next?`,
        },
      ];

      try {
        const resp = await this.ollama.chat(planMessages, undefined, this.fastModel, 'json');
        plan = parseJson<typeof plan>(resp.content?.trim() ?? '{}', {
          action: 'web_search', query: goalContext, reasoning: 'Fallback plan', urgency: 0.5,
        });
        if (!plan.action) throw new Error('no action in plan');
      } catch {
        // Fallback: align with directive suggested action if available
        const fallbackAction = directive.suggestedAction ?? 'web_search';
        plan = {
          action:    fallbackAction,
          query:     `${goalContext} ${new Date().getFullYear()}`,
          reasoning: 'Fallback plan (Core directive used)',
          urgency:   0.5,
        };
      }

      this.bus.emit({
        phase: 'plan',
        text:  plan.reasoning,
        data:  { action: plan.action, query: plan.query, urgency: plan.urgency, mood: plan.mood_after },
        ts:    Date.now(),
      });
    }

    // Apply urgency boost from cognitive directive (fades if directive is old)
    const boostedUrgency = Math.min(
      1,
      (plan.urgency ?? 0.4) + directive.urgencyBoost,
    );

    if (plan.mood_after)    this.state.mood = plan.mood_after;
    if (plan.open_question) this.state.openQuestions = [plan.open_question, ...this.state.openQuestions].slice(0, 10);

    const urgency = Math.min(1, Math.max(0, boostedUrgency));
    this.state.lastActionType = plan.action;

    this.state._tickJudgeScores = [];
    this.state._tickStoredCount = 0;

    // ── Act + self-evaluate ───────────────────────────────────────────────
    const curiosityBefore = this.state.curiosity;
    const actionResult    = await this.act(plan.action, plan.query, plan.hypothesis, goalContext, memories, urgency);
    const actionRecord    = this.recordAction(plan.action, plan.query, curiosityBefore);

    // ── Notify Cognitive Core of tick outcome ─────────────────────────────
    await this.cognitiveCore.onTickComplete(
      {
        action:         plan.action,
        query:          plan.query,
        outcome:        this.buildOutcomeSummary(plan.action, actionRecord),
        memoriesStored: actionRecord.memoriesStored,
        avgScore:       actionRecord.avgJudgeScore,
        curiosityDelta: actionRecord.curiosityDelta,
        ts:             Date.now(),
      },
      this.state.tickCount,
      goalContext,
    );

    return actionResult;
  }

  // ── Outcome summary ────────────────────────────────────────────────────────

  private buildOutcomeSummary(action: string, record: ActionRecord): string {
    if (record.memoriesStored > 0) {
      return `Stored ${record.memoriesStored} new fact(s) (avg quality: ${record.avgJudgeScore.toFixed(1)}/10)`;
    }
    if (record.avgJudgeScore < 4) {
      return `Low-quality results — nothing stored`;
    }
    return `Completed ${action} — no new memories`;
  }

  // ── Exploration override ───────────────────────────────────────────────────

  private checkExplorationOverride(
    goalContext: string,
    memories: string[],
  ): { action: string; query?: string; hypothesis?: string; reasoning: string; urgency: number } | null {
    const recentN = this.state.actionHistory.slice(-EXPLORATION_REPEAT_THRESHOLD);

    // Rule 1: N consecutive same actions → force a switch
    if (
      recentN.length >= EXPLORATION_REPEAT_THRESHOLD &&
      recentN.every((r) => r.action === recentN[0].action)
    ) {
      const repeated = recentN[0].action;
      const ESCAPE: Record<string, string> = {
        web_search:  memories.length >= 2 ? 'reflect' : 'hypothesize',
        reflect:     'hypothesize',
        hypothesize: 'web_search',
        rest:        'web_search',
      };
      const next = ESCAPE[repeated] ?? 'reflect';
      return {
        action:    next,
        reasoning: `Forced exploration switch: "${repeated}" repeated ${EXPLORATION_REPEAT_THRESHOLD}× — trying "${next}" instead.`,
        urgency:   0.6,
      };
    }

    // Rule 2: N consecutive low-yield web_search → reflect
    const recentSearches = this.state.actionHistory
      .slice(-EXPLORATION_REPEAT_THRESHOLD)
      .filter((r) => r.action === 'web_search');
    if (
      recentSearches.length >= EXPLORATION_REPEAT_THRESHOLD &&
      recentSearches.every((r) => r.memoriesStored === 0 && r.avgJudgeScore < 4)
    ) {
      return {
        action:    'reflect',
        reasoning: `Low-yield searches detected (0 stored, avg score < 4) — switching to reflection.`,
        urgency:   0.5,
      };
    }

    // Rule 3: High curiosity + open questions + no recent hypothesize → hypothesize
    const hasRecentHypothesis = this.state.actionHistory.slice(-3).some((r) => r.action === 'hypothesize');
    if (
      this.state.curiosity > 0.75 &&
      this.state.openQuestions.length > 2 &&
      !hasRecentHypothesis &&
      this.state.actionHistory.length >= 3
    ) {
      return {
        action:    'hypothesize',
        reasoning: `High curiosity (${(this.state.curiosity * 100).toFixed(0)}%) + ${this.state.openQuestions.length} open questions → generating hypothesis.`,
        urgency:   0.65,
      };
    }

    // Rule 4: High-quality reflect/hypothesize streak → experiment
    const recentHighValue = this.state.actionHistory
      .slice(-3)
      .filter((r) => ['reflect', 'hypothesize'].includes(r.action) && r.avgJudgeScore >= 6);
    if (recentHighValue.length >= 2 && memories.length >= 3 && goalContext.length > 0) {
      const hasRecentExperiment = this.state.actionHistory.slice(-3).some((r) => r.action === 'conduct_experiment');
      if (!hasRecentExperiment) {
        return {
          action:    'conduct_experiment',
          hypothesis: `Based on recent high-quality insights about: ${goalContext}`,
          reasoning: `High-value reflection streak detected (avg score ≥ 6) → running experiment.`,
          urgency:   0.7,
        };
      }
    }

    return null;
  }

  // ── Self-evaluation recorder ───────────────────────────────────────────────

  private recordAction(action: string, query: string | undefined, curiosityBefore: number): ActionRecord {
    const scores        = this.state._tickJudgeScores;
    const avgJudgeScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : (this.state._tickStoredCount > 0 ? 6.5 : 5);

    const record: ActionRecord = {
      action,
      query,
      memoriesStored:  this.state._tickStoredCount,
      avgJudgeScore,
      curiosityDelta:  this.state.curiosity - curiosityBefore,
      ts:              Date.now(),
    };

    this.state.actionHistory = [...this.state.actionHistory, record].slice(-10);

    this.logger.debug(
      `[self-eval] ${action}: stored=${record.memoriesStored}, ` +
      `avgScore=${avgJudgeScore.toFixed(1)}, Δcuriosity=${record.curiosityDelta.toFixed(2)}`,
    );

    return record;
  }

  // ── Dispatch ───────────────────────────────────────────────────────────────

  private async act(
    action: string,
    query: string | undefined,
    hypothesis: string | undefined,
    goalContext: string,
    memories: string[],
    urgency: number,
  ): Promise<number> {
    switch (action) {
      case 'sleep':
        await this.memSvc.consolidate(await this.memory.countRaw(), this.state);
        return 0.3;

      case 'rest':
        this.state.energy    = Math.min(1, this.state.energy + 0.3);
        this.state.curiosity = Math.min(1, this.state.curiosity + 0.1);
        this.bus.emit({ phase: 'observe', text: 'Resting… energy restored.', ts: Date.now() });
        return 0.2;

      case 'reflect':
        return this.actions.doReflect(memories, goalContext, this.state);

      case 'hypothesize':
        return this.actions.doHypothesize(memories, goalContext, this.state);

      case 'ask_user':
        return this.actions.doAskUser(memories, goalContext, this.state, this.pendingQuestion, (q) => {
          this.pendingQuestion = q;
          return new Promise<string>((resolve) => {
            this.questionResolve = resolve;
            setTimeout(() => {
              if (this.questionResolve) {
                this.questionResolve('(no answer)');
                this.questionResolve  = null;
                this.pendingQuestion   = null;
              }
            }, 120_000);
          });
        });

      case 'propose_goal':
        return this.actions.doProposeGoal(memories, goalContext, (id, goal, reasoning) => {
          this.pendingGoals.set(id, goal);
          void reasoning;
        });

      case 'conduct_experiment':
        return this.actions.doExperiment(
          hypothesis ?? memories[0] ?? goalContext,
          goalContext,
          this.state,
        );

      case 'web_search':
      default:
        return this.actions.doWebSearch(query ?? goalContext, goalContext, this.state);
    }
  }

  private get fastModel() {
    return this.config.get<string>('NOVA_FAST_MODEL', 'qwen3.5:9b');
  }
}