import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WidgetsController } from './widgets.controller';
import { WidgetsService } from './widgets.service';
import { Widget } from './entities/widget.entity';
import { WidgetData } from './entities/widget-data.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Widget, WidgetData]),
  ],
  controllers: [WidgetsController],
  providers: [WidgetsService],
  exports: [WidgetsService],
})
export class WidgetsModule {}
