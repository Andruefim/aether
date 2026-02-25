import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Widget } from './entities/widget.entity';
import { WidgetData } from './entities/widget-data.entity';
import { CreateWidgetDto } from './dto/create-widget.dto';
import { UpdateWidgetDto } from './dto/update-widget.dto';

export interface WidgetResponse {
  id: string;
  user_prompt: string;
  html: string;
  preview_html: string | null;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  created_at: number;
  last_accessed: number;
  opacity_decay: number;
  minimized: boolean;
}

@Injectable()
export class WidgetsService {
  constructor(
    @InjectRepository(Widget)
    private readonly widgetRepo: Repository<Widget>,
    @InjectRepository(WidgetData)
    private readonly widgetDataRepo: Repository<WidgetData>,
  ) {}

  async findAll(): Promise<WidgetResponse[]> {
    const rows = await this.widgetRepo.find({ order: { created_at: 'ASC' } });
    return rows.map((r) => this.toWidgetResponse(r));
  }

  async create(dto: CreateWidgetDto): Promise<{ success: boolean }> {
    const now = Date.now();
    await this.widgetRepo.insert({
      id: dto.id,
      user_prompt: dto.user_prompt,
      html: '',
      preview_html: null,
      position_x: dto.position_x ?? 0,
      position_y: dto.position_y ?? 0,
      width: 400,
      height: 300,
      created_at: now,
      last_accessed: now,
      opacity_decay: 1,
      minimized: 0,
    });
    return { success: true };
  }

  async update(id: string, dto: UpdateWidgetDto): Promise<{ success: boolean }> {
    const widget = await this.widgetRepo.findOne({ where: { id } });
    if (!widget) throw new NotFoundException('Widget not found');

    if (dto.html !== undefined) widget.html = dto.html;
    if (dto.position_x !== undefined) widget.position_x = dto.position_x;
    if (dto.position_y !== undefined) widget.position_y = dto.position_y;
    if (dto.width !== undefined) widget.width = dto.width;
    if (dto.height !== undefined) widget.height = dto.height;
    if (dto.minimized !== undefined) widget.minimized = dto.minimized ? 1 : 0;
    if (dto.last_accessed !== undefined) widget.last_accessed = dto.last_accessed;

    await this.widgetRepo.save(widget);
    return { success: true };
  }

  async setPreview(id: string, html: string): Promise<{ success: boolean }> {
    const widget = await this.widgetRepo.findOne({ where: { id } });
    if (!widget) throw new NotFoundException('Widget not found');
    widget.preview_html = html;
    await this.widgetRepo.save(widget);
    return { success: true };
  }

  async remove(id: string): Promise<{ success: boolean }> {
    await this.widgetDataRepo.delete({ widget_id: id });
    const result = await this.widgetRepo.delete(id);
    if (result.affected === 0) throw new NotFoundException('Widget not found');
    return { success: true };
  }

  async getData(id: string): Promise<Record<string, unknown>> {
    const exists = await this.widgetRepo.exists({ where: { id } });
    if (!exists) throw new NotFoundException('Widget not found');
    const rows = await this.widgetDataRepo.find({ where: { widget_id: id } });
    const data: Record<string, unknown> = {};
    for (const row of rows) {
      try { data[row.key] = JSON.parse(row.value); }
      catch { data[row.key] = row.value; }
    }
    return data;
  }

  async setData(id: string, body: Record<string, unknown>): Promise<{ success: boolean }> {
    const exists = await this.widgetRepo.exists({ where: { id } });
    if (!exists) throw new NotFoundException('Widget not found');
    for (const [key, value] of Object.entries(body)) {
      await this.widgetDataRepo.upsert(
        { widget_id: id, key, value: JSON.stringify(value) },
        { conflictPaths: ['widget_id', 'key'] },
      );
    }
    return { success: true };
  }

  private toWidgetResponse(row: Widget): WidgetResponse {
    return {
      id: row.id,
      user_prompt: row.user_prompt,
      html: row.html,
      preview_html: row.preview_html ?? null,
      position_x: Number(row.position_x),
      position_y: Number(row.position_y),
      width: Number(row.width),
      height: Number(row.height),
      created_at: Number(row.created_at),
      last_accessed: Number(row.last_accessed),
      opacity_decay: Number(row.opacity_decay),
      minimized: row.minimized === 1,
    };
  }
}