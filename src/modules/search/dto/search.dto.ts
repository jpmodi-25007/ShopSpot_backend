import { IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GlobalSearchDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  q?: string;
}
