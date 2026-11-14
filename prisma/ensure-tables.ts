import { Client } from 'pg';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')) {
    console.log('Local/unset DATABASE_URL, skipping ensure-tables.');
    return;
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL database for schema preparation.');

    // 1. Ensure SubscriptionTier enum exists and contains PRO
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionTier') THEN
          CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'BASIC', 'PRO', 'PREMIUM', 'ELITE');
        ELSE
          BEGIN
            ALTER TYPE "SubscriptionTier" ADD VALUE IF NOT EXISTS 'PRO';
          EXCEPTION
            WHEN duplicate_object THEN null;
          END;
        END IF;
      END $$;
    `);
    console.log('✓ SubscriptionTier enum verified.');

    // 2. Ensure subscription_plans table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS "subscription_plans" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "tier" "SubscriptionTier" NOT NULL UNIQUE,
        "name" TEXT NOT NULL,
        "tagline" TEXT NOT NULL,
        "price" DECIMAL(10, 2) NOT NULL,
        "yearlyPrice" DECIMAL(10, 2),
        "productLimit" INTEGER NOT NULL,
        "eventLimit" INTEGER NOT NULL DEFAULT 0,
        "features" JSONB NOT NULL DEFAULT '[]'::jsonb,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "isHighlighted" BOOLEAN NOT NULL DEFAULT false,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ subscription_plans table ensured.');

    // 3. Ensure razorpay_orders table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS "razorpay_orders" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "shopId" TEXT NOT NULL,
        "planId" TEXT NOT NULL,
        "razorpayOrderId" TEXT NOT NULL UNIQUE,
        "amount" DECIMAL(10, 2) NOT NULL,
        "currency" TEXT NOT NULL DEFAULT 'INR',
        "status" TEXT NOT NULL DEFAULT 'created',
        "paymentId" TEXT,
        "signature" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ razorpay_orders table ensured.');

    // 4. Ensure Shop table has eventsUsedThisMonth and eventsResetAt
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "eventsUsedThisMonth" INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "eventsResetAt" TIMESTAMP(3);
      EXCEPTION WHEN OTHERS THEN null;
      END $$;
    `);
    console.log('✓ Shop event quota columns ensured.');

    // 5. Ensure subscriptions table has planId and razorpaySubId
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "planId" TEXT;
        ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "razorpaySubId" TEXT;
        ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "productLimit" INTEGER NOT NULL DEFAULT 50;
      EXCEPTION WHEN OTHERS THEN null;
      END $$;
    `);
    console.log('✓ subscriptions table columns ensured.');

    await client.end();
    console.log('Database preparation finished successfully.');
  } catch (err) {
    console.warn('ensure-tables warning (continuing build):', err);
    try {
      await client.end();
    } catch (_) {}
  }
}

main();

