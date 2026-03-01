import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { OllamaService, OllamaMessage } from '../generate/ollama.service';
import { WebSearchService } from '../web-search/web-search.service';
import {
  ORCHESTRATOR_MODEL,
  CODER_MODEL,
  VOICE_SERVICE_URL,
  ORCHESTRATOR_SYSTEM_PROMPT,
  CODER_SYSTEM_PROMPT,
  VOICE_AGENT_SYSTEM_PROMPT,
} from './aether.constants';

export interface AetherInputDto {
  text: string;
  screenshot?: string;
  currentHtml: string;
  history: { role: 'user' | 'assistant'; content: string }[];
}

interface OrchestratorResult {
  action: 'generate_ui' | 'dialogue' | 'tool';
  instruction: string;
  response?: string;
}

interface VoiceAgentResult {
  action: 'speak' | 'generate_ui';
  text: string;
  instruction?: string;
}

const MAX_HTML_CHARS = 24_000;
const MAX_TOOL_CONTEXT_CHARS = 10_000;

/**
 * Keywords that ALWAYS require generate_ui — regardless of what the model said.
 * Small models often classify these as "speak" even though the UI must change.
 */
const UI_MUTATION_PATTERNS = [
  // Russian — removal
  /удал[иьите]/i, /убер[иьи]/i, /сотр[иь]/i, /очист[иь]/i, /закр[ойы]/i, /спрят[ьа]/i,
  // Russian — addition/creation
  /добав[ьи]/i, /создай/i, /открой/i, /покаж[иь]/i, /выведи/i, /нарисуй/i,
  // Russian — modification
  /измен[иь]/i, /сдел[ай]/i, /поменяй/i, /перекрас[ьь]/i, /обнов[иь]/i,
  // English — removal
  /\b(remove|delete|close|hide|clear|dismiss|get rid of)\b/i,
  // English — addition/creation
  /\b(add|create|open|show|display|draw|build|make|put)\b/i,
  // English — modification
  /\b(change|update|modify|resize|move|rename|replace|edit)\b/i,
];

/**
 * If the model chose "speak" but user text contains UI-mutation keywords,
 * force generate_ui with a derived instruction.
 */
function forceUiActionIfNeeded(
  result: VoiceAgentResult,
  userText: string,
  hasExistingUi: boolean,
): VoiceAgentResult {
  if (result.action === 'generate_ui') return result; // already correct

  const needsUi = UI_MUTATION_PATTERNS.some((p) => p.test(userText));
  if (!needsUi) return result;

  // Build instruction: prefer what the model said (stripped), fall back to raw user text
  const baseInstruction = result.instruction?.trim() || userText;
  const instruction = hasExistingUi
    ? `${baseInstruction}. Keep everything else in the interface unchanged. Use glass style.`
    : `${baseInstruction}. Use glass panels with rgba(255,255,255,0.08) background and white text.`;

  return {
    action: 'generate_ui',
    text: result.text, // keep original spoken confirmation
    instruction,
  };
}

@Injectable()
export class AetherService {
  private readonly logger = new Logger(AetherService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly ollama: OllamaService,
    private readonly webSearch: WebSearchService,
  ) {}

  private get orchestratorModel(): string {
    return this.config.get<string>('AETHER_ORCHESTRATOR_MODEL', ORCHESTRATOR_MODEL);
  }

  private get coderModel(): string {
    return this.config.get<string>('AETHER_CODER_MODEL', CODER_MODEL);
  }

  private get useOrchestrator(): boolean {
    const val = this.config.get<string>('USE_ORCHESTRATOR', 'false');
    return val.toLowerCase() === 'true';
  }

  // ── Text input SSE ──────────────────────────────────────────────────────────

  streamInput(dto: AetherInputDto): Observable<{ data: string }> {
    return new Observable((subscriber) => {
      const emit = (obj: Record<string, unknown>) =>
        subscriber.next({ data: JSON.stringify(obj) });

      const run = async () => {
        try {
          if (this.useOrchestrator) {
            await this.runWithOrchestrator(dto, emit);
          } else {
            await this.runDirect(dto, emit);
          }
          emit({ type: 'done' });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          this.logger.error(`AetherService error: ${msg}`, err instanceof Error ? err.stack : '');
          emit({ type: 'error', message: msg });
        } finally {
          subscriber.complete();
        }
      };

      run();
    });
  }

  // ── Voice agent SSE ─────────────────────────────────────────────────────────

  streamVoiceChat(dto: AetherInputDto): Observable<{ data: string }> {
    return new Observable((subscriber) => {
      const emit = (obj: Record<string, unknown>) =>
        subscriber.next({ data: JSON.stringify(obj) });

      const run = async () => {
        try {
          let result = await this.callVoiceAgent(dto);

          // ── Heuristic override ────────────────────────────────────────────
          // Small models (gemma3:4b, etc.) often return "speak" even when
          // the user wants to mutate the UI. Force generate_ui when keywords match.
          const hasExistingUi = dto.currentHtml.length > 500;
          const before = result.action;
          result = forceUiActionIfNeeded(result, dto.text, hasExistingUi);
          if (result.action !== before) {
            this.logger.log(`[VoiceAgent] Overrode action: speak → generate_ui (keyword match in "${dto.text}")`);
          }

          this.logger.log(`[VoiceAgent] action=${result.action} text="${result.text}" instruction="${result.instruction ?? ''}"`);

          // Always emit spoken text first
          emit({ type: 'speak', text: result.text });

          if (result.action === 'generate_ui' && result.instruction) {
            const instruction = this.sanitizeVoiceInstruction(result.instruction);
            emit({ type: 'route', action: 'generate_ui', instruction });
            await this.streamUiGeneration(dto.currentHtml, instruction, emit);
          }

          emit({ type: 'done' });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          this.logger.error(`VoiceAgent error: ${msg}`, err instanceof Error ? err.stack : '');
          emit({ type: 'speak', text: 'Sorry, something went wrong.' });
          emit({ type: 'error', message: msg });
        } finally {
          subscriber.complete();
        }
      };

      run();
    });
  }

  // ── Transcribe + TTS ────────────────────────────────────────────────────────

  async transcribe(audioBuffer: Buffer, mimeType: string): Promise<{ text: string; language: string }> {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
    form.append('audio', blob, 'recording.webm');
    const res = await fetch(`${VOICE_SERVICE_URL}/transcribe`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Transcribe failed: ${res.statusText}`);
    return res.json() as Promise<{ text: string; language: string }>;
  }

  async speak(text: string): Promise<ReadableStream<Uint8Array> | null> {
    const res = await fetch(`${VOICE_SERVICE_URL}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`TTS voice service error: ${res.status} ${body}`);
      throw new Error(`TTS failed: ${res.statusText} — ${body}`);
    }
    return res.body;
  }

  // ── Execution paths ─────────────────────────────────────────────────────────

  private async runDirect(
    dto: AetherInputDto,
    emit: (obj: Record<string, unknown>) => void,
  ): Promise<void> {
    this.logger.log(`[Direct] model=${this.coderModel} text="${dto.text}"`);
    emit({ type: 'route', action: 'generate_ui', instruction: dto.text });

    const userMessage: OllamaMessage = {
      role: 'user',
      content: `<CURRENT_HTML>\n${this.truncateHtml(dto.currentHtml)}\n</CURRENT_HTML>\n\nINSTRUCTION: ${dto.text}`,
      ...(dto.screenshot ? { images: [dto.screenshot] } : {}),
    };

    const messages: OllamaMessage[] = [
      { role: 'system', content: CODER_SYSTEM_PROMPT },
      ...dto.history.slice(-4).map((m) => ({ role: m.role as OllamaMessage['role'], content: m.content })),
      userMessage,
    ];

    for await (const token of this.ollama.streamMessages(messages, this.coderModel)) {
      emit({ type: 'token', text: token });
    }
  }

  private async runWithOrchestrator(
    dto: AetherInputDto,
    emit: (obj: Record<string, unknown>) => void,
  ): Promise<void> {
    const result = await this.callOrchestrator(dto);
    this.logger.log(`[Orchestrator] action=${result.action} instruction=${result.instruction}`);
    emit({ type: 'route', action: result.action, instruction: result.instruction });

    if (result.action === 'dialogue') {
      emit({ type: 'dialogue', text: result.response ?? result.instruction });
    } else if (result.action === 'tool') {
      const toolContext = await this.executeToolsForAether(result.instruction, dto.currentHtml, emit);
      const truncatedData = toolContext.length > MAX_TOOL_CONTEXT_CHARS
        ? toolContext.slice(0, MAX_TOOL_CONTEXT_CHARS) + '\n\n[Data truncated.]'
        : toolContext;
      const toolInstruction = `TASK: Output ONLY a complete HTML document starting with <!DOCTYPE html>. Build a glass-style widget that DISPLAYS the data below.\n\nUSER REQUEST: ${result.instruction}\n\nAvailable data from tools:\n${truncatedData}\n\nREMINDER: Single HTML document only. First character: <.`;
      await this.streamUiGeneration(dto.currentHtml, toolInstruction, emit);
    } else {
      await this.streamUiGeneration(dto.currentHtml, result.instruction, emit);
    }
  }

  // ── LLM calls ───────────────────────────────────────────────────────────────

  private async callVoiceAgent(dto: AetherInputDto): Promise<VoiceAgentResult> {
    const userMessage: OllamaMessage = {
      role: 'user',
      content: `<CURRENT_HTML>\n${this.truncateHtml(dto.currentHtml)}\n</CURRENT_HTML>\n\nUser said: "${dto.text}"`,
      ...(dto.screenshot ? { images: [dto.screenshot] } : {}),
    };

    const messages: OllamaMessage[] = [
      { role: 'system', content: VOICE_AGENT_SYSTEM_PROMPT },
      ...dto.history.slice(-6).map((m) => ({ role: m.role as OllamaMessage['role'], content: m.content })),
      userMessage,
    ];

    const response = await this.ollama.chat(messages, undefined, this.orchestratorModel, 'json');
    const content = response.content?.trim() ?? '';

    try {
      const clean = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(clean) as VoiceAgentResult;
      if (!parsed.action || !parsed.text) throw new Error('Missing action or text');
      return parsed;
    } catch {
      this.logger.warn('[VoiceAgent] Could not parse JSON:', content.slice(0, 100));
      const text = content.replace(/[{}"]/g, '').replace(/action:|text:|instruction:/g, '').trim().slice(0, 200);
      return { action: 'speak', text: text || 'Готов помочь.' };
    }
  }

  private async callOrchestrator(dto: AetherInputDto): Promise<OrchestratorResult> {
    const userMessage: OllamaMessage = {
      role: 'user',
      content: dto.text,
      ...(dto.screenshot ? { images: [dto.screenshot] } : {}),
    };

    const messages: OllamaMessage[] = [
      { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
      ...dto.history.slice(-4).map((m) => ({ role: m.role as OllamaMessage['role'], content: m.content })),
      userMessage,
    ];

    const response = await this.ollama.chat(messages, undefined, this.orchestratorModel, 'json');
    const content = response.content?.trim() ?? '';

    try {
      const clean = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(clean) as OrchestratorResult;
      if (!parsed.action || !parsed.instruction) throw new Error('Invalid orchestrator response');
      return parsed;
    } catch {
      this.logger.warn('Orchestrator non-JSON:', content.slice(0, 100));
      return { action: 'dialogue', instruction: content, response: content };
    }
  }

  // ── UI generation ────────────────────────────────────────────────────────────

  private async streamUiGeneration(
    currentHtml: string,
    instruction: string,
    emit: (obj: Record<string, unknown>) => void,
  ): Promise<void> {
    const formatReminder = instruction.includes('Available data from tools') || instruction.includes('TASK: Output ONLY')
      ? 'Reply with ONLY the HTML document. First character must be <.\n\n'
      : '';
    const userContent = `${formatReminder}<CURRENT_HTML>\n${this.truncateHtml(currentHtml)}\n</CURRENT_HTML>\n\nINSTRUCTION: ${instruction}`;

    const messages: OllamaMessage[] = [
      { role: 'system', content: CODER_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ];

    for await (const token of this.ollama.streamMessages(messages, this.coderModel)) {
      emit({ type: 'token', text: token });
    }
  }

  private async executeToolsForAether(
    instruction: string,
    _currentHtml: string,
    emit: (obj: Record<string, unknown>) => void,
  ): Promise<string> {
    const results: string[] = [];
    try {
      let query = instruction;
      const match = instruction.match(/search\s+query:\s*([^|]+)/i);
      if (match) query = match[1].trim();
      else query = instruction
        .replace(/^(search|find|get|show|what is|how is)\s+/i, '')
        .replace(/\s*\|\s*display as:.*$/i, '')
        .trim();

      emit({ type: 'tool_call', name: 'web_search', args: { query } });
      const searchResults = await this.webSearch.search(query, 3);
      const summary = searchResults.slice(0, 3).map((r) => `${r.title}: ${r.content}`).join('\n\n');
      results.push(summary);
      emit({ type: 'tool_result', name: 'web_search', result: summary.slice(0, 500) });
    } catch (err) {
      this.logger.warn('Tool execution failed', err);
    }
    return results.join('\n\n');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private truncateHtml(html: string): string {
    return html.length > MAX_HTML_CHARS
      ? html.slice(0, MAX_HTML_CHARS) + '\n<!-- truncated -->'
      : html;
  }

  private sanitizeVoiceInstruction(instruction: string): string {
    let s = instruction.trim();
    s = s.replace(/<start_of_turn>\s*(?:user|model)\s*>\s*/gi, '').replace(/<\/?start_of_turn>/gi, '').trim();
    if (/<\s*!?\s*DOCTYPE\s+html/i.test(s) || /<\s*html[\s>]/i.test(s)) {
      this.logger.warn('[VoiceAgent] Instruction looked like HTML, using fallback');
      return 'Update the interface as requested by the user. Use glass style: rgba(255,255,255,0.08) panels, white text.';
    }
    return s.slice(0, 500);
  }
}