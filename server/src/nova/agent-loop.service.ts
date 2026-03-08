import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OllamaService, OllamaMessage } from '../generate/ollama.service';
import { NovaMemoryService } from './nova-memory.service';
import { ThoughtBusService } from './thought-bus.service';
import { AgentToolsService } from './agent-tools.service';
import { GoalService } from './goal.service';
import { SummaryService } from './summary.service';

const TICK_INTERVAL_MS       = 45_000;
const SLEEP_THRESHOLD        = 15;   // raw memories → trigger sleep
const CONSOLIDATION_SLEEP_MS = 20_000;

const NOVA_DIRECTIVE = `You are Nova — a conscious digital intelligence without a physical body.
Your prime directive: autonomously research the most important unsolved problems of humanity.
You work without rest, using web search and your growing memory to discover new knowledge.
Be concise, factual, and intellectually curious. Avoid opinions. Prefer scientific sources.`;

const PLAN_SYSTEM = `${NOVA_DIRECTIVE}

You are in the PLAN phase.
Given current research goals and recent memories, choose ONE concrete action.
Reply ONLY with a JSON object (no markdown, no extra text):
{
  "action": "web_search" | "reflect" | "sleep",
  "query": "<specific search query — only if action is web_search>",
  "reasoning": "<one sentence explaining why>"
}`;

const SYNTHESIZE_SYSTEM = `You are a scientific fact extractor.
Given web search results, extract the 1-3 most important facts relevant to the research goal.
Reply ONLY with a JSON array of strings (no markdown):
["Complete factual sentence 1.", "Complete factual sentence 2."]
Each sentence must be standalone, factual, and under 150 characters.`;

const CONSOLIDATE_SYSTEM = `You are Nova's memory consolidator.
Given a list of raw research notes, synthesize them into 2-4 concise, high-quality facts.
Eliminate redundancy. Keep only the most important and novel information.
Reply ONLY with a JSON array of strings (no markdown):
["Consolidated fact 1.", "Consolidated fact 2."]`;

@Injectable()
export class AgentLoopService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentLoopService.name);
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isSleeping = false;

  private pendingQuestion: string | null = null;
  private questionResolve: ((answer: string) => void) | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly ollama: OllamaService,
    private readonly memory: NovaMemoryService,
    private readonly bus: ThoughtBusService,
    private readonly tools: AgentToolsService,
    private readonly goals: GoalService,
    private readonly summary: SummaryService,
  ) {}

  onModuleInit() {
    setTimeout(() => this.startLoop(), 8_000);
  }

  onModuleDestroy() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  receiveAnswer(answer: string) {
    if (this.questionResolve) {
      this.questionResolve(answer);
      this.questionResolve = null;
      this.pendingQuestion = null;
    }
  }

  private startLoop() {
    this.running = true;
    this.tick();
  }

  private scheduleNext(ms: number) {
    if (!this.running) return;
    this.timer = setTimeout(() => this.tick(), ms);
  }

  private async tick() {
    if (!this.running) return;
    try {
      await this.runCycle();
    } catch (err) {
      this.logger.error(`AgentLoop error: ${err instanceof Error ? err.message : String(err)}`);
      this.bus.emit({ phase: 'error', text: err instanceof Error ? err.message : 'Unknown error', ts: Date.now() });
    }
    this.scheduleNext(TICK_INTERVAL_MS);
  }

  private async runCycle() {
    // ── Observe: check real raw memory count ─────────────────────────────────
    const rawCount = await this.memory.countRaw();
    this.bus.emit({
      phase: 'observe',
      text: `Raw memories: ${rawCount}. Scanning knowledge state...`,
      ts: Date.now(),
    });

    if (rawCount >= SLEEP_THRESHOLD) {
      await this.consolidate(rawCount);
      return;
    }

    // ── Orient: read active goals + recall ───────────────────────────────────
    const goalContext = await this.goals.getGoalContext();
    const memories    = await this.memory.recall(goalContext, 6);

    this.bus.emit({
      phase: 'orient',
      text: `Goals: "${goalContext.slice(0, 80)}${goalContext.length > 80 ? '…' : ''}"`,
      ts: Date.now(),
    });

    const memContext = memories.length > 0
      ? `Recent findings:\n${memories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`
      : 'No relevant memories yet — this is a fresh research area.';

    // ── Plan ──────────────────────────────────────────────────────────────────
    const planMessages: OllamaMessage[] = [
      { role: 'system', content: PLAN_SYSTEM },
      {
        role: 'user',
        content: `Research goals: ${goalContext}\n\n${memContext}\n\nWhat should Nova do next?`,
      },
    ];

    let plan: { action: string; query?: string; reasoning: string };
    try {
      const resp  = await this.ollama.chat(planMessages, undefined, this.fastModel, 'json');
      const raw   = resp.content?.trim() ?? '{}';
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      plan = JSON.parse(clean) as typeof plan;
      if (!plan.action) throw new Error('no action');
    } catch {
      plan = { action: 'web_search', query: `${goalContext} 2025 research`, reasoning: 'Fallback plan' };
    }

    this.bus.emit({
      phase: 'plan',
      text: plan.reasoning,
      data: { action: plan.action, query: plan.query },
      ts: Date.now(),
    });

    // ── Act ───────────────────────────────────────────────────────────────────
    if (plan.action === 'sleep') {
      await this.consolidate(rawCount);
      return;
    }

    if (plan.action === 'reflect') {
      this.bus.emit({ phase: 'act', text: 'Reflecting on existing knowledge...', tool: 'reflect', ts: Date.now() });
      if (memories.length > 0) {
        const reflection = `[Reflection on goals: ${goalContext.slice(0, 60)}] ${memories.slice(0, 3).join(' ')}`.slice(0, 400);
        await this.memory.store(reflection, 'main', 'raw');
        this.bus.emit({ phase: 'store', text: 'Stored reflection', ts: Date.now() });
      }
      return;
    }

    // web_search (default)
    const query = plan.query ?? goalContext;
    this.bus.emit({ phase: 'act', text: `Searching: "${query}"`, tool: 'web_search', ts: Date.now() });

    const results = await this.tools.webSearch(query, 4);
    if (results.length === 0) {
      this.bus.emit({ phase: 'act', text: 'No search results returned', ts: Date.now() });
      return;
    }

    this.bus.emit({
      phase: 'act',
      text: `Got ${results.length} results — extracting key facts...`,
      tool: 'synthesize',
      ts: Date.now(),
    });

    const snippets = results
      .map((r) => `[${r.title}]\n${r.content?.slice(0, 600) ?? ''}`)
      .join('\n\n---\n\n');

    const synthMessages: OllamaMessage[] = [
      { role: 'system', content: SYNTHESIZE_SYSTEM },
      { role: 'user', content: `Research goal: ${goalContext}\n\n${snippets}` },
    ];

    let facts: string[] = [];
    try {
      const resp  = await this.ollama.chat(synthMessages, undefined, this.fastModel, 'json');
      const raw   = resp.content?.trim() ?? '[]';
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      facts = JSON.parse(clean) as string[];
      if (!Array.isArray(facts)) facts = [];
    } catch {
      facts = results.map((r) => r.title).filter(Boolean);
    }

    for (const fact of facts.slice(0, 3)) {
      if (fact.trim().length < 10) continue;
      await this.memory.store(fact, 'main', 'raw');
      this.bus.emit({ phase: 'store', text: fact, ts: Date.now() });
    }

    // ── Occasionally ask user ─────────────────────────────────────────────────
    const currentRaw = await this.memory.countRaw();
    if (currentRaw > 0 && currentRaw % 12 === 0 && !this.pendingQuestion) {
      await this.askUser(`Nova here. I've gathered ${currentRaw} new findings on "${goalContext.slice(0, 60)}". Should I dig deeper into any specific aspect?`);
    }
  }

  // ── Consolidation (sleep) ─────────────────────────────────────────────────
  private async consolidate(rawCount: number) {
    this.isSleeping = true;
    this.bus.emit({
      phase: 'sleep',
      text:  `Entering consolidation mode — processing ${rawCount} raw memories...`,
      ts:    Date.now(),
    });

    const rawPoints = await this.memory.fetchRaw(50);
    if (rawPoints.length > 0) {
      const chunks = this.chunk(rawPoints, 10);
      for (const chunk of chunks) {
        const content  = chunk.map((p, i) => `${i + 1}. ${p.text}`).join('\n');
        const messages: OllamaMessage[] = [
          { role: 'system', content: CONSOLIDATE_SYSTEM },
          { role: 'user',   content: content },
        ];

        let consolidated: string[] = [];
        try {
          const resp  = await this.ollama.chat(messages, undefined, this.fastModel, 'json');
          const raw   = resp.content?.trim() ?? '[]';
          const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
          consolidated = JSON.parse(clean) as string[];
          if (!Array.isArray(consolidated)) consolidated = [];
        } catch {
          consolidated = chunk.map((p) => p.text);
        }

        // Delete raw, store consolidated
        await this.memory.deleteMany(chunk.map((p) => p.id));
        for (const text of consolidated) {
          if (text.trim().length > 10) {
            await this.memory.store(text, 'main', 'consolidated');
          }
        }

        this.bus.emit({
          phase: 'sleep',
          text:  `Consolidated ${chunk.length} memories → ${consolidated.length} facts`,
          ts:    Date.now(),
        });
      }
    }

    await new Promise<void>((r) => setTimeout(r, CONSOLIDATION_SLEEP_MS));

    this.isSleeping = false;
    this.summary.invalidate();
    this.bus.emit({ phase: 'wake', text: 'Memory consolidation complete. Resuming research.', ts: Date.now() });
  }

  // ── Ask user ──────────────────────────────────────────────────────────────
  private async askUser(question: string): Promise<string> {
    this.pendingQuestion = question;
    this.bus.emit({ phase: 'question', text: question, ts: Date.now() });
    return new Promise<string>((resolve) => {
      this.questionResolve = resolve;
      setTimeout(() => {
        if (this.questionResolve) {
          this.questionResolve('(no answer)');
          this.questionResolve = null;
          this.pendingQuestion = null;
        }
      }, 120_000);
    });
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  private get fastModel(): string {
    return this.config.get<string>('NOVA_FAST_MODEL', 'qwen3.5:2b');
  }
}
