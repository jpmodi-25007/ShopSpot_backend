import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'warn', 'error']
          : ['warn', 'error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Utility for soft-delete pattern — exclude soft-deleted records
   */
  async cleanDb() {
    if (process.env.NODE_ENV === 'test') {
      // Only for test environment — truncate all tables
      await this.$executeRaw`TRUNCATE TABLE users CASCADE`;
    }
  }
}
