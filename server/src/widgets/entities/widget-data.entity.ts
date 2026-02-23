import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Widget } from './widget.entity';

@Entity('widget_data')
export class WidgetData {
  @PrimaryColumn('varchar', { length: 36 })
  widget_id: string;

  @PrimaryColumn('varchar', { length: 255 })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @ManyToOne(() => Widget, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'widget_id' })
  widget?: Widget;
}
