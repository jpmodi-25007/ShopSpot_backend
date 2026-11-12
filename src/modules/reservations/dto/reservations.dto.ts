import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateReservationDto {
  @IsUUID()
  productId: string;

  /**
   * Accepted for backwards compatibility with existing clients but never
   * trusted: the server always determines the reserved price itself.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  reservedPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  quantity?: number;

  @IsOptional()
  @IsUUID()
  negotiationId?: string;
}

export class VerifyQrDto {
  @IsString()
  qrToken: string;
}

export class RescheduleReservationDto {
  @IsDateString()
  newDateTime: string;
}
