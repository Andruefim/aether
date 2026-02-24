import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { OllamaService, OllamaMessage } from './ollama.service';
import { WebSearchService } from '../web-search/web-search.service';
import { WEB_TOOLS, AGENTIC_SYSTEM_PROMPT } from './generate.constants';

const MAX_TOOL_ROUNDS = 5;

@Injectable()
export class GenerateService {
  constructor(
    private readonly ollama: OllamaService,
    private readonly webSearch: WebSearchService,
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

          // --- Tool-calling loop (non-streaming) ---
          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const response = await this.ollama.chat(messages, WEB_TOOLS);

            messages.push(response);

            if (!response.tool_calls?.length) break; // model is done using tools

            // Emit a progress event so the client knows what's happening
            for (const call of response.tool_calls) {
              const { name, arguments: args } = call.function;
              subscriber.next({
                data: JSON.stringify({ tool: name, args }),
              });

              const result = await this.executeTool(name, args);

              messages.push({
                role: 'tool',
                tool_name: name,
                content: JSON.stringify(result),
              });
            }
          }

          // --- Stream the final answer ---
          for await (const token of this.ollama.streamMessages(messages)) {
            subscriber.next({ data: JSON.stringify({ text: token }) });
          }

          subscriber.next({ data: '[DONE]' });
        } catch (err) {
          subscriber.next({
            data: JSON.stringify({ error: err instanceof Error ? err.message : 'Generation failed' }),
          });
        } finally {
          subscriber.complete();
        }
      };
      run();
    });
  }

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (name === 'web_search') {
      return this.webSearch.search(
        args.query as string,
        (args.max_results as number | undefined) ?? 5,
      );
    }
    if (name === 'web_fetch') {
      return this.webSearch.fetch(args.url as string);
    }
    throw new Error(`Unknown tool: ${name}`);
  }
}