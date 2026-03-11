import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OllamaService, OllamaMessage } from '../generate/ollama.service';
import { NovaMemoryService } from './nova-memory.service';
import { ThoughtBusService } from './thought-bus.service';
import { GoalService } from './goal.service';
import { AgentActionsService } from './agent-loop/agent-actions.service';
import { AgentMemoryService } from './agent-loop/agent-memory.service';
import { CognitiveCoreService } from './cognitive-core.service';
import { NovaIdentityService } from './nova-identity.service';
import {
  ConsciousnessState,
  ActionRecord,
  Mood,
  initialState,
  BASE_TICK_MS,
  MIN_TICK_MS,
  MAX_TICK_MS,
  SLEEP_THRESHOLD,
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

  // Track goal changes for cognitive core reset
  private lastGoalContext = '';

  constructor(
    private readonly config:        ConfigService,
    private readonly ollama:        OllamaService,
    private readonly memory:        NovaMemoryService,
    private readonly bus:           ThoughtBusService,
    private readonly goals:         GoalService,
    private readonly actions:       AgentActionsService,
    private readonly memSvc:        AgentMemoryService,
    private readonly cognitiveCore: CognitiveCoreService,
    private readonly identity:      NovaIdentityService,
  ) {}

  onModuleInit()    { setTimeout(() => this.startLoop(), 8_000); }
  onModuleDestroy() { this.running = false; if (this.timer) clearTimeout(this.timer); }

  // ── GPU pause/resume ──────────────────────────────────────────────────────

  async pause(): Promise<() => void> {
    if (!this.paused) {
      this.paused = true;
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    }
    if (this.isBusy) {
      this.logger.debug('AgentLoop paused — waiting for in-flight tick...');
      await new Promise<void>((resolve) => this.busyResolvers.push(resolve));
    }
    return () => this.resume();
  }

  resume() {
    if (this.paused) {
      this.paused = false;
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
      this.cognitiveCore.reset();
      this.bus.emit({ phase: 'observe', text: `Goal approved: "${goal.slice(0, 60)}"`, ts: Date.now() });
    }
  }

  rejectGoal(proposalId: string) {
    this.pendingGoals.delete(proposalId);
  }

  injectUserCorrection(text: string) {
    this.state.openQuestions = [
      `USER CORRECTED ME: "${text}" — I must reconsider my previous findings on this.`,
      ...this.state.openQuestions,
    ].slice(0, 10);
  
    this.state.recentTopics = [];
  }

  hasPendingQuestion(): boolean {
    return this.pendingQuestion !== null;
  }

  // ── Loop ───────────────────────────────────────────────────────────────────

  private startLoop() { this.running = true; this.tick(); }

  private scheduleNext(urgency: number) {
    if (!this.running) return;
    const energyFactor = 0.5 + this.state.energy * 0.5;
    const base    = MIN_TICK_MS + (1 - urgency) * (BASE_TICK_MS - MIN_TICK_MS);
    const delay   = Math.round(base / energyFactor);
    const clamped = Math.min(MAX_TICK_MS, Math.max(MIN_TICK_MS, delay));
    this.timer = setTimeout(() => this.tick(), clamped);
  }

  private async tick() {
    if (!this.running || this.paused) return;
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
    this.identity.recordTick();

    const goalContext = await this.goals.getGoalContext();

    // ── Detect goal change + re-bootstrap ─────────────────────────────────
    const goalChanged = goalContext !== this.lastGoalContext && this.lastGoalContext !== '';
    if (this.state.tickCount === 1 || goalChanged) {
      if (goalChanged) {
        this.logger.log(`[AgentLoop] Goal changed — resetting cognitive core`);
        this.cognitiveCore.reset();
        this.state.recentTopics  = [];
        this.state.openQuestions = [];
      }
      await this.cognitiveCore.bootstrapTheory(goalContext);
    }
    this.lastGoalContext = goalContext;

    // ── Observe ───────────────────────────────────────────────────────────
    const rawCount = await this.memory.countRaw();
    this.bus.emit({
      phase: 'observe',
      text:  `Raw memories: ${rawCount}. Energy: ${(this.state.energy * 100).toFixed(0)}%. Mood: ${this.state.mood}`,
      ts:    Date.now(),
    });

    if (rawCount >= SLEEP_THRESHOLD) {
      await this.memSvc.consolidate(rawCount, this.state, goalContext);
      return 0.3;
    }

    // ── Orient ────────────────────────────────────────────────────────────
    const memories = await this.memory.recall(goalContext, 8);
    this.bus.emit({
      phase: 'orient',
      text:  `Goals: "${goalContext.slice(0, 70)}…" | ${memories.length} memories recalled`,
      ts:    Date.now(),
    });

    const memContext = memories.length > 0
      ? `Recent memories:\n${memories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`
      : 'No relevant memories yet.';

    const directive     = this.cognitiveCore.getDirective();
    const theory        = this.cognitiveCore.getTheory();
    const identityCtx   = this.identity.buildDynamicContext();

    // ── Plan ──────────────────────────────────────────────────────────────
    let plan: {
      action:         string;
      query?:         string;
      hypothesis?:    string;
      message?:       string;
      reasoning:      string;
      urgency:        number;
      mood_after?:    Mood;
      open_question?: string | null;
    };

    const planMessages: OllamaMessage[] = [
      { role: 'system', content: buildPlanPrompt(this.state, directive, theory, identityCtx) },
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
      if (!plan.action) throw new Error('no action');
    } catch {
      plan = {
        action:    directive.suggestedAction ?? 'web_search',
        query:     goalContext,
        reasoning: 'Fallback plan',
        urgency:   0.5,
      };
    }

    this.bus.emit({
      phase: 'plan',
      text:  plan.reasoning,
      data:  { action: plan.action, query: plan.query, urgency: plan.urgency, mood: plan.mood_after },
      ts:    Date.now(),
    });

    const boostedUrgency = Math.min(1, (plan.urgency ?? 0.4) + directive.urgencyBoost);
    if (plan.mood_after)    this.state.mood = plan.mood_after;
    if (plan.open_question) {
      this.state.openQuestions = [plan.open_question, ...this.state.openQuestions].slice(0, 10);
      this.identity.addCuriosity(plan.open_question);
    }

    const urgency = Math.min(1, Math.max(0, boostedUrgency));
    this.state.lastActionType = plan.action;
    this.state._tickJudgeScores = [];
    this.state._tickStoredCount = 0;

    const curiosityBefore = this.state.curiosity;
    const actionResult    = await this.act(plan.action, plan.query, plan.hypothesis, plan.message, goalContext, memories, urgency);
    const actionRecord    = this.recordAction(plan.action, plan.query, curiosityBefore);

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

  // ── Dispatch ───────────────────────────────────────────────────────────────

  private async act(
    action: string,
    query: string | undefined,
    hypothesis: string | undefined,
    message: string | undefined,
    goalContext: string,
    memories: string[],
    urgency: number,
  ): Promise<number> {
    switch (action) {
      case 'sleep':
        await this.memSvc.consolidate(await this.memory.countRaw(), this.state, goalContext);
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

      case 'speak_to_user':
        return this.actions.doSpeakToUser(memories, goalContext, this.state);

      case 'ask_user':
        return this.actions.doAskUser(memories, goalContext, this.state, this.pendingQuestion, (q) => {
          this.pendingQuestion = q;
          return new Promise<string>((resolve) => {
            this.questionResolve = resolve;
            setTimeout(() => {
              if (this.questionResolve) {
                this.questionResolve('(no answer)');
                this.questionResolve = null;
                this.pendingQuestion  = null;
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

  // ── Helpers ────────────────────────────────────────────────────────────────

  private buildOutcomeSummary(action: string, record: ActionRecord): string {
    if (record.memoriesStored > 0)
      return `Stored ${record.memoriesStored} new fact(s) (avg quality: ${record.avgJudgeScore.toFixed(1)}/10)`;
    if (record.avgJudgeScore < 4)
      return `Low-quality results — nothing stored`;
    return `Completed ${action} — no new memories`;
  }

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
    return record;
  }

  private get fastModel() {
    return this.config.get<string>('NOVA_FAST_MODEL', 'qwen3.5:9b');
  }
}