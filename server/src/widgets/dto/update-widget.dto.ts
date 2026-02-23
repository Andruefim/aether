import { IsNumber, IsString, IsBoolean, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateWidgetDto {
  @IsString()
  @IsOptional()
  html?: string;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  position_x?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  position_y?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  width?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  height?: number;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  minimized?: boolean;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  last_accessed?: number;
}
