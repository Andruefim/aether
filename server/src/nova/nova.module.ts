import { Module } from '@nestjs/common';
import { NovaController } from './nova.controller';
import { NovaService } from './nova.service';
import { OllamaService } from '../generate/ollama.service';

@Module({
  controllers: [NovaController],
  providers: [NovaService, OllamaService],
})
export class NovaModule {}