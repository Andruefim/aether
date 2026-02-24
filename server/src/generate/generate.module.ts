import { Module } from '@nestjs/common';
import { GenerateController } from './generate.controller';
import { GenerateService } from './generate.service';
import { OllamaService } from './ollama.service';
import { WebSearchModule } from '../web-search/web-search.module';

@Module({
  imports: [WebSearchModule],
  controllers: [GenerateController],
  providers: [GenerateService, OllamaService],
  exports: [GenerateService],
})
export class GenerateModule {}