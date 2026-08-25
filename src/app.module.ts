import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ShopsModule } from './modules/shops/shops.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ProductsModule } from './modules/products/products.module';
import { NegotiationsModule } from './modules/negotiations/negotiations.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { OrdersModule } from './modules/orders/orders.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { InfluencerModule } from './modules/influencer/influencer.module';
import { AdminModule } from './modules/admin/admin.module';
import { CloudinaryModule } from './modules/cloudinary/cloudinary.module';
import { WebsocketModule } from './modules/websocket/websocket.module';
import { SearchModule } from './modules/search/search.module';
import { SavedModule } from './modules/saved/saved.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { RetailerInventoryModule } from './modules/retailer-inventory/retailer-inventory.module';
import { PromotionsModule } from './promotions/promotions.module';
import { EventsModule } from './events/events.module';

@Module({
  imports: [
    // Config — available globally
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Rate limiting: 100 req/min per user
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: () => ({
        throttlers: [
          { name: 'short', ttl: 1000, limit: 20 },
          { name: 'medium', ttl: 60000, limit: 100 },
        ],
      }),
    }),

    // Cron scheduler (reservation expiry, etc.)
    ScheduleModule.forRoot(),

    // BullMQ — async job queues
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),

    // Core
    PrismaModule,

    // Feature modules
    AuthModule,
    UsersModule,
    ShopsModule,
    CategoriesModule,
    ProductsModule,
    NegotiationsModule,
    ReservationsModule,
    ReviewsModule,
    OrdersModule,
    SubscriptionsModule,
    AnalyticsModule,
    NotificationsModule,
    InfluencerModule,
    AdminModule,
    CloudinaryModule,
    WebsocketModule,
    SearchModule,
    SavedModule,
    AddressesModule,
    RetailerInventoryModule,
    PromotionsModule,
    EventsModule,
  ],
})
export class AppModule {}
