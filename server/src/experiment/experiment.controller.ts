import { Controller, Post, Get, Body, Res, Query, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { ExperimentService } from './experiment.service';

@Controller('experiment')
export class ExperimentController {
  constructor(private readonly svc: ExperimentService) {}

  /**
   * POST /api/experiment/run
   * Triggers a full experiment cycle. Returns immediately with experimentId.
   * Progress streams via GET /api/experiment/events.
   */
  @Post('run')
  async run(@Body() body: { hypothesis: string; goalContext?: string }) {
    if (!body.hypothesis?.trim()) throw new BadRequestException('hypothesis is required');
    // Fire and forget — result arrives via SSE
    this.svc
      .runExperiment(body.hypothesis.trim(), body.goalContext ?? 'general research')
      .catch(() => {});
    return { ok: true, message: 'Experiment started. Subscribe to /api/experiment/events for progress.' };
  }

  /**
   * GET /api/experiment/events
   * SSE stream of ExperimentEvent objects.
   */
  @Get('events')
  events(@Res() res: Response) {
    res.setHeader('Content-Type',      'text/event-stream');
    res.setHeader('Cache-Control',     'no-cache');
    res.setHeader('Connection',        'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const unsub = this.svc.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    const hb = setInterval(() => res.write(': heartbeat\n\n'), 20_000);

    res.on('close', () => { unsub(); clearInterval(hb); });
  }

  /**
   * GET /api/experiment/results?limit=20
   * Returns recent experiment results (cached in memory).
   */
  @Get('results')
  results(@Query('limit') limit?: string) {
    const n = limit ? Math.min(parseInt(limit, 10), 50) : 20;
    return this.svc.getRecentResults(n);
  }

  /**
   * POST /api/experiment/interpret
   * Called by frontend after rendering to send screenshot for VLM interpretation.
   */
  @Post('interpret')
  async interpret(@Body() body: { experimentId: string; screenshotB64: string }) {
    // Currently stored in results; future: trigger re-interpretation with vision
    return { ok: true };
  }
}
