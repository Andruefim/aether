import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { OllamaService, OllamaMessage } from './ollama.service';
import { WebSearchService } from '../web-search/web-search.service';
import { WidgetsService } from '../widgets/widgets.service';
import { WEB_TOOLS, AGENTIC_SYSTEM_PROMPT, PREVIEW_SYSTEM_PROMPT } from './generate.constants';

const MAX_TOOL_ROUNDS = 5;

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

  /**
   * Generate a minimalist static preview thumbnail from the user's original prompt.
   * Much faster than parsing the full widget HTML — model only needs to make a tiny icon.
   */
  async generatePreview(widgetId: string, userPrompt: string): Promise<string> {
    const messages: OllamaMessage[] = [
      { role: 'system', content: PREVIEW_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    let result = '';
    for await (const token of this.ollama.streamMessages(messages)) {
      result += token;
    }

    const html = result
      .replace(/^```(?:html)?\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim();

    await this.widgets.setPreview(widgetId, html);
    return html;
  }

  streamAgenticGenerate(
    prompt: string,
    systemPrompt = AGENTIC_SYSTEM_PROMPT,
  ): Observable<{ data: string }> {
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