import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/**
 * Translates database errors that are really client mistakes into proper 4xx
 * responses instead of a generic 500. It only handles Prisma errors; every
 * other exception (including HttpException) keeps Nest's default behaviour and
 * response shape, so existing clients are unaffected.
 */
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientValidationError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    exception:
      Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientValidationError,
    host: ArgumentsHost,
  ) {
    const res = host.switchToHttp().getResponse<Response>();
    const { statusCode, message, error } = this.map(exception);

    if (statusCode >= 500) {
      this.logger.error(exception.message);
    } else {
      this.logger.warn(`${statusCode}: ${exception.message.split('\n').pop()}`);
    }

    res.status(statusCode).json({ statusCode, message, error });
  }

  private map(
    e:
      Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientValidationError,
  ): { statusCode: number; message: string; error: string } {
    if (e instanceof Prisma.PrismaClientValidationError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid or missing data in request',
        error: 'Bad Request',
      };
    }

    switch (e.code) {
      case 'P2002': {
        const target = (e.meta?.target as string[] | string | undefined) ?? [];
        const fields = Array.isArray(target) ? target.join(', ') : target;
        return {
          statusCode: HttpStatus.CONFLICT,
          message: fields
            ? `A record with this ${fields} already exists`
            : 'A record with these details already exists',
          error: 'Conflict',
        };
      }
      case 'P2003':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'A referenced record does not exist',
          error: 'Bad Request',
        };
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Record not found',
          error: 'Not Found',
        };
      case 'P2000':
      case 'P2011':
      case 'P2012':
      case 'P2013':
      case 'P2020':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Invalid or missing data in request',
          error: 'Bad Request',
        };
      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
          error: 'Internal Server Error',
        };
    }
  }
}
