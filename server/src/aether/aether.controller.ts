import {
  Controller,
  Post,
  Body,
  Sse,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Observable } from 'rxjs';
import { Response } from 'express';
import { AetherService, AetherInputDto } from './aether.service';

@Controller('aether')
export class AetherController {
  constructor(private readonly aetherService: AetherService) {}

  /**
   * POST /api/aether/input
   * Main entry point. Accepts text + optional screenshot + currentHtml + history.
   * Returns SSE stream with route decision + generated tokens or dialogue response.
   */
  @Post('input')
  @Sse()
  input(@Body() body: AetherInputDto): Observable<{ data: string }> {
    if (!body.text?.trim()) {
      return new Observable((s) => {
        s.next({ data: JSON.stringify({ type: 'error', message: 'text is required' }) });
        s.complete();
      });
    }
    return this.aetherService.streamInput({
      text: body.text.trim(),
      screenshot: body.screenshot,
      currentHtml: body.currentHtml ?? '',
      history: body.history ?? [],
    });
  }

  /**
   * POST /api/aether/transcribe
   * Accepts audio file (webm/opus), returns transcribed text.
   * Proxies to Voice FastAPI service.
   */
  @Post('transcribe')
  @UseInterceptors(FileInterceptor('audio'))
  async transcribe(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ text: string; language: string }> {
    if (!file) throw new BadRequestException('audio file is required');
    return this.aetherService.transcribe(file.buffer, file.mimetype);
  }

  /**
   * POST /api/aether/speak
   * Accepts { text: string }, returns audio/mpeg stream from XTTS-v2.
   */
  @Post('speak')
  async speak(
    @Body() body: { text: string },
    @Res() res: Response,
  ): Promise<void> {
    if (!body.text?.trim()) throw new BadRequestException('text is required');

    const stream = await this.aetherService.speak(body.text.trim());
    if (!stream) {
      res.status(503).json({ error: 'TTS service unavailable' });
      return;
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      res.end();
    }
  }
}
