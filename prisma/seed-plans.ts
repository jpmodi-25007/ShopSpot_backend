import { PrismaClient, SubscriptionTier } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const plans = [
    {
      tier: SubscriptionTier.FREE,
      name: 'Free',
      tagline: 'Get your shop online in minutes — zero cost, zero risk',
      price: 0,
      yearlyPrice: null,
      productLimit: 50,
      eventLimit: 0,
      features: [
        'Up to 50 products',
        'Basic shop profile',
        'WhatsApp & call inquiries',
        'Order & reservation management',
        'Basic analytics',
        'Standard search listing',
      ],
      isActive: true,
      isHighlighted: false,
      sortOrder: 0,
    },
    {
      tier: SubscriptionTier.PRO,
      name: 'Pro',
      tagline: 'Grow your reach — promote events, attract more customers',
      price: 499,
      yearlyPrice: 4788,
      productLimit: 200,
      eventLimit: 1,
      features: [
        'Up to 200 products',
        '1 promoted event/month on home screen',
        'Advanced analytics',
        '🔵 Pro badge on shop listing',
        '20% higher search ranking',
        'Customer chat enabled',
        'Promotional banner in nearby feed',
        'Auto GST invoice',
      ],
      isActive: true,
      isHighlighted: true,
      sortOrder: 1,
    },
    {
      tier: SubscriptionTier.PREMIUM,
      name: 'Premium',
      tagline: 'Dominate your locality — maximum visibility, maximum sales',
      price: 1199,
      yearlyPrice: 11508,
      productLimit: 500,
      eventLimit: 3,
      features: [
        'Up to 500 products',
        'Up to 3 events/promotions on home carousel',
        'Full analytics suite',
        '👑 Premium gold badge',
        '50% search boost + category top-3',
        'Influencer campaigns (2/month)',
        'Full-width home screen banner',
        'Price negotiation feature',
        'Bulk CSV inventory upload',
        'Stock alerts',
        'Auto GST invoice',
        'Early access to new features',
      ],
      isActive: true,
      isHighlighted: false,
      sortOrder: 2,
    },
  ];

  for (const plan of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { tier: plan.tier },
      update: plan,
      create: plan,
    });
  }
  console.log('Plans seeded successfully');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
