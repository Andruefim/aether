import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OllamaService, OllamaMessage } from '../generate/ollama.service';
import { NovaMemoryService } from './nova-memory.service';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const SUMMARY_SYSTEM = `You are Nova's internal summarizer.
Given a list of research findings, produce a concise research summary.
Reply with a JSON object (no markdown):
{
  "title": "<short title for this research session>",
  "bullets": ["<key finding 1>", "<key finding 2>", ...],
  "insight": "<one sentence — the most important synthesis or open question>"
}
Maximum 5 bullets. Each bullet max 100 chars. Be scientific and precise.`;

export interface ResearchSummary {
  title: string;
  bullets: string[];
  insight: string;
  generatedAt: number;
  memoryCount: number;
}

@Injectable()
export class SummaryService {
  private readonly logger = new Logger(SummaryService.name);
  private cache: ResearchSummary | null = null;
  private cacheTs = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly ollama: OllamaService,
    private readonly memory: NovaMemoryService,
  ) {}

  /** Force cache invalidation — called after wake from sleep */
  invalidate() {
    this.cacheTs = 0;
  }

  async getSummary(forceRefresh = false): Promise<ResearchSummary | null> {
    const now = Date.now();
    if (!forceRefresh && this.cache && now - this.cacheTs < CACHE_TTL_MS) {
      return this.cache;
    }

    // Fetch recent consolidated + main memories
    let points: Array<{ text: string }> = [];
    try {
      const projected = await this.memory.project(60);
      points = projected.map((p) => ({ text: p.text })).filter((p) => p.text.length > 10);
    } catch {
      return this.cache;
    }

    if (points.length === 0) return null;

    const content = points
      .slice(0, 40)
      .map((p, i) => `${i + 1}. ${p.text}`)
      .join('\n');

    const messages: OllamaMessage[] = [
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content: `Research findings:\n${content}` },
    ];

    try {
      const model = this.config.get<string>('NOVA_FAST_MODEL', 'qwen3.5:2b');
      const resp = await this.ollama.chat(messages, undefined, model, 'json');
      const raw = resp.content?.trim() ?? '{}';
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(clean) as { title?: string; bullets?: string[]; insight?: string };

      this.cache = {
        title:       parsed.title   ?? 'Research Progress',
        bullets:     Array.isArray(parsed.bullets) ? parsed.bullets.slice(0, 5) : [],
        insight:     parsed.insight ?? '',
        generatedAt: now,
        memoryCount: points.length,
      };
      this.cacheTs = now;
      return this.cache;
    } catch (err) {
      this.logger.warn(`Summary generation failed: ${err instanceof Error ? err.message : String(err)}`);
      return this.cache;
    }
  }
}
