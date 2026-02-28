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
} from './aether.constants';

export interface AetherInputDto {
  text: string;
  screenshot?: string;      // base64 jpeg (no data: prefix)
  currentHtml: string;
  history: { role: 'user' | 'assistant'; content: string }[];
}

interface OrchestratorResult {
  action: 'generate_ui' | 'dialogue' | 'tool';
  instruction: string;
  response?: string;
}

const MAX_HTML_CHARS = 24_000; // ~6k tokens, truncate if larger
const MAX_TOOL_ROUNDS = 3;

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

  /**
   * Main SSE stream for aether input.
   * Emits JSON event objects:
   *   { type: 'route',   action, instruction }
   *   { type: 'token',   text }
   *   { type: 'dialogue', text }
   *   { type: 'tool_call', name, args }
   *   { type: 'tool_result', name, result }
   *   { type: 'done' }
   *   { type: 'error',   message }
   */
  streamInput(dto: AetherInputDto): Observable<{ data: string }> {
    return new Observable((subscriber) => {
      const emit = (obj: Record<string, unknown>) =>
        subscriber.next({ data: JSON.stringify(obj) });

      const run = async () => {
        try {
          // 1. Call orchestrator (MiniCPM) with screenshot
          const result = await this.callOrchestrator(dto);
          this.logger.log(`[Orchestrator] action=${result.action} instruction=${result.instruction}`);
          emit({ type: 'route', action: result.action, instruction: result.instruction });

          if (result.action === 'dialogue') {
            // Direct answer from MiniCPM
            emit({ type: 'dialogue', text: result.response ?? result.instruction });
          } else if (result.action === 'tool') {
            // Execute tools then let coder build a widget with the data
            const toolContext = await this.executeToolsForAether(
              result.instruction,
              dto.currentHtml,
              emit,
            );
            const toolInstruction = `TASK: Output ONLY a complete HTML document starting with <!DOCTYPE html>. Build a glass-style widget that displays the data below. Do not output an article, explanation, or plain text — only the full HTML page.

${result.instruction}

Available data from tools:
${toolContext}`;
            await this.streamUiGeneration(dto.currentHtml, toolInstruction, emit);
          } else {
            // generate_ui: stream qwen3-coder
            await this.streamUiGeneration(dto.currentHtml, result.instruction, emit);
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

  /**
   * Transcribe audio via the Voice FastAPI service.
   */
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

  /**
   * Text-to-speech via XTTS-v2.
   * Returns a readable stream of audio chunks.
   */
  async speak(text: string): Promise<ReadableStream<Uint8Array> | null> {
    const res = await fetch(`${VOICE_SERVICE_URL}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`TTS failed: ${res.statusText}`);
    return res.body;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async callOrchestrator(dto: AetherInputDto): Promise<OrchestratorResult> {
    if (dto.screenshot) {
      this.logger.log(`[Orchestrator] received screenshot (${dto.screenshot.length} chars base64)`);
    }
    const userMessage: OllamaMessage = {
      role: 'user',
      content: dto.text,
      ...(dto.screenshot ? { images: [dto.screenshot] } : {}),
    };

    const messages: OllamaMessage[] = [
      { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
      // Include last 4 turns of history for context
      ...dto.history.slice(-4).map((m) => ({
        role: m.role as OllamaMessage['role'],
        content: m.content,
      })),
      userMessage,
    ];

    const response = await this.ollama.chat(messages, undefined, this.orchestratorModel);
    const content = response.content?.trim() ?? '';

    try {
      // Strip potential markdown fences
      const clean = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(clean) as OrchestratorResult;
      if (!parsed.action || !parsed.instruction) throw new Error('Invalid orchestrator response');
      return parsed;
    } catch {
      this.logger.warn('Orchestrator returned non-JSON, defaulting to dialogue', content);
      return { action: 'dialogue', instruction: content, response: content };
    }
  }

  private async streamUiGeneration(
    currentHtml: string,
    instruction: string,
    emit: (obj: Record<string, unknown>) => void,
  ): Promise<void> {
    this.logger.log(`[Coder] model=${this.coderModel} instruction=${instruction}`);

    // Truncate HTML if too large
    const truncatedHtml =
      currentHtml.length > MAX_HTML_CHARS
        ? currentHtml.slice(0, MAX_HTML_CHARS) + '\n<!-- truncated -->'
        : currentHtml;

    const formatReminder =
      instruction.includes('Available data from tools') ||
      instruction.includes('TASK: Output ONLY')
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
    currentHtml: string,
    emit: (obj: Record<string, unknown>) => void,
  ): Promise<string> {
    const results: string[] = [];

    // Simple keyword-based tool routing for aether
    try {
      let query = instruction;
      const searchQueryMatch = instruction.match(/search\s+query:\s*([^|]+)/i);
      if (searchQueryMatch) query = searchQueryMatch[1].trim();
      else query = instruction.replace(/^(search|find|get|show|what is|how is)\s+/i, '').replace(/\s*\|\s*display as:.*$/i, '').trim();
      emit({ type: 'tool_call', name: 'web_search', args: { query } });

      const searchResults = await this.webSearch.search(query, 3);
      const summary = searchResults
        .slice(0, 3)
        .map((r) => `${r.title}: ${r.content}`)
        .join('\n\n');

      results.push(summary);
      emit({ type: 'tool_result', name: 'web_search', result: summary.slice(0, 500) });
    } catch (err) {
      this.logger.warn('Tool execution failed', err);
    }

    return results.join('\n\n');
  }
}
