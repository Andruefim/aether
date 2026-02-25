import { Controller, Get, Post, Query, Body, Sse, BadRequestException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { GenerateService } from './generate.service';
import { WIDGET_SYSTEM_PROMPT, AGENTIC_SYSTEM_PROMPT } from './generate.constants';

@Controller('generate')
export class GenerateController {
  constructor(private readonly generateService: GenerateService) {}

  @Get()
  @Sse()
  generate(@Query('prompt') prompt: string | undefined): Observable<{ data: string }> {
    if (!prompt?.trim()) return new Observable((s) => s.complete());
    return this.generateService.streamGenerate(prompt.trim(), WIDGET_SYSTEM_PROMPT);
  }

  @Get('agent')
  @Sse()
  agentGenerate(
    @Query('prompt') prompt: string | undefined,
    @Query('system') system: string | undefined,
  ): Observable<{ data: string }> {
    if (!prompt?.trim()) return new Observable((s) => s.complete());
    return this.generateService.streamAgenticGenerate(prompt.trim(), system?.trim() || AGENTIC_SYSTEM_PROMPT);
  }

  /**
   * POST /api/generate/preview
   * Body: { widgetId: string, userPrompt: string }
   * Generates a minimalist 160x120 thumbnail from the user's prompt text (not the full HTML).
   */
  @Post('preview')
  async generatePreview(
    @Body() body: { widgetId: string; userPrompt: string },
  ): Promise<{ html: string }> {
    if (!body.widgetId || !body.userPrompt) {
      throw new BadRequestException('widgetId and userPrompt are required');
    }
    const html = await this.generateService.generatePreview(body.widgetId, body.userPrompt);
    return { html };
  }
}