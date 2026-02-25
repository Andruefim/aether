import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { OllamaService, OllamaMessage } from './ollama.service';
import { WebSearchService } from '../web-search/web-search.service';
import { WidgetsService } from '../widgets/widgets.service';
import { WEB_TOOLS, AGENTIC_SYSTEM_PROMPT, PREVIEW_SYSTEM_PROMPT, FULL_PREVIEW_GENERATION } from './generate.constants';

const MAX_TOOL_ROUNDS = 5;

/**
 * Pick a deterministic accent color from the prompt string.
 * Returns an HSL color string — always light/vivid, never dark.
 */
function promptToColor(prompt: string): string {
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    hash = (hash * 31 + prompt.charCodeAt(i)) & 0xffffffff;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 78%)`;
}

/**
 * Build an instant canvas-title preview HTML — no LLM needed.
 * Renders the prompt in centered italic text on a transparent background.
 * The WebGL cloud background is rendered by the React component on top.
 */
function buildTitlePreviewHtml(userPrompt: string): string {
  const escaped = userPrompt
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 160px; height: 120px;
    overflow: hidden; background: transparent;
    display: flex; align-items: center; justify-content: center;
    padding: 16px;
  }
  p {
    color: rgba(255,255,255,0.75);
    font-family: system-ui, sans-serif;
    font-size: 14px;
    font-weight: 500;
    text-align: center;
    line-height: 1.4;
    word-break: break-word;
  }
</style>
</head>
<body><p>${escaped}</p></body>
</html>`;
}

@Injectable()
export class GenerateService {
  constructor(
    private readonly ollama: OllamaService,
    private readonly webSearch: WebSearchService,
    private readonly widgets: WidgetsService,
  ) {}

  streamGenerate(prompt: string, systemInstruction: string): Observable<{ data: string }> {
    return new Observable((subscriber) => {
      const run = async () => {
        try {
          for await (const token of this.ollama.streamGenerate(prompt, systemInstruction)) {
            subscriber.next({ data: JSON.stringify({ text: token }) });
          }
          subscriber.next({ data: '[DONE]' });
        } catch {
          subscriber.next({ data: JSON.stringify({ error: 'Generation failed' }) });
        } finally {
          subscriber.complete();
        }
      };
      run();
    });
  }

  async generatePreview(widgetId: string, userPrompt: string): Promise<string> {
    let html: string;

    if (FULL_PREVIEW_GENERATION) {
      // Full LLM-generated miniature
      const messages: OllamaMessage[] = [
        { role: 'system', content: PREVIEW_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ];
      let result = '';
      for await (const token of this.ollama.streamMessages(messages)) {
        result += token;
      }
      html = result.replace(/^```(?:html)?\n?/i, '').replace(/\n?```$/i, '').trim();
    } else {
      // Instant canvas title tile — no LLM call
      html = buildTitlePreviewHtml(userPrompt);
    }

    await this.widgets.setPreview(widgetId, html);
    return html;
  }

  streamAgenticGenerate(prompt: string, systemPrompt = AGENTIC_SYSTEM_PROMPT): Observable<{ data: string }> {
    return new Observable((subscriber) => {
      const run = async () => {
        try {
          const messages: OllamaMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ];
          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const response = await this.ollama.chat(messages, WEB_TOOLS);
            messages.push(response);
            if (!response.tool_calls?.length) break;
            for (const call of response.tool_calls) {
              const { name, arguments: args } = call.function;
              subscriber.next({ data: JSON.stringify({ tool: name, args }) });
              const result = await this.executeTool(name, args);
              messages.push({ role: 'tool', tool_name: name, content: JSON.stringify(result) });
            }
          }
          for await (const token of this.ollama.streamMessages(messages)) {
            subscriber.next({ data: JSON.stringify({ text: token }) });
          }
          subscriber.next({ data: '[DONE]' });
        } catch (err) {
          subscriber.next({ data: JSON.stringify({ error: err instanceof Error ? err.message : 'Generation failed' }) });
        } finally {
          subscriber.complete();
        }
      };
      run();
    });
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === 'web_search') return this.webSearch.search(args.query as string, (args.max_results as number | undefined) ?? 5);
    if (name === 'web_fetch') return this.webSearch.fetch(args.url as string);
    throw new Error(`Unknown tool: ${name}`);
  }
}