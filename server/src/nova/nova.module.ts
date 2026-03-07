import { Module } from '@nestjs/common';
import { NovaController } from './nova.controller';
import { NovaService } from './nova.service';
import { NovaMemoryService } from './nova-memory.service';
import { OllamaService } from '../generate/ollama.service';

@Module({
  controllers: [NovaController],
  providers: [NovaService, NovaMemoryService, OllamaService],
})
export class NovaModule {}