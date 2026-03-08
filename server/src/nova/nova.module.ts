import { Module } from '@nestjs/common';
import { NovaController } from './nova.controller';
import { NovaService } from './nova.service';
import { NovaMemoryService } from './nova-memory.service';
import { ThoughtBusService } from './thought-bus.service';
import { AgentLoopService } from './agent-loop.service';
import { AgentToolsService } from './agent-tools.service';
import { OllamaService } from '../generate/ollama.service';

@Module({
  controllers: [NovaController],
  providers: [
    NovaService,
    NovaMemoryService,
    ThoughtBusService,
    AgentLoopService,
    AgentToolsService,
    OllamaService,
  ],
})
export class NovaModule {}