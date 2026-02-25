import { Module } from '@nestjs/common';
import { GenerateController } from './generate.controller';
import { GenerateService } from './generate.service';
import { OllamaService } from './ollama.service';
import { WebSearchModule } from '../web-search/web-search.module';
import { WidgetsModule } from '../widgets/widgets.module';

@Module({
  imports: [WebSearchModule, WidgetsModule],
  controllers: [GenerateController],
  providers: [GenerateService, OllamaService],
  exports: [GenerateService],
})
export class GenerateModule {}