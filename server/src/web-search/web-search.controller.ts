import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { WebSearchService } from './web-search.service';

@Controller('web-search')
export class WebSearchController {
  constructor(private readonly webSearchService: WebSearchService) {}

  @Get('search')
  search(
    @Query('q') query: string,
    @Query('max') max?: string,
  ) {
    if (!query?.trim()) throw new BadRequestException('q is required');
    const maxResults = max ? Math.min(parseInt(max, 10) || 5, 10) : 5;
    return this.webSearchService.search(query.trim(), maxResults);
  }

  @Get('fetch')
  fetch(@Query('url') url: string) {
    if (!url?.trim()) throw new BadRequestException('url is required');
    return this.webSearchService.fetch(url.trim());
  }
}