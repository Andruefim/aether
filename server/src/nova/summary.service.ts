import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OllamaService, OllamaMessage } from '../generate/ollama.service';
import { NovaMemoryService } from './nova-memory.service';
import { GoalService } from './goal.service';

const CACHE_TTL_MS = 5 * 60 * 1000;

const SUMMARY_SYSTEM = `You are Nova's research analyst.
Given a list of research findings related to a specific goal, produce a focused summary.
Reply ONLY with a JSON object (no markdown):
{
  "title": "<short descriptive title>",
  "bullets": ["<key finding 1>", "<key finding 2>", ...],
  "insight": "<one sentence — the most important synthesis, open question, or breakthrough>",
  "progress": <0-100>
}
Maximum 4 bullets. Each bullet max 120 chars. Be scientific and precise.
progress: estimate how much of this research goal has been addressed (0=just started, 100=exhaustively covered).`;

export interface GoalSummary {
  goalId: string;
  goalText: string;
  title: string;
  bullets: string[];
  insight: string;
  progress: number;      // 0–100 estimated coverage
  memoryCount: number;
  avgSurprise: number;   // mean surprise score of recalled memories (novelty indicator)
  generatedAt: number;
}

@Injectable()
export class SummaryService {
  private readonly logger = new Logger(SummaryService.name);

  // Per-goal cache: goalId → { summary, ts }
  private readonly goalCache = new Map<string, { summary: GoalSummary; ts: number }>();

  // Global mutex: if a generation is already running, new callers wait for it
  // instead of firing duplicate LLM requests.
  private inflightAll: Promise<GoalSummary[]> | null = null;

  constructor(
    private readonly config:  ConfigService,
    private readonly ollama:  OllamaService,
    private readonly memory:  NovaMemoryService,
    private readonly goals:   GoalService,
  ) {}

  /** Invalidate all caches (called after wake from sleep) */
  invalidate() {
    this.goalCache.clear();
  }

  /** Get summaries for all active goals — serialized + deduplicated */
  async getAllGoalSummaries(forceRefresh = false): Promise<GoalSummary[]> {
    // If another caller is already generating, share the same promise
    if (this.inflightAll && !forceRefresh) {
      this.logger.debug('Summary: reusing in-flight request');
      return this.inflightAll;
    }

    this.inflightAll = this.generateAllSerially(forceRefresh).finally(() => {
      this.inflightAll = null;
    });

    return this.inflightAll;
  }

  private async generateAllSerially(forceRefresh: boolean): Promise<GoalSummary[]> {
    const activeGoals = await this.goals.findActive();
    if (activeGoals.length === 0) return [];

    const results: GoalSummary[] = [];
    // Run one goal at a time to avoid concurrent Ollama requests
    for (const g of activeGoals) {
      const s = await this.getGoalSummary(g.id, g.text, forceRefresh);
      if (s) results.push(s);
    }
    return results;
  }

  /** Get summary for a single goal using semantic recall */
  async getGoalSummary(goalId: string, goalText: string, forceRefresh = false): Promise<GoalSummary | null> {
    const now = Date.now();
    const cached = this.goalCache.get(goalId);
    if (!forceRefresh && cached && now - cached.ts < CACHE_TTL_MS) {
      return cached.summary;
    }

    // Recall memories semantically relevant to this goal
    const recalled = await this.memory.recallWithMeta(goalText, 30);

    if (recalled.length === 0) {
      return {
        goalId,
        goalText,
        title:       'No findings yet',
        bullets:     [],
        insight:     'Nova has not gathered data on this goal yet.',
        progress:    0,
        memoryCount: 0,
        avgSurprise: 0,
        generatedAt: now,
      };
    }

    const avgSurprise = recalled.reduce((s, p) => s + p.surprise, 0) / recalled.length;
    const content = recalled
      .slice(0, 25)
      .map((p, i) => `${i + 1}. ${p.text}`)
      .join('\n');

    const messages: OllamaMessage[] = [
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user',   content: `Research goal: "${goalText}"\n\nFindings:\n${content}` },
    ];

    try {
      const model = this.config.get<string>('NOVA_FAST_MODEL', 'qwen3.5:9b');
      const resp  = await this.ollama.chat(messages, undefined, model, 'json');
      const raw   = resp.content?.trim() ?? '{}';
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(clean) as {
        title?: string; bullets?: string[]; insight?: string; progress?: number;
      };

      const summary: GoalSummary = {
        goalId,
        goalText,
        title:       parsed.title   ?? goalText.slice(0, 50),
        bullets:     Array.isArray(parsed.bullets) ? parsed.bullets.slice(0, 4) : [],
        insight:     parsed.insight ?? '',
        progress:    Math.min(100, Math.max(0, Number(parsed.progress ?? 0))),
        memoryCount: recalled.length,
        avgSurprise: Math.round(avgSurprise * 100) / 100,
        generatedAt: now,
      };

      this.goalCache.set(goalId, { summary, ts: now });
      return summary;
    } catch (err) {
      this.logger.warn(`Goal summary failed for "${goalText}": ${err instanceof Error ? err.message : String(err)}`);
      return cached?.summary ?? null;
    }
  }
}
