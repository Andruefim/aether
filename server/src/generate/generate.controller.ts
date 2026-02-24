import { Controller, Get, Query, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { GenerateService } from './generate.service';
import { WIDGET_SYSTEM_PROMPT, AGENTIC_SYSTEM_PROMPT } from './generate.constants';

@Controller('generate')
export class GenerateController {
  constructor(private readonly generateService: GenerateService) {}

  @Get()
  @Sse()
  generate(
    @Query('prompt') prompt: string | undefined,
  ): Observable<{ data: string }> {
    if (!prompt?.trim()) {
      return new Observable((s) => s.complete());
    }
    return this.generateService.streamGenerate(prompt.trim(), WIDGET_SYSTEM_PROMPT);
  }

  /**
   * Agentic endpoint — the model may call web_search / web_fetch before answering.
   *
   * SSE event shapes:
   *   { tool: "web_search", args: { query: "..." } }   ← tool invocation in progress
   *   { text: "token" }                                 ← final streamed answer
   *   [DONE]                                            ← stream finished
   *   { error: "..." }                                  ← something went wrong
   *
   * Optional ?system= override for the system prompt.
   */
  @Get('agent')
  @Sse()
  agentGenerate(
    @Query('prompt') prompt: string | undefined,
    @Query('system') system: string | undefined,
  ): Observable<{ data: string }> {
    if (!prompt?.trim()) {
      return new Observable((s) => s.complete());
    }
    return this.generateService.streamAgenticGenerate(
      prompt.trim(),
      system?.trim() || AGENTIC_SYSTEM_PROMPT,
    );
  }
}