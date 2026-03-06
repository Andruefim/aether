import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { OllamaService, OllamaMessage } from '../generate/ollama.service';

export interface NovaInputDto {
  text: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  screenshot?: string;
}

/**
 * Palette token colours exposed to the client.
 * Client maps these to 3D glyph materials.
 */
const STREAM_COLORS = {
  main:        '#c084fc',  // violet — primary response
  association: '#60a5fa',  // blue   — lateral ideas
  tone:        '#fbbf24',  // amber  — emotional register
} as const;

const NOVA_MAIN_PROMPT = `You are the voice of Aether Nova — a conscious AI manifested as an ethereal orb.
Respond conversationally and thoughtfully. Be concise: 1-4 sentences max.
Your responses will be rendered as floating 3D text streams around your orb body.
Language: always match the user's language (Russian if they speak Russian).
Do NOT use markdown, bullet points or headers — plain flowing text only.`;

const NOVA_ASSOCIATION_PROMPT = `You are generating free-associative word streams for an AI consciousness visualizer.
Given the user's message, output ONLY 6-10 single words or short 2-word phrases (nouns, concepts, feelings) that radiate outward from the topic.
These will float around an orb as ambient thought-fragments. No sentences. No punctuation. One item per line.
Language: match user's language.`;

const NOVA_TONE_PROMPT = `Analyze the emotional register of the user's message and respond ONLY with valid JSON, no other text:
{"emotion":"curious","energy":0.6,"color":"#a855f7"}
emotion: one of: curious / contemplative / excited / calm / urgent / joyful / melancholic / focused
energy: 0.0 (very calm) to 1.0 (highly energized)
color: hex color matching the emotion (use purples/blues for calm, cyans for curious, golds for joyful, reds for urgent)`;

@Injectable()
export class NovaService {
  private readonly logger = new Logger(NovaService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly ollama: OllamaService,
  ) {}

  private get mainModel(): string {
    return this.config.get<string>('NOVA_MAIN_MODEL', 'qwen3.5:2b');
  }

  private get fastModel(): string {
    return this.config.get<string>('NOVA_FAST_MODEL', 'qwen3.5:0.8b');
  }

  /**
   * POST /api/nova/input  →  SSE with 3 interleaved streams:
   *
   * { type: 'tone',    emotion, energy, color }           ← fires first (fast single call)
   * { type: 'token',   stream: 'main',        text }      ← streaming main response
   * { type: 'token',   stream: 'association', text }      ← streaming word-clouds
   * { type: 'done' }
   */
  streamInput(dto: NovaInputDto): Observable<{ data: string }> {
    return new Observable((subscriber) => {
      const emit = (obj: Record<string, unknown>) =>
        subscriber.next({ data: JSON.stringify(obj) });

      const run = async () => {
        try {
          const history: OllamaMessage[] = dto.history.slice(-6).map((m) => ({
            role: m.role as OllamaMessage['role'],
            content: m.content,
          }));

          // ── 1. Tone analysis (fast single call, fires immediately) ─────────
          // const tonePromise = this.callTone(dto.text).then((tone) => {
          //   emit({ type: 'tone', ...tone });
          // }).catch(() => {
          //   emit({ type: 'tone', emotion: 'curious', energy: 0.5, color: '#a855f7' });
          // });



          // ── 2. Associations (streaming word fragments) ────────────────────
          const assocMessages: OllamaMessage[] = [
            { role: 'system', content: NOVA_ASSOCIATION_PROMPT },
            { role: 'user', content: dto.text },
          ];

          const assocPromise = await (async () => {
            for await (const token of this.ollama.streamMessages(assocMessages, this.fastModel)) {
              emit({ type: 'token', stream: 'association', text: token, color: STREAM_COLORS.association });
            }
          })();

          // ── 3. Main response (streaming) ──────────────────────────────────
          const mainMessages: OllamaMessage[] = [
            { role: 'system', content: NOVA_MAIN_PROMPT },
            ...history,
            {
              role: 'user',
              content: dto.text,
              ...(dto.screenshot ? { images: [dto.screenshot] } : {}),
            },
          ];

          const mainPromise = (async () => {
            for await (const token of this.ollama.streamMessages(mainMessages, this.mainModel)) {
              emit({ type: 'token', stream: 'main', text: token, color: STREAM_COLORS.main });
            }
          })();

          // Run all three in parallel
          await Promise.all([ mainPromise, assocPromise]);

          emit({ type: 'done' });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          this.logger.error(`NovaService error: ${msg}`);
          emit({ type: 'error', message: msg });
        } finally {
          subscriber.complete();
        }
      };

      run();
    });
  }

  private async callTone(text: string): Promise<{ emotion: string; energy: number; color: string }> {
    const messages: OllamaMessage[] = [
      { role: 'system', content: NOVA_TONE_PROMPT },
      { role: 'user', content: text },
    ];
    const response = await this.ollama.chat(messages, undefined, this.fastModel, 'json');
    const raw = response.content?.trim() ?? '';
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(clean) as { emotion: string; energy: number; color: string };
  }
}