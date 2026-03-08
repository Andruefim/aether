import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NovaController } from './nova.controller';
import { NovaService } from './nova.service';
import { NovaMemoryService } from './nova-memory.service';
import { ThoughtBusService } from './thought-bus.service';
import { AgentLoopService } from './agent-loop.service';
import { AgentToolsService } from './agent-tools.service';
import { GoalService } from './goal.service';
import { SummaryService } from './summary.service';
import { NovaGoal } from './entities/nova-goal.entity';
import { OllamaService } from '../generate/ollama.service';
import { AgentActionsService } from './agent-loop/agent-actions.service';
import { AgentMemoryService } from './agent-loop/agent-memory.service';

@Module({
  imports: [TypeOrmModule.forFeature([NovaGoal])],
  controllers: [NovaController],
  providers: [
    NovaService,
    NovaMemoryService,
    ThoughtBusService,
    AgentLoopService,
    AgentToolsService,
    AgentActionsService,
    AgentMemoryService,
    GoalService,
    SummaryService,
    OllamaService,
  ],
})
export class NovaModule {}