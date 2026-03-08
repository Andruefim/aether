import { Module } from '@nestjs/common';
import { ExperimentController } from './experiment.controller';
import { ExperimentService } from './experiment.service';
import { OllamaService } from '../generate/ollama.service';
import { NovaMemoryService } from '../nova/nova-memory.service';
import { ThoughtBusService } from '../nova/thought-bus.service';

@Module({
  controllers: [ExperimentController],
  providers:   [ExperimentService, OllamaService, NovaMemoryService, ThoughtBusService],
  exports:     [ExperimentService],
})
export class ExperimentModule {}
