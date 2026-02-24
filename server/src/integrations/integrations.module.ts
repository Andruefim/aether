import { Module } from '@nestjs/common';
import { YoutubeModule } from './youtube/youtube.module';

/**
 * IntegrationsModule is the single import point for all third-party API wrappers.
 * Add new service modules here (Spotify, Weather, Maps, …) as the project grows.
 */
@Module({
  imports: [YoutubeModule],
  exports: [YoutubeModule],
})
export class IntegrationsModule {}


