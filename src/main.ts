import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import compression = require('compression');

import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import {
  isOriginAllowed,
  parseCorsOrigins,
} from './common/helpers/cors.helper';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'warn', 'error', 'verbose'],
  });

  // Serve static uploads
  app.useStaticAssets(join(process.cwd(), 'public'), {
    prefix: '/',
  });

  const configService = app.get(ConfigService);

  // Security
  app.use(helmet());
  app.use(compression());

  // The API runs behind a reverse proxy (Render). Trusting one hop makes
  // req.ip (used by the rate limiter) the real client IP instead of the proxy.
  app.set('trust proxy', configService.get('TRUST_PROXY', 1));

  // CORS
  const corsOrigins = parseCorsOrigins(
    configService.get<string>('CORS_ORIGINS', 'http://localhost:3000'),
  );
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g., mobile apps, curl)
      if (!origin) return callback(null, true);

      if (isOriginAllowed(origin, corsOrigins)) {
        callback(null, true);
      } else {
        // Answer without CORS headers (the browser blocks the response) instead of
        // raising an error, which surfaced as HTTP 500 and noisy error logs.
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  });

  // Global prefix
  const apiPrefix = configService.get<string>('API_PREFIX', 'api/v1');
  app.setGlobalPrefix(apiPrefix);

  // Global pipes — strict DTO validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Swagger docs
  if (configService.get('NODE_ENV') !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Findivo API')
      .setDescription(
        "India's Local Product Discovery & Advertising Platform — REST API",
      )
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .addTag('Auth')
      .addTag('Users')
      .addTag('Shops')
      .addTag('Products')
      .addTag('Negotiations')
      .addTag('Reservations')
      .addTag('Orders')
      .addTag('Reviews')
      .addTag('Influencer')
      .addTag('Analytics')
      .addTag('Notifications')
      .addTag('Admin')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // Graceful shutdown: close Prisma / sockets on SIGTERM (Render deploys).
  app.enableShutdownHooks();

  const port = configService.get<number>('PORT', 3001);
  await app.listen(port, '0.0.0.0');
  console.log(`\n🚀 Findivo API running at: http://localhost:${port}/api/v1`);
  console.log(`📚 Swagger docs at: http://localhost:${port}/api/docs\n`);
}

// A failed fire-and-forget promise (for example a push notification) must be
// logged, not take the whole API process down.
process.on('unhandledRejection', (reason) => {
  new Logger('UnhandledRejection').error(
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
  );
});

bootstrap();
