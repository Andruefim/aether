import { IsNumber, IsString, IsOptional } from 'class-validator';

export class CreateWidgetDto {
  @IsString()
  id: string;

  @IsString()
  user_prompt: string;

  @IsNumber()
  @IsOptional()
  position_x?: number;

  @IsNumber()
  @IsOptional()
  position_y?: number;
}
