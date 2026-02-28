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
   * Text input SSE stream — route decision + generated HTML tokens or dialogue.
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
   * POST /api/aether/voice-chat
   * Voice agent SSE stream.
   * Events:
   *   { type: 'speak', text }         → client plays TTS immediately
   *   { type: 'route', action }        → if generate_ui
   *   { type: 'token', text }          → HTML stream (if generate_ui)
   *   { type: 'done' }
   *   { type: 'error', message }
   */
  @Post('voice-chat')
  @Sse()
  voiceChat(@Body() body: AetherInputDto): Observable<{ data: string }> {
    if (!body.text?.trim()) {
      return new Observable((s) => {
        s.next({ data: JSON.stringify({ type: 'error', message: 'text is required' }) });
        s.complete();
      });
    }
    return this.aetherService.streamVoiceChat({
      text: body.text.trim(),
      screenshot: body.screenshot,
      currentHtml: body.currentHtml ?? '',
      history: body.history ?? [],
    });
  }

  /**
   * POST /api/aether/transcribe
   * Audio file → transcribed text via Whisper.
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
   * { text } → audio/wav stream from XTTS-v2.
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

    res.setHeader('Content-Type', 'audio/wav');
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