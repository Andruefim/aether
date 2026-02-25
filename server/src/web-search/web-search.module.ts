import { Module } from '@nestjs/common';
import { WebSearchController } from './web-search.controller';
import { WebSearchService } from './web-search.service';

@Module({
  controllers: [WebSearchController],
  providers: [WebSearchService],
  exports: [WebSearchService],
})
export class WebSearchModule {}