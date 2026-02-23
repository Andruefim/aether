import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { WidgetsService } from './widgets.service';
import { CreateWidgetDto } from './dto/create-widget.dto';
import { UpdateWidgetDto } from './dto/update-widget.dto';

@Controller('widgets')
export class WidgetsController {
  constructor(private readonly widgetsService: WidgetsService) {}

  @Get()
  findAll() {
    return this.widgetsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateWidgetDto) {
    return this.widgetsService.create(dto);
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWidgetDto,
  ) {
    return this.widgetsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.widgetsService.remove(id);
  }

  @Get(':id/data')
  getData(@Param('id', ParseUUIDPipe) id: string) {
    return this.widgetsService.getData(id);
  }

  @Post(':id/data')
  setData(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.widgetsService.setData(id, body);
  }
}
