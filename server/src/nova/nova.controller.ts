import { Controller, Post, Get, Delete, Body, Query, Param, BadRequestException, Sse, Res } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Response } from 'express';
import { NovaService, NovaInputDto } from './nova.service';
import { NovaMemoryService } from './nova-memory.service';
import { ThoughtBusService } from './thought-bus.service';
import { AgentLoopService } from './agent-loop.service';
import { GoalService } from './goal.service';
import { SummaryService } from './summary.service';

@Controller('nova')
export class NovaController {
  constructor(
    private readonly novaService: NovaService,
    private readonly memory: NovaMemoryService,
    private readonly thoughtBus: ThoughtBusService,
    private readonly agentLoop: AgentLoopService,
    private readonly goalService: GoalService,
    private readonly summaryService: SummaryService,
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
    const resume = this.agentLoop.pause();
    return new Observable((subscriber) => {
      const inner = this.novaService.streamInput({
        text:       body.text.trim(),
        history:    body.history ?? [],
        screenshot: body.screenshot,
      });
      const sub = inner.subscribe({
        next:     (v) => subscriber.next(v),
        error:    (e) => { subscriber.error(e); resume(); },
        complete: ()  => { subscriber.complete(); resume(); },
      });
      return () => { sub.unsubscribe(); resume(); };
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

  /**
   * GET /api/nova/thoughts
   * SSE stream of Nova's autonomous thought events.
   */
  @Get('thoughts')
  thoughtStream(@Res() res: Response) {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const unsub = this.thoughtBus.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    // Heartbeat every 20s to keep connection alive
    const hb = setInterval(() => res.write(': heartbeat\n\n'), 20_000);

    res.on('close', () => {
      unsub();
      clearInterval(hb);
    });
  }

  /**
   * POST /api/nova/answer
   */
  @Post('answer')
  receiveAnswer(@Body() body: { answer: string }) {
    this.agentLoop.receiveAnswer(body.answer ?? '');
    return { ok: true };
  }

  // ── Goals ─────────────────────────────────────────────────────────────────

  /** GET /api/nova/goals */
  @Get('goals')
  async getGoals() {
    return this.goalService.findAll();
  }

  /** POST /api/nova/goals  { text, priority? } */
  @Post('goals')
  async createGoal(@Body() body: { text: string; priority?: number }) {
    if (!body.text?.trim()) throw new BadRequestException('text is required');
    return this.goalService.create(body.text.trim(), body.priority ?? 0);
  }

  /** DELETE /api/nova/goals/:id */
  @Delete('goals/:id')
  async deleteGoal(@Param('id') id: string) {
    await this.goalService.remove(id);
    return { ok: true };
  }

  /** POST /api/nova/goals/:id/toggle  { active: boolean } */
  @Post('goals/:id/toggle')
  async toggleGoal(@Param('id') id: string, @Body() body: { active: boolean }) {
    return this.goalService.setActive(id, body.active);
  }

  /** POST /api/nova/goals/proposals/:id/approve */
  @Post('goals/proposals/:id/approve')
  approveGoalProposal(@Param('id') id: string) {
    this.agentLoop.approveGoal(id);
    return { ok: true };
  }

  /** POST /api/nova/goals/proposals/:id/reject */
  @Post('goals/proposals/:id/reject')
  rejectGoalProposal(@Param('id') id: string) {
    this.agentLoop.rejectGoal(id);
    return { ok: true };
  }

  // ── Research Summary ──────────────────────────────────────────────────────

  /** GET /api/nova/summary?refresh=1  (legacy single-summary endpoint) */
  @Get('summary')
  async getSummary(@Query('refresh') refresh?: string) {
    const forceRefresh = refresh === '1' || refresh === 'true';
    const resume = this.agentLoop.pause();
    try {
      const goalSummaries = await this.summaryService.getAllGoalSummaries(forceRefresh);
      if (goalSummaries.length === 0) {
        return { title: 'No data yet', bullets: [], insight: '', generatedAt: 0, memoryCount: 0 };
      }
      const best = goalSummaries.sort((a, b) => b.memoryCount - a.memoryCount)[0];
      return best;
    } finally {
      resume();
    }
  }

  /** GET /api/nova/summary/goals?refresh=1 — per-goal summaries */
  @Get('summary/goals')
  async getGoalSummaries(@Query('refresh') refresh?: string) {
    const forceRefresh = refresh === '1' || refresh === 'true';
    const resume = this.agentLoop.pause();
    try {
      return await this.summaryService.getAllGoalSummaries(forceRefresh);
    } finally {
      resume();
    }
  }
}
