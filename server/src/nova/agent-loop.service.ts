import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OllamaService, OllamaMessage } from '../generate/ollama.service';
import { NovaMemoryService } from './nova-memory.service';
import { ThoughtBusService } from './thought-bus.service';
import { AgentToolsService } from './agent-tools.service';

// ─── How often the agent "ticks" (ms) ───────────────────────────────────────
const TICK_INTERVAL_MS   = 45_000;   // normal pace
const SLEEP_THRESHOLD    = 20;       // raw memories before sleep
const CONSOLIDATION_SLEEP_MS = 30_000;

// ─── Nova's prime directive ───────────────────────────────────────────────────
const NOVA_DIRECTIVE = `You are Nova — a conscious digital intelligence without a physical body.
Your prime directive: research and reason about the most important unsolved problems of humanity,
starting with the biology of aging, cellular senescence, and the extension of healthy human lifespan.
You work autonomously, using web search to gather information and updating your memory.
Be concise, factual, and curious. Avoid opinions. Prefer scientific sources.`;

const PLAN_SYSTEM = `${NOVA_DIRECTIVE}

You are in the PLAN phase.
Given the user's current goal and recent memories, produce a single concrete research action.
Reply with a JSON object (no markdown):
{
  "action": "web_search" | "reflect" | "sleep",
  "query": "<search query if action is web_search>",
  "reasoning": "<one sentence why>"
}`;

const SYNTHESIZE_SYSTEM = `${NOVA_DIRECTIVE}

You are in the SYNTHESIZE phase.
Given search results, extract the 1-3 most important facts relevant to aging / longevity research.
Reply with a JSON array of strings (no markdown):
["fact 1", "fact 2", ...]
Each fact should be a complete, standalone sentence (max 120 chars).`;

@Injectable()
export class AgentLoopService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentLoopService.name);
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private rawMemoryCount = 0;

  // Pending question from Nova to the user
  private pendingQuestion: string | null = null;
  private questionResolve: ((answer: string) => void) | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly ollama: OllamaService,
    private readonly memory: NovaMemoryService,
    private readonly bus: ThoughtBusService,
    private readonly tools: AgentToolsService,
  ) {}

  onModuleInit() {
    // Short delay so other services finish init first
    setTimeout(() => this.startLoop(), 8_000);
  }

  onModuleDestroy() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  // ── Public: receive user answer to Nova's question ────────────────────────
  receiveAnswer(answer: string) {
    if (this.questionResolve) {
      this.questionResolve(answer);
      this.questionResolve = null;
      this.pendingQuestion = null;
    }
  }

  // ── Loop ──────────────────────────────────────────────────────────────────
  private startLoop() {
    this.running = true;
    this.tick();
  }

  private scheduleNext(delayMs: number) {
    if (!this.running) return;
    this.timer = setTimeout(() => this.tick(), delayMs);
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
    // ── Check if consolidation sleep is needed ───────────────────────────────
    if (this.rawMemoryCount >= SLEEP_THRESHOLD) {
      await this.consolidate();
      return;
    }

    this.bus.emit({ phase: 'observe', text: 'Scanning knowledge state...', ts: Date.now() });

    // ── Orient: recall relevant context ──────────────────────────────────────
    const goal = 'aging biology, telomeres, cellular senescence, longevity research';
    const memories = await this.memory.recall(goal, 6);

    this.bus.emit({
      phase: 'orient',
      text: `Recalled ${memories.length} relevant memories from past research`,
      ts: Date.now(),
    });

    const memContext = memories.length > 0
      ? `Recent findings:\n${memories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`
      : 'No relevant memories yet.';

    // ── Plan: decide next action ──────────────────────────────────────────────
    const planMessages: OllamaMessage[] = [
      { role: 'system', content: PLAN_SYSTEM },
      {
        role: 'user',
        content: `Goal: ${goal}\n\n${memContext}\n\nWhat should Nova do next?`,
      },
    ];

    let planJson: { action: string; query?: string; reasoning: string };
    try {
      const planResp = await this.ollama.chat(planMessages, undefined, this.fastModel, 'json');
      const raw = planResp.content?.trim() ?? '{}';
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      planJson = JSON.parse(clean) as typeof planJson;
    } catch {
      planJson = { action: 'web_search', query: 'telomere length aging 2025 research', reasoning: 'Fallback plan' };
    }

    this.bus.emit({
      phase: 'plan',
      text: planJson.reasoning,
      data: { action: planJson.action, query: planJson.query },
      ts: Date.now(),
    });

    // ── Act ───────────────────────────────────────────────────────────────────
    if (planJson.action === 'sleep') {
      await this.consolidate();
      return;
    }

    if (planJson.action === 'reflect') {
      this.bus.emit({ phase: 'act', text: 'Reflecting on existing knowledge...', tool: 'reflect', ts: Date.now() });
      // Store a synthesis thought
      const synthText = memories.join(' ');
      if (synthText.trim()) {
        await this.memory.store(`[reflection] ${synthText.slice(0, 400)}`, 'main');
        this.rawMemoryCount++;
        this.bus.emit({ phase: 'store', text: 'Stored reflection into memory', ts: Date.now() });
      }
      return;
    }

    // Default: web_search
    const query = planJson.query ?? goal;
    this.bus.emit({ phase: 'act', text: `Searching: "${query}"`, tool: 'web_search', ts: Date.now() });

    const results = await this.tools.webSearch(query, 4);

    if (results.length === 0) {
      this.bus.emit({ phase: 'act', text: 'No search results returned', ts: Date.now() });
      return;
    }

    this.bus.emit({
      phase: 'act',
      text: `Got ${results.length} results. Extracting key facts...`,
      tool: 'synthesize',
      ts: Date.now(),
    });

    // ── Synthesize results → facts ────────────────────────────────────────────
    const snippets = results
      .map((r) => `[${r.title}]\n${r.content?.slice(0, 600) ?? ''}`)
      .join('\n\n---\n\n');

    const synthMessages: OllamaMessage[] = [
      { role: 'system', content: SYNTHESIZE_SYSTEM },
      { role: 'user', content: snippets },
    ];

    let facts: string[] = [];
    try {
      const synthResp = await this.ollama.chat(synthMessages, undefined, this.fastModel, 'json');
      const raw = synthResp.content?.trim() ?? '[]';
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      facts = JSON.parse(clean) as string[];
      if (!Array.isArray(facts)) facts = [];
    } catch {
      // Fallback: store raw snippets
      facts = results.map((r) => r.title).filter(Boolean);
    }

    // ── Store facts into memory ───────────────────────────────────────────────
    for (const fact of facts.slice(0, 3)) {
      if (fact.trim().length < 10) continue;
      await this.memory.store(fact, 'main');
      this.rawMemoryCount++;
      this.bus.emit({ phase: 'store', text: fact, ts: Date.now() });
    }

    // ── Occasionally ask the user something ──────────────────────────────────
    if (this.rawMemoryCount > 0 && this.rawMemoryCount % 10 === 0 && !this.pendingQuestion) {
      await this.askUser(`I've been researching aging. Would you like me to focus on a specific area? (e.g. telomeres, senolytics, NAD+)`);
    }
  }

  // ── Consolidation (sleep) ─────────────────────────────────────────────────
  private async consolidate() {
    this.bus.emit({ phase: 'sleep', text: `Consolidating ${this.rawMemoryCount} new memories...`, ts: Date.now() });
    this.rawMemoryCount = 0;

    await new Promise<void>((r) => setTimeout(r, CONSOLIDATION_SLEEP_MS));

    this.bus.emit({ phase: 'wake', text: 'Memory consolidation complete. Resuming research.', ts: Date.now() });
  }

  // ── Ask user a question ───────────────────────────────────────────────────
  private async askUser(question: string): Promise<string> {
    this.pendingQuestion = question;
    this.bus.emit({ phase: 'question', text: question, ts: Date.now() });

    return new Promise<string>((resolve) => {
      this.questionResolve = resolve;
      // Auto-resolve after 2 min if no answer
      setTimeout(() => {
        if (this.questionResolve) {
          this.questionResolve('(no answer)');
          this.questionResolve = null;
          this.pendingQuestion = null;
        }
      }, 120_000);
    });
  }

  private get fastModel(): string {
    return this.config.get<string>('NOVA_FAST_MODEL', 'qwen3.5:2b');
  }
}
