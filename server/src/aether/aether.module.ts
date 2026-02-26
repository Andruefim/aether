import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AetherController } from './aether.controller';
import { AetherService } from './aether.service';
import { OllamaService } from '../generate/ollama.service';
import { WebSearchModule } from '../web-search/web-search.module';

@Module({
  imports: [
    WebSearchModule,
    MulterModule.register({ limits: { fileSize: 25 * 1024 * 1024 } }), // 25 MB max audio
  ],
  controllers: [AetherController],
  providers: [AetherService, OllamaService],
})
export class AetherModule {}
