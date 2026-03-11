import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { OllamaService, OllamaMessage } from '../generate/ollama.service';
import { NovaMemoryService } from './nova-memory.service';
import { NovaIdentityService } from './nova-identity.service';
import { GoalService } from './goal.service';
import { CognitiveCoreService } from './cognitive-core.service';

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
    private readonly memory: NovaMemoryService,
    private readonly identity: NovaIdentityService,
    private readonly goals: GoalService,
    private readonly cognitiveCore: CognitiveCoreService,
  ) {}

  private get mainModel(): string {
    return this.config.get<string>('NOVA_MAIN_MODEL', 'qwen3.5:9b');
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
          // const tonePromise = await this.callTone(dto.text).then((tone) => {
          //   emit({ type: 'tone', ...tone });
          // }).catch(() => {
          //   emit({ type: 'tone', emotion: 'curious', energy: 0.5, color: '#a855f7' });
          // });



          // ── 0. Recall relevant memories ───────────────────────────────────
          const memories = await this.memory.recall(dto.text, 5);
          await this.memory.store(`[USER MESSAGE] ${dto.text}`, 'main', 'raw', 0.9).catch(() => {});

          const memoryContext = memories.length > 0
            ? `\n\nRelevant memories from past conversations:\n${memories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`
            : '';

          // ── 2. Associations (streaming word fragments) ────────────────────
          // const assocMessages: OllamaMessage[] = [
          //   { role: 'system', content: NOVA_ASSOCIATION_PROMPT },
          //   { role: 'user', content: dto.text },
          // ];

          // const assocPromise = await (async () => {
          //   for await (const token of this.ollama.streamMessages(assocMessages, this.fastModel)) {
          //     emit({ type: 'token', stream: 'association', text: token, color: STREAM_COLORS.association });
          //   }
          // })();

          // ── 3. Main response (streaming) ──────────────────────────────────
          const identityContext = this.identity.getSystemPrompt();
          const toolsContext = `
YOUR CAPABILITIES (same as your autonomous agent loop):
- Nova Lab: run Python experiments (e.g. fetch YouTube transcripts, call APIs, analyze data)
- Persistent memory (Qdrant), web search, reflect, hypothesize, propose goals
- When user asks to run an experiment, tell them you'll queue it — don't write code manually.

RESPONSE LENGTH: Keep your reply to at most 100 words. Your answer is shown as floating 3D text — short, clear replies work best. Prefer 1–4 sentences.`;

          // Full Cognitive Core context so dialogue Nova sees goals, theory, directive
          const activeGoals = await this.goals.findActive();
          const coreState = this.cognitiveCore.getState();
          const goalsList = activeGoals.length > 0
            ? activeGoals.map((g) => `- ${g.text}`).join('\n')
            : '- (no active goals yet)';
          const theoryBlock = coreState.theory
            ? `Current theory (${(coreState.theory.confidence * 100).toFixed(0)}%): "${coreState.theory.claim}"\nNext experiment to try: ${coreState.theory.nextExperiment || '—'}`
            : 'Current theory: (not yet formed)';
          const directiveBlock = coreState.directive
            ? `Directive: "${coreState.directive.attentionFocus}"${coreState.directive.suggestedAction ? ` | Suggested action: ${coreState.directive.suggestedAction}` : ''}`
            : '';
          const cognitiveContext = `

COGNITIVE CORE CONTEXT (you have full access — use it when the user asks about goals, what you're working on, or your current focus):
Research goals:
${goalsList}

${theoryBlock}
${directiveBlock ? directiveBlock + '\n' : ''}
When the user asks "do you see the goals?" or "what are you working on?", answer using the above.`;

          const mainMessages: OllamaMessage[] = [
            { role: 'system', content: identityContext + toolsContext + cognitiveContext + memoryContext },
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
          await Promise.all([ mainPromise]);

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