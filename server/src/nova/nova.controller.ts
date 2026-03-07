import { Controller, Post, Get, Body, Query, BadRequestException, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { NovaService, NovaInputDto } from './nova.service';
import { NovaMemoryService } from './nova-memory.service';

@Controller('nova')
export class NovaController {
  constructor(
    private readonly novaService: NovaService,
    private readonly memory: NovaMemoryService,
  ) {}

  /**
   * POST /api/nova/input
   * SSE stream:
   *   { type:'tone',  emotion, energy, color }
   *   { type:'token', stream:'main'|'association', text, color }
   *   { type:'done' }
   */
  @Post('input')
  @Sse()
  input(@Body() body: NovaInputDto): Observable<{ data: string }> {
    if (!body.text?.trim()) {
      return new Observable((s) => {
        s.next({ data: JSON.stringify({ type: 'error', message: 'text required' }) });
        s.complete();
      });
    }
    return this.novaService.streamInput({
      text: body.text.trim(),
      history: body.history ?? [],
      screenshot: body.screenshot,
    });
  }

  /**
   * POST /api/nova/memory
   * Body: { text, type? }
   * Stores text as a memory vector in Qdrant.
   */
  @Post('memory')
  async storeMemory(
    @Body() body: { text: string; type?: 'main' | 'association' | 'voice' },
  ): Promise<{ id: string }> {
    if (!body.text?.trim()) throw new BadRequestException('text is required');
    const id = await this.memory.store(body.text.trim(), body.type ?? 'main');
    return { id };
  }

  /**
   * GET /api/nova/memory/project
   * Returns UMAP-projected 3D positions for all memory points.
   */
  @Get('memory/project')
  async projectMemory(@Query('limit') limit?: string) {
    const n = limit ? Math.min(parseInt(limit, 10), 500) : 300;
    return this.memory.project(n);
  }

  /**
   * GET /api/nova/memory/search?q=...&k=10
   * Returns nearest memory points to the query string.
   */
  @Get('memory/search')
  async searchMemory(@Query('q') q: string, @Query('k') k?: string) {
    if (!q?.trim()) throw new BadRequestException('q is required');
    const topK = k ? Math.min(parseInt(k, 10), 50) : 10;
    return this.memory.search(q.trim(), topK);
  }
}
