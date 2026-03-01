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