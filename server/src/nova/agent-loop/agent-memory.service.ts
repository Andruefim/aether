import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OllamaService, OllamaMessage } from '../../generate/ollama.service';
import { NovaMemoryService } from '../nova-memory.service';
import { ThoughtBusService } from '../thought-bus.service';
import { SummaryService } from '../summary.service';
import { NovaLoraService } from '../nova-lora.service';
import { NovaIdentityService } from '../nova-identity.service';
import { ConsciousnessState, CONSOLIDATION_MS } from './types';
import { CONSOLIDATE_SYSTEM, buildJudgePrompt, parseJson } from './prompts';

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
    private readonly lora:     NovaLoraService,
    private readonly identity: NovaIdentityService,
  ) {}

  private get fastModel() {
    return this.config.get<string>('NOVA_FAST_MODEL', 'qwen3.5:9b');
  }

  // ── LLM judge ─────────────────────────────────────────────────────────────

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

  async consolidate(rawCount: number, state: ConsciousnessState, goalContext = ''): Promise<void> {
    this.bus.emit({
      phase: 'sleep',
      text:  `Entering consolidation — ${rawCount} raw memories to process...`,
      ts:    Date.now(),
    });

    // Step 1: prune fading memories
    const fadingPoints = await this.memory.fetchFading();
    if (fadingPoints.length > 0) {
      await this.memory.deleteMany(fadingPoints.map((p) => p.id));
      this.bus.emit({
        phase: 'sleep',
        text:  `Pruned ${fadingPoints.length} fading memories`,
        ts:    Date.now(),
      });
    }

    // Step 2: split raw into high-value (consolidate) and low-value (drop)
    const rawPoints     = await this.memory.fetchRaw(60);
    const toConsolidate = rawPoints.filter((p) => this.memory.keepScore(p) >= AgentMemoryService.KEEP_THRESHOLD);
    const toDrop        = rawPoints.filter((p) => this.memory.keepScore(p) <  AgentMemoryService.KEEP_THRESHOLD);

    if (toDrop.length > 0) {
      await this.memory.deleteMany(toDrop.map((p) => p.id));
      this.bus.emit({
        phase: 'sleep',
        text:  `Dropped ${toDrop.length} low-value memories`,
        ts:    Date.now(),
      });
    }

    // Step 3: consolidate high-value memories via LLM
    const allConsolidated: string[] = [];

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
          if (text.trim().length > 10) {
            await this.memory.store(text, 'main', 'consolidated');
            allConsolidated.push(text);
          }
        }

        this.bus.emit({
          phase: 'sleep',
          text:  `Consolidated ${chunk.length} → ${consolidated.length} memories`,
          ts:    Date.now(),
        });
      }

      // Update Nova's beliefs from consolidated memories
      if (allConsolidated.length > 0) {
        this.identity.updateBeliefs(allConsolidated.slice(0, 4));
      }
    }

    await new Promise<void>((r) => setTimeout(r, CONSOLIDATION_MS));

    state.energy    = Math.min(1, state.energy + 0.6);
    state.curiosity = Math.min(1, state.curiosity + 0.2);
    state.mood      = 'curious';

    this.summary.invalidate();
    this.bus.emit({ phase: 'wake', text: 'Consolidation complete. Energy restored. Ready to explore.', ts: Date.now() });

    // ── Trigger LoRA training from consolidated memories ─────────────────────
    if (allConsolidated.length > 0) {
      void this.lora.onConsolidation(allConsolidated, goalContext).catch((err) => {
        this.logger.warn(`[LoRA] onConsolidation error: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }
}