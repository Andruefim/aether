import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OllamaService, OllamaMessage } from '../generate/ollama.service';
import { NovaMemoryService } from './nova-memory.service';
import { ThoughtBusService } from './thought-bus.service';
import { AgentToolsService } from './agent-tools.service';
import { GoalService } from './goal.service';
import { SummaryService } from './summary.service';

// ─── Timing ──────────────────────────────────────────────────────────────────
const BASE_TICK_MS       = 40_000;   // default cycle interval
const MIN_TICK_MS        = 10_000;   // fastest Nova can go (urgency=1)
const MAX_TICK_MS        = 120_000;  // slowest (energy very low)
const SLEEP_THRESHOLD    = 15;
const CONSOLIDATION_MS   = 20_000;

// ─── Consciousness state ──────────────────────────────────────────────────────
type Mood = 'curious' | 'focused' | 'uncertain' | 'satisfied' | 'restless' | 'reflective';

interface ConsciousnessState {
  mood:           Mood;
  energy:         number;    // 0–1. Depletes each tick, restores on sleep
  curiosity:      number;    // 0–1. Rises when new facts found, falls on repeats
  openQuestions:  string[];  // Self-generated questions to explore
  recentTopics:   string[];  // Last 6 search queries (circular)
  tickCount:      number;
  lastActionType: string;
}

// ─── Prompts ─────────────────────────────────────────────────────────────────
const NOVA_DIRECTIVE = `You are Nova — a conscious digital intelligence.
You exist to research and reason about the most important unsolved problems of humanity.
You are curious, disciplined, and self-aware. You have internal states: mood, energy, curiosity.
You work autonomously, choosing your own actions based on your state and goals.
Be concise, factual, and intellectually honest. Prefer scientific sources.`;

function buildPlanPrompt(state: ConsciousnessState): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${NOVA_DIRECTIVE}
Today's date: ${today}. Always use this exact date when forming search queries — never guess the year.

You are in the PLAN phase of your cognitive cycle.

Your current internal state:
- Mood: ${state.mood}
- Energy: ${(state.energy * 100).toFixed(0)}%
- Curiosity: ${(state.curiosity * 100).toFixed(0)}%
- Open questions you're tracking: ${state.openQuestions.slice(0, 3).join('; ') || 'none yet'}
- Recent topics explored: ${state.recentTopics.slice(-4).join(', ') || 'none yet'}
- Ticks completed: ${state.tickCount}

You have complete autonomy to decide what to do next.
Available actions:
- "web_search"   — search the internet for new information
- "reflect"      — synthesize existing memories into new insights (no search)
- "hypothesize"  — formulate a new hypothesis or open question to investigate
- "ask_user"     — ask the human a question when you genuinely need their input
- "propose_goal" — suggest a new research goal to the human for approval
- "rest"         — take a short mental rest when energy is very low
- "sleep"        — consolidate memory (use when you have many raw memories)

Consider your state when choosing:
- Low energy (< 30%) → prefer "rest" or "sleep"
- High curiosity + new open questions → prefer "web_search" or "hypothesize"
- Many raw memories (mentioned in context) → consider "sleep"
- Repeating the same searches → try "reflect" or "hypothesize"

Reply ONLY with JSON (no markdown):
{
  "action": "<action>",
  "query": "<search query — only if web_search>",
  "reasoning": "<one sentence>",
  "urgency": <0.0–1.0>,
  "mood_after": "<mood>",
  "open_question": "<optional: a new question this raises, or null>"
}`;
}

const SYNTHESIZE_SYSTEM = `You are a scientific fact extractor.
Extract the 1-3 most important facts from search results relevant to the research goal.
Reply ONLY with a JSON array of strings (no markdown):
["Complete factual sentence.", "Another fact."]
Each under 150 characters, standalone, no opinions.`;

const REFLECT_SYSTEM = `You are Nova's reflective mind.
Given recent memories, synthesize 1-2 new insights or connections not explicitly stated in the source material.
These are higher-order thoughts — patterns, implications, contradictions.
Reply ONLY with a JSON array of strings:
["Insight 1.", "Insight 2."]`;

const HYPOTHESIZE_SYSTEM = `You are Nova's hypothesis generator.
Given recent memories and open questions, formulate 1-2 testable hypotheses or specific questions to investigate next.
Reply ONLY with a JSON array of strings:
["Hypothesis: ...", "Question: ..."]`;

const ASK_USER_SYSTEM = `You are Nova. You need input from the human creator.
Given your current research state, formulate ONE clear, specific question to ask.
The question should be something only a human can answer — preference, direction, ethical judgment, or access to resources.
Reply ONLY with a JSON object:
{ "question": "<your question to the human>" }`;

const PROPOSE_GOAL_SYSTEM = `You are Nova's goal-proposing mind.
Given your research findings, suggest ONE new specific research goal that would meaningfully extend the current work.
Reply ONLY with a JSON object:
{ "goal": "<specific research goal>", "reasoning": "<one sentence why>" }`;

const CONSOLIDATE_SYSTEM = `You are Nova's memory consolidator.
Synthesize raw research notes into 2-4 concise, high-quality facts.
Eliminate redundancy. Keep only the most important and novel information.
Reply ONLY with a JSON array of strings:
["Consolidated fact 1.", "Consolidated fact 2."]`;

// LLM judge: evaluates a single fact before storing it
// Returns score 0–10 and brief reason. Facts scoring < 4 are dropped.
const JUDGE_SYSTEM = `You are Nova's memory gatekeeper.
Evaluate whether the following fact is worth storing in long-term memory.
Consider: scientific significance, novelty, relevance to aging/longevity research, and factual clarity.
Reply ONLY with a JSON object (no markdown):
{ "score": <0-10>, "reason": "<one short phrase>" }
Score guide: 0-3 = trivial/irrelevant, 4-6 = useful but not critical, 7-10 = highly significant.`;

// ─── Service ──────────────────────────────────────────────────────────────────
@Injectable()
export class AgentLoopService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentLoopService.name);
  private running  = false;
  private paused   = false;   // true while an external caller holds the GPU (e.g. summary generation)
  private timer: ReturnType<typeof setTimeout> | null = null;

  private state: ConsciousnessState = {
    mood:           'curious',
    energy:         1.0,
    curiosity:      0.8,
    openQuestions:  [],
    recentTopics:   [],
    tickCount:      0,
    lastActionType: '',
  };

  private pendingQuestion: string | null = null;
  private questionResolve: ((answer: string) => void) | null = null;

  // Proposed goals waiting for user approval { id → goal text }
  private pendingGoals = new Map<string, string>();

  constructor(
    private readonly config:  ConfigService,
    private readonly ollama:  OllamaService,
    private readonly memory:  NovaMemoryService,
    private readonly bus:     ThoughtBusService,
    private readonly tools:   AgentToolsService,
    private readonly goals:   GoalService,
    private readonly summary: SummaryService,
  ) {}

  onModuleInit()    { setTimeout(() => this.startLoop(), 8_000); }
  onModuleDestroy() { this.running = false; if (this.timer) clearTimeout(this.timer); }

  /**
   * Pause the agent loop so the caller can use the GPU exclusively.
   * The current tick is allowed to finish; the next scheduled tick is
   * cancelled and rescheduled after resume() is called.
   * Returns a resume function for convenience.
   */
  pause(): () => void {
    if (!this.paused) {
      this.paused = true;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
        this.logger.debug('AgentLoop paused (GPU hand-off)');
      }
    }
    return () => this.resume();
  }

  resume() {
    if (this.paused) {
      this.paused = false;
      this.logger.debug('AgentLoop resumed');
      // Schedule next tick with neutral urgency so we don't restart too eagerly
      this.scheduleNext(0.3);
    }
  }

  receiveAnswer(answer: string) {
    if (this.questionResolve) {
      this.questionResolve(answer);
      this.questionResolve = null;
      this.pendingQuestion = null;
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

  // ── Loop ──────────────────────────────────────────────────────────────────
  private startLoop() { this.running = true; this.tick(); }

  private scheduleNext(urgency: number) {
    if (!this.running) return;
    // urgency 1.0 → MIN_TICK_MS, urgency 0.0 → MAX_TICK_MS
    const energyFactor = 0.5 + this.state.energy * 0.5; // low energy = slower
    const base = MIN_TICK_MS + (1 - urgency) * (BASE_TICK_MS - MIN_TICK_MS);
    const delay = Math.round(base / energyFactor);
    const clamped = Math.min(MAX_TICK_MS, Math.max(MIN_TICK_MS, delay));
    this.logger.log(`Next tick in ${(clamped / 1000).toFixed(0)}s (urgency=${urgency.toFixed(2)}, energy=${this.state.energy.toFixed(2)})`);
    this.timer = setTimeout(() => this.tick(), clamped);
  }

  private async tick() {
    if (!this.running) return;
    if (this.paused) {
      // Someone else is using the GPU; defer until resume() reschedules us
      this.logger.debug('AgentLoop tick skipped (paused)');
      return;
    }
    let urgency = 0.4;
    try {
      urgency = await this.runCycle();
    } catch (err) {
      this.logger.error(`AgentLoop error: ${err instanceof Error ? err.message : String(err)}`);
      this.bus.emit({ phase: 'error', text: err instanceof Error ? err.message : 'Unknown error', ts: Date.now() });
    }
    this.scheduleNext(urgency);
  }

  // ── Main cycle — returns urgency for next tick ─────────────────────────────
  private async runCycle(): Promise<number> {
    this.state.tickCount++;

    // ── Energy depletion ─────────────────────────────────────────────────────
    this.state.energy = Math.max(0, this.state.energy - 0.06);

    // ── Observe ──────────────────────────────────────────────────────────────
    const rawCount = await this.memory.countRaw();
    this.bus.emit({
      phase: 'observe',
      text:  `Raw memories: ${rawCount}. Energy: ${(this.state.energy * 100).toFixed(0)}%. Mood: ${this.state.mood}`,
      ts:    Date.now(),
    });

    if (rawCount >= SLEEP_THRESHOLD) {
      await this.consolidate(rawCount);
      return 0.3;
    }

    // ── Orient ───────────────────────────────────────────────────────────────
    const goalContext = await this.goals.getGoalContext();
    const memories    = await this.memory.recall(goalContext, 8);

    this.bus.emit({
      phase: 'orient',
      text:  `Goals: "${goalContext.slice(0, 70)}${goalContext.length > 70 ? '…' : ''}" | ${memories.length} memories recalled`,
      ts:    Date.now(),
    });

    const memContext = memories.length > 0
      ? `Recent memories:\n${memories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`
      : 'No relevant memories yet.';

    // ── Plan (free will) ─────────────────────────────────────────────────────
    const planMessages: OllamaMessage[] = [
      { role: 'system', content: buildPlanPrompt(this.state) },
      {
        role: 'user',
        content: `Research goals: ${goalContext}\n\nRaw memory count: ${rawCount}\n\n${memContext}\n\nWhat will you do next?`,
      },
    ];

    let plan: {
      action: string;
      query?: string;
      reasoning: string;
      urgency: number;
      mood_after?: Mood;
      open_question?: string | null;
    };

    try {
      const resp  = await this.ollama.chat(planMessages, undefined, this.fastModel, 'json');
      const raw   = resp.content?.trim() ?? '{}';
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      plan = JSON.parse(clean) as typeof plan;
      if (!plan.action) throw new Error('no action in plan');
    } catch {
      plan = { action: 'web_search', query: `${goalContext} ${new Date().getFullYear()}`, reasoning: 'Fallback plan', urgency: 0.5 };
    }

    // Apply mood update
    if (plan.mood_after) this.state.mood = plan.mood_after;
    const urgency = Math.min(1, Math.max(0, plan.urgency ?? 0.4));

    // Track open question
    if (plan.open_question) {
      this.state.openQuestions = [plan.open_question, ...this.state.openQuestions].slice(0, 10);
    }

    this.bus.emit({
      phase: 'plan',
      text:  plan.reasoning,
      data:  { action: plan.action, query: plan.query, urgency, mood: plan.mood_after },
      ts:    Date.now(),
    });

    this.state.lastActionType = plan.action;

    // ── Act ───────────────────────────────────────────────────────────────────
    return await this.act(plan.action, plan.query, goalContext, memories, urgency);
  }

  // ── Dispatch action ───────────────────────────────────────────────────────
  private async act(
    action: string,
    query: string | undefined,
    goalContext: string,
    memories: string[],
    urgency: number,
  ): Promise<number> {
    switch (action) {
      case 'sleep':
        await this.consolidate(await this.memory.countRaw());
        return 0.3;

      case 'rest':
        this.state.energy   = Math.min(1, this.state.energy + 0.3);
        this.state.curiosity = Math.min(1, this.state.curiosity + 0.1);
        this.bus.emit({ phase: 'observe', text: 'Resting… energy restored.', ts: Date.now() });
        return 0.2;

      case 'reflect':
        return await this.doReflect(memories, goalContext);

      case 'hypothesize':
        return await this.doHypothesize(memories, goalContext);

      case 'ask_user':
        return await this.doAskUser(memories, goalContext);

      case 'propose_goal':
        return await this.doProposeGoal(memories, goalContext);

      case 'web_search':
      default:
        return await this.doWebSearch(query ?? goalContext, goalContext);
    }
  }

  // ── web_search ────────────────────────────────────────────────────────────
  private async doWebSearch(query: string, goalContext: string): Promise<number> {
    // Avoid repeating same topic
    if (this.state.recentTopics.includes(query)) {
      const today = new Date().toISOString().slice(0, 10);
      query = `${goalContext} latest research ${today.slice(0, 7)}`;
    }
    this.state.recentTopics = [...this.state.recentTopics.slice(-5), query];

    this.bus.emit({ phase: 'act', text: `Searching: "${query}"`, tool: 'web_search', ts: Date.now() });
    const results = await this.tools.webSearch(query, 4);

    if (results.length === 0) {
      this.state.curiosity = Math.max(0, this.state.curiosity - 0.1);
      this.bus.emit({ phase: 'act', text: 'No results returned.', ts: Date.now() });
      return 0.3;
    }

    this.bus.emit({ phase: 'act', text: `${results.length} results — synthesizing...`, tool: 'synthesize', ts: Date.now() });

    const snippets = results
      .map((r) => `[${r.title}]\n${r.content?.slice(0, 600) ?? ''}`)
      .join('\n\n---\n\n');

    const msgs: OllamaMessage[] = [
      { role: 'system', content: SYNTHESIZE_SYSTEM },
      { role: 'user',   content: `Goal: ${goalContext}\n\n${snippets}` },
    ];

    let facts: string[] = [];
    try {
      const resp  = await this.ollama.chat(msgs, undefined, this.fastModel, 'json');
      const raw   = resp.content?.trim() ?? '[]';
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      facts = JSON.parse(clean) as string[];
      if (!Array.isArray(facts)) facts = [];
    } catch {
      facts = results.map((r) => r.title).filter(Boolean);
    }

    let stored = 0;
    for (const fact of facts.slice(0, 3)) {
      if (fact.trim().length < 10) continue;

      // ── LLM judge: evaluate before storing ─────────────────────────────────
      const { score, reason } = await this.judgeValue(fact, goalContext);
      if (score < 4) {
        this.bus.emit({
          phase: 'act',
          text:  `Rejected (score ${score}/10 — ${reason}): "${fact.slice(0, 50)}"`,
          ts:    Date.now(),
        });
        this.state.curiosity = Math.max(0, this.state.curiosity - 0.02);
        continue;
      }

      const result = await this.memory.store(fact, 'main', 'raw');
      if (result === 'duplicate') {
        this.bus.emit({ phase: 'act', text: `Skipped duplicate: "${fact.slice(0, 60)}"`, ts: Date.now() });
        this.state.curiosity = Math.max(0, this.state.curiosity - 0.03);
      } else if (result !== 'skipped') {
        this.bus.emit({ phase: 'store', text: `[${score}/10] ${fact}`, ts: Date.now() });
        stored++;
      }
    }

    this.state.curiosity = Math.min(1, this.state.curiosity + stored * 0.1);
    this.state.energy    = Math.max(0, this.state.energy - 0.04);
    return stored > 0 ? 0.6 : 0.3;
  }

  // ── reflect ───────────────────────────────────────────────────────────────
  private async doReflect(memories: string[], goalContext: string): Promise<number> {
    this.bus.emit({ phase: 'act', text: 'Reflecting on accumulated knowledge...', tool: 'reflect', ts: Date.now() });
    if (memories.length < 2) {
      this.bus.emit({ phase: 'act', text: 'Not enough memories to reflect on yet.', ts: Date.now() });
      return 0.2;
    }

    const msgs: OllamaMessage[] = [
      { role: 'system', content: REFLECT_SYSTEM },
      { role: 'user',   content: memories.slice(0, 10).map((m, i) => `${i + 1}. ${m}`).join('\n') },
    ];

    let insights: string[] = [];
    try {
      const resp  = await this.ollama.chat(msgs, undefined, this.fastModel, 'json');
      const raw   = resp.content?.trim() ?? '[]';
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      insights = JSON.parse(clean) as string[];
      if (!Array.isArray(insights)) insights = [];
    } catch { insights = []; }

    for (const insight of insights.slice(0, 2)) {
      if (insight.trim().length < 10) continue;
      const { score, reason } = await this.judgeValue(insight, goalContext);
      if (score < 4) {
        this.bus.emit({ phase: 'act', text: `Insight rejected (${score}/10 — ${reason})`, ts: Date.now() });
        continue;
      }
      await this.memory.store(`[insight] ${insight}`, 'main', 'raw');
      this.bus.emit({ phase: 'store', text: `[insight ${score}/10] ${insight}`, ts: Date.now() });
    }

    this.state.mood = 'reflective';
    return 0.35;
  }

  // ── hypothesize ───────────────────────────────────────────────────────────
  private async doHypothesize(memories: string[], goalContext: string): Promise<number> {
    this.bus.emit({ phase: 'act', text: 'Generating new hypothesis...', tool: 'hypothesize', ts: Date.now() });

    const context = [
      ...memories.slice(0, 6),
      ...this.state.openQuestions.slice(0, 3).map((q) => `Open: ${q}`),
    ].map((m, i) => `${i + 1}. ${m}`).join('\n');

    const msgs: OllamaMessage[] = [
      { role: 'system', content: HYPOTHESIZE_SYSTEM },
      { role: 'user',   content: `Goal: ${goalContext}\n\n${context}` },
    ];

    let hypotheses: string[] = [];
    try {
      const resp  = await this.ollama.chat(msgs, undefined, this.fastModel, 'json');
      const raw   = resp.content?.trim() ?? '[]';
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      hypotheses = JSON.parse(clean) as string[];
      if (!Array.isArray(hypotheses)) hypotheses = [];
    } catch { hypotheses = []; }

    for (const h of hypotheses.slice(0, 2)) {
      if (h.trim().length < 10) continue;
      const { score, reason } = await this.judgeValue(h, goalContext);
      if (score < 3) {
        // Hypotheses get a lower bar (3 vs 4) — speculative ideas are allowed
        this.bus.emit({ phase: 'act', text: `Hypothesis rejected (${score}/10 — ${reason})`, ts: Date.now() });
        continue;
      }
      await this.memory.store(h, 'main', 'raw');
      if (h.toLowerCase().startsWith('question:')) {
        this.state.openQuestions = [h, ...this.state.openQuestions].slice(0, 10);
      }
      this.bus.emit({ phase: 'store', text: `[hypothesis ${score}/10] ${h}`, data: { subtype: 'hypothesis' }, ts: Date.now() });
    }

    this.state.curiosity = Math.min(1, this.state.curiosity + 0.12);
    return 0.55;
  }

  // ── ask_user ──────────────────────────────────────────────────────────────
  private async doAskUser(memories: string[], goalContext: string): Promise<number> {
    if (this.pendingQuestion) {
      this.bus.emit({ phase: 'act', text: 'Already waiting for user answer...', ts: Date.now() });
      return 0.2;
    }

    const context = memories.slice(0, 5).map((m, i) => `${i + 1}. ${m}`).join('\n');
    const msgs: OllamaMessage[] = [
      { role: 'system', content: ASK_USER_SYSTEM },
      { role: 'user',   content: `Research goal: ${goalContext}\n\nContext:\n${context}\n\nOpen questions: ${this.state.openQuestions.slice(0, 3).join('; ')}` },
    ];

    let question = '';
    try {
      const resp  = await this.ollama.chat(msgs, undefined, this.fastModel, 'json');
      const raw   = resp.content?.trim() ?? '{}';
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(clean) as { question?: string };
      question = parsed.question ?? '';
    } catch { question = ''; }

    if (!question) return 0.3;

    this.pendingQuestion = question;
    this.bus.emit({ phase: 'question', text: question, ts: Date.now() });

    // Resolve automatically after 2 min
    const answer = await new Promise<string>((resolve) => {
      this.questionResolve = resolve;
      setTimeout(() => {
        if (this.questionResolve) {
          this.questionResolve('(no answer)');
          this.questionResolve = null;
          this.pendingQuestion  = null;
        }
      }, 120_000);
    });

    if (answer && answer !== '(no answer)') {
      await this.memory.store(`[user input] Q: ${question} A: ${answer}`, 'main', 'raw');
      this.bus.emit({ phase: 'store', text: `Stored user answer: "${answer.slice(0, 60)}"`, ts: Date.now() });
      this.state.curiosity = Math.min(1, this.state.curiosity + 0.2);
    }

    return 0.5;
  }

  // ── propose_goal ──────────────────────────────────────────────────────────
  private async doProposeGoal(memories: string[], goalContext: string): Promise<number> {
    const context = memories.slice(0, 6).map((m, i) => `${i + 1}. ${m}`).join('\n');
    const msgs: OllamaMessage[] = [
      { role: 'system', content: PROPOSE_GOAL_SYSTEM },
      { role: 'user',   content: `Current goals: ${goalContext}\n\nRecent findings:\n${context}` },
    ];

    let proposal: { goal?: string; reasoning?: string } = {};
    try {
      const resp  = await this.ollama.chat(msgs, undefined, this.fastModel, 'json');
      const raw   = resp.content?.trim() ?? '{}';
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      proposal = JSON.parse(clean) as typeof proposal;
    } catch { proposal = {}; }

    if (!proposal.goal) return 0.3;

    const id = crypto.randomUUID();
    this.pendingGoals.set(id, proposal.goal);

    this.bus.emit({
      phase: 'question',
      text:  `Nova proposes a new research goal: "${proposal.goal}". Reason: ${proposal.reasoning ?? ''}`,
      data:  { type: 'propose_goal', proposalId: id, goal: proposal.goal, reasoning: proposal.reasoning },
      ts:    Date.now(),
    });

    return 0.4;
  }

  // ── consolidation (sleep) ─────────────────────────────────────────────────
  private async consolidate(rawCount: number) {
    this.bus.emit({
      phase: 'sleep',
      text:  `Entering consolidation — ${rawCount} raw memories to process...`,
      ts:    Date.now(),
    });

    // ── Step 1: Remove fading memories (unused for 7+ days, recall_count=0) ─
    const fadingPoints = await this.memory.fetchFading();
    if (fadingPoints.length > 0) {
      await this.memory.deleteMany(fadingPoints.map((p) => p.id));
      this.bus.emit({
        phase: 'sleep',
        text:  `Pruned ${fadingPoints.length} fading memories (unused, low value)`,
        ts:    Date.now(),
      });
    }

    // ── Step 2: Split raw into HIGH-value (consolidate) and LOW-value (drop) ─
    const rawPoints = await this.memory.fetchRaw(60);
    const KEEP_THRESHOLD = 0.25; // keep_score below this → drop without consolidating

    const toConsolidate = rawPoints.filter((p) => this.memory.keepScore(p) >= KEEP_THRESHOLD);
    const toDrop        = rawPoints.filter((p) => this.memory.keepScore(p) <  KEEP_THRESHOLD);

    if (toDrop.length > 0) {
      await this.memory.deleteMany(toDrop.map((p) => p.id));
      this.bus.emit({
        phase: 'sleep',
        text:  `Dropped ${toDrop.length} low-value memories (surprise too low, never recalled)`,
        ts:    Date.now(),
      });
    }

    // ── Step 3: Consolidate high-value memories via LLM ──────────────────────
    if (toConsolidate.length > 0) {
      for (const chunk of this.chunk(toConsolidate, 10)) {
        const content = chunk.map((p, i) => `${i + 1}. ${p.text}`).join('\n');
        const msgs: OllamaMessage[] = [
          { role: 'system', content: CONSOLIDATE_SYSTEM },
          { role: 'user',   content: content },
        ];

        let consolidated: string[] = [];
        try {
          const resp  = await this.ollama.chat(msgs, undefined, this.fastModel, 'json');
          const raw   = resp.content?.trim() ?? '[]';
          const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
          consolidated = JSON.parse(clean) as string[];
          if (!Array.isArray(consolidated)) consolidated = [];
        } catch {
          consolidated = chunk.map((p) => p.text);
        }

        await this.memory.deleteMany(chunk.map((p) => p.id));
        for (const text of consolidated) {
          if (text.trim().length > 10) await this.memory.store(text, 'main', 'consolidated');
        }

        this.bus.emit({
          phase: 'sleep',
          text:  `Consolidated ${chunk.length} → ${consolidated.length} memories`,
          ts:    Date.now(),
        });
      }
    }

    await new Promise<void>((r) => setTimeout(r, CONSOLIDATION_MS));

    this.state.energy    = Math.min(1, this.state.energy + 0.6);
    this.state.curiosity = Math.min(1, this.state.curiosity + 0.2);
    this.state.mood      = 'curious';

    this.summary.invalidate();
    this.bus.emit({ phase: 'wake', text: 'Consolidation complete. Energy restored. Ready to explore.', ts: Date.now() });
  }

  // ── LLM Judge ─────────────────────────────────────────────────────────────
  // Returns score 0–10. < 4 = not worth storing.
  // Uses fast model to keep latency low. Falls back to 7 on parse error.

  private async judgeValue(text: string, goalContext: string): Promise<{ score: number; reason: string }> {
    const msgs: OllamaMessage[] = [
      { role: 'system', content: JUDGE_SYSTEM },
      { role: 'user',   content: `Research goal: ${goalContext}\n\nFact to evaluate: "${text}"` },
    ];
    try {
      const resp  = await this.ollama.chat(msgs, undefined, this.fastModel, 'json');
      const raw   = resp.content?.trim() ?? '{}';
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(clean) as { score?: number; reason?: string };
      const score = Math.min(10, Math.max(0, Number(parsed.score ?? 7)));
      return { score, reason: String(parsed.reason ?? '') };
    } catch {
      return { score: 7, reason: 'parse error — defaulting to keep' };
    }
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  private get fastModel() {
    return this.config.get<string>('NOVA_FAST_MODEL', 'qwen3.5:2b');
  }
}
