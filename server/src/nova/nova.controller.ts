import { Controller, Post, Body, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { NovaService, NovaInputDto } from './nova.service';

@Controller('nova')
export class NovaController {
  constructor(private readonly novaService: NovaService) {}

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
    // #region agent log
    fetch('http://127.0.0.1:7461/ingest/64501a78-c888-413b-b13b-8cfa3e20bfa3', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '5c9948',
      },
      body: JSON.stringify({
        sessionId: '5c9948',
        runId: 'nova-input-426',
        hypothesisId: 'H1-server-reached',
        location: 'server/src/nova/nova.controller.ts:18',
        message: 'NovaController.input called',
        data: {
          hasText: !!body.text,
          textLength: body.text ? body.text.length : 0,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
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
}