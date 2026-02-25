import { Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { WidgetData } from './widget-data.entity';

@Entity('widgets')
export class Widget {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column({ type: 'text' })
  user_prompt: string;

  @Column({ type: 'longtext' })
  html: string;

  @Column({ type: 'longtext', nullable: true, default: null })
  preview_html: string | null;

  @Column({ type: 'double', default: 0 })
  position_x: number;

  @Column({ type: 'double', default: 0 })
  position_y: number;

  @Column({ type: 'double', default: 400 })
  width: number;

  @Column({ type: 'double', default: 300 })
  height: number;

  @Column({ type: 'bigint', default: 0 })
  created_at: number;

  @Column({ type: 'bigint', default: 0 })
  last_accessed: number;

  @Column({ type: 'double', default: 1 })
  opacity_decay: number;

  @Column({ type: 'tinyint', default: 0 })
  minimized: number;

  @OneToMany(() => WidgetData, (data) => data.widget)
  dataEntries?: WidgetData[];
}