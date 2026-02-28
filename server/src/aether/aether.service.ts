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
          const result = await this.callVoiceAgent(dto);
          this.logger.log(`[VoiceAgent] action=${result.action} text="${result.text}"`);

          // Emit spoken text first — client starts TTS immediately
          emit({ type: 'speak', text: result.text });

          if (result.action === 'generate_ui' && result.instruction) {
            emit({ type: 'route', action: 'generate_ui', instruction: result.instruction });
            await this.streamUiGeneration(dto.currentHtml, result.instruction, emit);
          }

          emit({ type: 'done' });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          this.logger.error(`VoiceAgent error: ${msg}`);
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

    const res = await fetch(`${VOICE_SERVICE_URL}/transcribe`, {
      method: 'POST',
      body: form,
    });
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
    this.logger.log(`[Direct] model=${this.coderModel} text="${dto.text}" screenshot=${!!dto.screenshot}`);
    emit({ type: 'route', action: 'generate_ui', instruction: dto.text });

    const truncatedHtml = this.truncateHtml(dto.currentHtml);
    const userMessage: OllamaMessage = {
      role: 'user',
      content: `<CURRENT_HTML>\n${truncatedHtml}\n</CURRENT_HTML>\n\nINSTRUCTION: ${dto.text}`,
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
    const truncatedHtml = this.truncateHtml(dto.currentHtml);
    const userMessage: OllamaMessage = {
      role: 'user',
      content: `<CURRENT_HTML>\n${truncatedHtml}\n</CURRENT_HTML>\n\nUser said: "${dto.text}"`,
      ...(dto.screenshot ? { images: [dto.screenshot] } : {}),
    };

    const messages: OllamaMessage[] = [
      { role: 'system', content: VOICE_AGENT_SYSTEM_PROMPT },
      ...dto.history.slice(-6).map((m) => ({ role: m.role as OllamaMessage['role'], content: m.content })),
      userMessage,
    ];

    // format: 'json' forces Ollama to return valid JSON — fixes non-JSON responses
    const response = await this.ollama.chat(messages, undefined, this.orchestratorModel, 'json');
    const content = response.content?.trim() ?? '';

    try {
      const clean = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(clean) as VoiceAgentResult;
      if (!parsed.action || !parsed.text) throw new Error('Missing action or text');
      return parsed;
    } catch {
      this.logger.warn('[VoiceAgent] Could not parse JSON, treating as speak:', content.slice(0, 100));
      // Last resort: extract any text-like content and speak it
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

    // format: 'json' forces valid JSON output from orchestrator
    const response = await this.ollama.chat(messages, undefined, this.orchestratorModel, 'json');
    const content = response.content?.trim() ?? '';

    try {
      const clean = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(clean) as OrchestratorResult;
      if (!parsed.action || !parsed.instruction) throw new Error('Invalid orchestrator response');
      return parsed;
    } catch {
      this.logger.warn('Orchestrator returned non-JSON, defaulting to dialogue:', content.slice(0, 100));
      return { action: 'dialogue', instruction: content, response: content };
    }
  }

  private async streamUiGeneration(
    currentHtml: string,
    instruction: string,
    emit: (obj: Record<string, unknown>) => void,
  ): Promise<void> {
    const truncatedHtml = this.truncateHtml(currentHtml);
    const formatReminder = instruction.includes('Available data from tools') || instruction.includes('TASK: Output ONLY')
      ? 'Reply with ONLY the HTML document. First character must be <.\n\n'
      : '';
    const userContent = `${formatReminder}<CURRENT_HTML>\n${truncatedHtml}\n</CURRENT_HTML>\n\nINSTRUCTION: ${instruction}`;

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

  private truncateHtml(html: string): string {
    return html.length > MAX_HTML_CHARS
      ? html.slice(0, MAX_HTML_CHARS) + '\n<!-- truncated -->'
      : html;
  }
}