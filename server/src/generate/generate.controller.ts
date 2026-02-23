import { Controller, Get, Query, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { GenerateService } from './generate.service';
import { WIDGET_SYSTEM_PROMPT } from './generate.constants';

@Controller('generate')
export class GenerateController {
  constructor(private readonly generateService: GenerateService) {}

  @Get()
  @Sse()
  generate(@Query('prompt') prompt: string | undefined): Observable<{ data: string }> {
    if (!prompt?.trim()) {
      return new Observable((subscriber) => subscriber.complete());
    }
    return this.generateService.streamGenerate(prompt.trim(), WIDGET_SYSTEM_PROMPT);
  }
}
