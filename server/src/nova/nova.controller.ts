import { Controller, Post, Get, Delete, Body, Query, Param, BadRequestException, Sse, Res } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Response } from 'express';
import { NovaService, NovaInputDto } from './nova.service';
import { NovaMemoryService } from './nova-memory.service';
import { ThoughtBusService } from './thought-bus.service';
import { AgentLoopService } from './agent-loop.service';
import { GoalService } from './goal.service';
import { SummaryService } from './summary.service';
import { CognitiveCoreService } from './cognitive-core.service';

@Controller('nova')
export class NovaController {
  constructor(
    private readonly novaService:      NovaService,
    private readonly memory:           NovaMemoryService,
    private readonly thoughtBus:       ThoughtBusService,
    private readonly agentLoop:        AgentLoopService,
    private readonly goalService:      GoalService,
    private readonly summaryService:   SummaryService,
    private readonly cognitiveCore:    CognitiveCoreService,
  ) {}

  // ── Nova input ────────────────────────────────────────────────────────────

  @Post('input')
  @Sse()
  input(@Body() body: NovaInputDto): Observable<{ data: string }> {
    if (!body.text?.trim()) {
      return new Observable((s) => {
        s.next({ data: JSON.stringify({ type: 'error', message: 'text required' }) });
        s.complete();
      });
    }
    return new Observable((subscriber) => {
      this.agentLoop.pause().then((resume) => {
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
        subscriber.add(() => { sub.unsubscribe(); resume(); });
      }).catch((err: unknown) => subscriber.error(err));
    });
  }

  // ── Memory ────────────────────────────────────────────────────────────────

  @Post('memory')
  async storeMemory(
    @Body() body: { text: string; type?: 'main' | 'association' | 'voice' },
  ): Promise<{ id: string }> {
    if (!body.text?.trim()) throw new BadRequestException('text is required');
    const id = await this.memory.store(body.text.trim(), body.type ?? 'main');
    return { id };
  }

  @Get('memory/project')
  async projectMemory(@Query('limit') limit?: string) {
    const n = limit ? Math.min(parseInt(limit, 10), 500) : 300;
    return this.memory.project(n);
  }

  @Get('memory/search')
  async searchMemory(@Query('q') q: string, @Query('k') k?: string) {
    if (!q?.trim()) throw new BadRequestException('q is required');
    const topK = k ? Math.min(parseInt(k, 10), 50) : 10;
    return this.memory.search(q.trim(), topK);
  }

  // ── Thought stream ────────────────────────────────────────────────────────

  @Get('thoughts')
  thoughtStream(@Res() res: Response) {
    res.setHeader('Content-Type',      'text/event-stream');
    res.setHeader('Cache-Control',     'no-cache');
    res.setHeader('Connection',        'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const unsub = this.thoughtBus.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    const hb = setInterval(() => res.write(': heartbeat\n\n'), 20_000);
    res.on('close', () => { unsub(); clearInterval(hb); });
  }

  @Post('answer')
  receiveAnswer(@Body() body: { answer: string }) {
    this.agentLoop.receiveAnswer(body.answer ?? '');
    return { ok: true };
  }

  // ── Goals ─────────────────────────────────────────────────────────────────

  @Get('goals')
  async getGoals() { return this.goalService.findAll(); }

  @Post('goals')
  async createGoal(@Body() body: { text: string; priority?: number }) {
    if (!body.text?.trim()) throw new BadRequestException('text is required');
    return this.goalService.create(body.text.trim(), body.priority ?? 0);
  }

  @Delete('goals/:id')
  async deleteGoal(@Param('id') id: string) {
    await this.goalService.remove(id);
    return { ok: true };
  }

  @Post('goals/:id/toggle')
  async toggleGoal(@Param('id') id: string, @Body() body: { active: boolean }) {
    return this.goalService.setActive(id, body.active);
  }

  @Post('goals/proposals/:id/approve')
  approveGoalProposal(@Param('id') id: string) {
    this.agentLoop.approveGoal(id);
    return { ok: true };
  }

  @Post('goals/proposals/:id/reject')
  rejectGoalProposal(@Param('id') id: string) {
    this.agentLoop.rejectGoal(id);
    return { ok: true };
  }

  // ── Research Summary ──────────────────────────────────────────────────────

  @Get('summary')
  async getSummary(@Query('refresh') refresh?: string) {
    const forceRefresh = refresh === '1' || refresh === 'true';
    const resume = await this.agentLoop.pause();
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

  @Get('summary/goals')
  async getGoalSummaries(@Query('refresh') refresh?: string) {
    const forceRefresh = refresh === '1' || refresh === 'true';
    const resume = await this.agentLoop.pause();
    try {
      return await this.summaryService.getAllGoalSummaries(forceRefresh);
    } finally {
      resume();
    }
  }

  // ── Cognitive Core ────────────────────────────────────────────────────────

  /**
   * GET /api/nova/cognitive
   * Returns the full cognitive state: current theory, directive, narrative log,
   * meta-insights. Useful for UI display and debugging.
   */
  @Get('cognitive')
  getCognitiveState() {
    return this.cognitiveCore.getState();
  }

  /**
   * POST /api/nova/cognitive/reflect
   * Manually trigger a meta-reflection cycle (e.g. from the UI).
   * Runs async — check /api/nova/cognitive after a few seconds for the result.
   */
  @Post('cognitive/reflect')
  async triggerReflection() {
    const goalContext = await this.goalService.getGoalContext();
    // Fire-and-forget — result arrives via thought bus SSE
    this.cognitiveCore.runMetaReflection(goalContext).catch(() => {});
    return { ok: true, message: 'Meta-reflection triggered. Listen to /api/nova/thoughts for updates.' };
  }
}