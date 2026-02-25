import {
  Controller,
  Get,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { YoutubeService } from './youtube.service';

@Controller('integrations/youtube')
export class YoutubeController {
  constructor(private readonly youtube: YoutubeService) {}

  /**
   * GET /api/integrations/youtube/search?q=mat+armstrong&max=5
   * Search for videos by keyword.
   */
  @Get('search')
  search(@Query('q') query: string, @Query('max') max?: string) {
    if (!query?.trim()) throw new BadRequestException('q is required');
    return this.youtube.search(query.trim(), max ? Math.min(parseInt(max, 10) || 5, 50) : 5);
  }

  /**
   * GET /api/integrations/youtube/channels?q=Doug+DeMuro&max=3
   * Resolve a channel name to channel metadata (includes channelId).
   */
  @Get('channels')
  searchChannels(@Query('q') query: string, @Query('max') max?: string) {
    if (!query?.trim()) throw new BadRequestException('q is required');
    return this.youtube.searchChannels(query.trim(), max ? Math.min(parseInt(max, 10) || 3, 10) : 3);
  }

  /**
   * GET /api/integrations/youtube/channel/:channelId/latest?max=1
   * Get latest videos for a known channelId.
   */
  @Get('channel/:channelId/latest')
  channelLatest(@Param('channelId') channelId: string, @Query('max') max?: string) {
    return this.youtube.getChannelLatest(
      channelId,
      max ? Math.min(parseInt(max, 10) || 1, 50) : 1,
    );
  }

  /**
   * GET /api/integrations/youtube/channel-by-name/latest?q=Doug+DeMuro&max=1
   * Resolve channel name → latest videos in one call.
   * PREFERRED endpoint for widgets — no hardcoded channel IDs needed.
   */
  @Get('channel-by-name/latest')
  channelByNameLatest(@Query('q') query: string, @Query('max') max?: string) {
    if (!query?.trim()) throw new BadRequestException('q is required');
    return this.youtube.getLatestByChannelName(
      query.trim(),
      max ? Math.min(parseInt(max, 10) || 1, 50) : 1,
    );
  }
}