import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OllamaService, OllamaMessage } from '../../generate/ollama.service';
import { NovaMemoryService } from '../nova-memory.service';
import { ThoughtBusService } from '../thought-bus.service';
import { SummaryService } from '../summary.service';
import { ConsciousnessState, CONSOLIDATION_MS } from './types';
import { buildJudgePrompt, CONSOLIDATE_SYSTEM, parseJson } from './prompts';

@Injectable()
export class AgentMemoryService {
  private readonly logger = new Logger(AgentMemoryService.name);

  private static readonly KEEP_THRESHOLD = 0.25;

  constructor(
    private readonly config:   ConfigService,
    private readonly ollama:   OllamaService,
    private readonly memory:   NovaMemoryService,
    private readonly bus:      ThoughtBusService,
    private readonly summary:  SummaryService,
  ) {}

  private get fastModel() {
    return this.config.get<string>('NOVA_FAST_MODEL', 'qwen3.5:9b');
  }

  // ── LLM judge: evaluate a fact before storing ──────────────────────────────
  // Returns score 0–10. < 4 = not worth storing.

  async judgeValue(text: string, goalContext: string): Promise<{ score: number; reason: string }> {
    const msgs: OllamaMessage[] = [
      { role: 'system', content: buildJudgePrompt(goalContext) },
      { role: 'user',   content: `Research goal: ${goalContext}\n\nFact to evaluate: "${text}"` },
    ];
    try {
      const resp   = await this.ollama.chat(msgs, undefined, this.fastModel, 'json');
      const parsed = parseJson<{ score?: number; reason?: string }>(resp.content?.trim() ?? '{}', {});
      const score  = Math.min(10, Math.max(0, Number(parsed.score ?? 7)));
      return { score, reason: String(parsed.reason ?? '') };
    } catch {
      return { score: 7, reason: 'parse error — defaulting to keep' };
    }
  }

  // ── Sleep / consolidation cycle ────────────────────────────────────────────

  async consolidate(rawCount: number, state: ConsciousnessState): Promise<void> {
    this.bus.emit({
      phase: 'sleep',
      text:  `Entering consolidation — ${rawCount} raw memories to process...`,
      ts:    Date.now(),
    });

    // Step 1: prune fading memories (unused ≥7 days, never recalled)
    const fadingPoints = await this.memory.fetchFading();
    if (fadingPoints.length > 0) {
      await this.memory.deleteMany(fadingPoints.map((p) => p.id));
      this.bus.emit({
        phase: 'sleep',
        text:  `Pruned ${fadingPoints.length} fading memories (unused, low value)`,
        ts:    Date.now(),
      });
    }

    // Step 2: split raw into high-value (consolidate) and low-value (drop)
    const rawPoints    = await this.memory.fetchRaw(60);
    const toConsolidate = rawPoints.filter((p) => this.memory.keepScore(p) >= AgentMemoryService.KEEP_THRESHOLD);
    const toDrop        = rawPoints.filter((p) => this.memory.keepScore(p) <  AgentMemoryService.KEEP_THRESHOLD);

    if (toDrop.length > 0) {
      await this.memory.deleteMany(toDrop.map((p) => p.id));
      this.bus.emit({
        phase: 'sleep',
        text:  `Dropped ${toDrop.length} low-value memories (surprise too low, never recalled)`,
        ts:    Date.now(),
      });
    }

    // Step 3: consolidate high-value memories via LLM
    if (toConsolidate.length > 0) {
      for (const chunk of this.chunk(toConsolidate, 10)) {
        const content = chunk.map((p, i) => `${i + 1}. ${p.text}`).join('\n');
        const msgs: OllamaMessage[] = [
          { role: 'system', content: CONSOLIDATE_SYSTEM },
          { role: 'user',   content: content },
        ];

        let consolidated: string[] = [];
        try {
          const resp = await this.ollama.chat(msgs, undefined, this.fastModel, 'json');
          consolidated = parseJson<string[]>(resp.content?.trim() ?? '[]', []);
          if (!Array.isArray(consolidated)) consolidated = [];
        } catch {
          consolidated = chunk.map((p) => p.text);
        }

        await this.memory.deleteMany(chunk.map((p) => p.id));
        for (const raw of consolidated) {
          const text = typeof raw === 'string' ? raw : String(raw ?? '');
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

    state.energy    = Math.min(1, state.energy + 0.6);
    state.curiosity = Math.min(1, state.curiosity + 0.2);
    state.mood      = 'curious';

    this.summary.invalidate();
    this.bus.emit({ phase: 'wake', text: 'Consolidation complete. Energy restored. Ready to explore.', ts: Date.now() });
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }
}
