import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const passwordHash = await argon2.hash('Password123!');

  // 1. Create Admin
  const admin = await prisma.user.upsert({
    where: { email: 'admin@shopspot.in' },
    update: {},
    create: {
      email: 'admin@shopspot.in',
      password: passwordHash,
      name: 'Super Admin',
      role: UserRole.ADMIN,
    },
  });
  console.log(`✅ Admin created: ${admin.email}`);

  // 2. Create Categories
  const categoriesToCreate = [
    { name: 'Electronics', slug: 'electronics', iconUrl: 'https://cdn-icons-png.flaticon.com/512/1261/1261184.png' },
    { name: 'Fashion', slug: 'fashion', iconUrl: 'https://cdn-icons-png.flaticon.com/512/3159/3159614.png' },
    { name: 'Food & Beverage', slug: 'food-beverage', iconUrl: 'https://cdn-icons-png.flaticon.com/512/1046/1046771.png' },
    { name: 'Home & Garden', slug: 'home-garden', iconUrl: 'https://cdn-icons-png.flaticon.com/512/619/619056.png' },
    { name: 'Beauty & Health', slug: 'beauty-health', iconUrl: 'https://cdn-icons-png.flaticon.com/512/2916/2916298.png' },
    { name: 'Sports & Outdoors', slug: 'sports-outdoors', iconUrl: 'https://cdn-icons-png.flaticon.com/512/857/857418.png' },
    { name: 'Automotive', slug: 'automotive', iconUrl: 'https://cdn-icons-png.flaticon.com/512/3085/3085330.png' },
    { name: 'Books & Stationery', slug: 'books-stationery', iconUrl: 'https://cdn-icons-png.flaticon.com/512/3145/3145765.png' },
    { name: 'Toys & Games', slug: 'toys-games', iconUrl: 'https://cdn-icons-png.flaticon.com/512/2699/2699042.png' },
    { name: 'Services', slug: 'services', iconUrl: 'https://cdn-icons-png.flaticon.com/512/2910/2910791.png' },
  ];

  let category1: any;
  for (const cat of categoriesToCreate) {
    const createdCat = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: {
        name: cat.name,
        slug: cat.slug,
        iconUrl: cat.iconUrl,
        isActive: true,
      },
    });
    if (cat.slug === 'electronics') {
      category1 = createdCat;
    }
  }
  console.log(`✅ Categories created`);

  // 3. Create Shopkeeper & Shop
  const shopkeeper = await prisma.user.upsert({
    where: { email: 'shop@example.com' },
    update: {},
    create: {
      email: 'shop@example.com',
      mobile: '+919876543210',
      password: passwordHash,
      name: 'Ramesh (Shopkeeper)',
      role: UserRole.SHOPKEEPER,
      shop: {
        create: {
          name: 'Ramesh Electronics',
          slug: 'ramesh-electronics',
          address: 'MG Road, Bangalore',
          city: 'Bangalore',
          isKycVerified: true,
          latitude: 12.9716,
          longitude: 77.5946,
        },
      },
    },
  });
  console.log(`✅ Shopkeeper & Shop created`);

  // 4. Create Product for the Shop
  const shop = await prisma.shop.findUnique({ where: { ownerId: shopkeeper.id } });
  if (shop) {
    await prisma.product.create({
      data: {
        shopId: shop.id,
        categoryId: category1.id,
        name: 'Sony WH-1000XM5 Wireless Headphones',
        slug: 'sony-wh-1000xm5',
        description: 'Industry leading noise canceling headphones',
        mrp: 29990,
        sellingPrice: 24990,
        stockStatus: 'IN_STOCK',
      },
    });
    console.log(`✅ Product created`);
  }

  // 5. Create Influencer
  await prisma.user.upsert({
    where: { email: 'creator@example.com' },
    update: {},
    create: {
      email: 'creator@example.com',
      mobile: '+919876543211',
      password: passwordHash,
      name: 'Priya (Influencer)',
      role: UserRole.INFLUENCER,
      influencerProfile: {
        create: {
          displayName: 'Priya Vlogs',
          username: 'priya_vlogs',
          bio: 'Tech and Fashion enthusiast from Bangalore',
          city: 'Bangalore',
          instagramUrl: 'https://instagram.com/priya_vlogs',
          followers: 150000,
          categories: ['Electronics', 'Fashion'],
          verificationStatus: 'VERIFIED',
        },
      },
    },
  });
  console.log(`✅ Influencer created`);

  console.log('🎉 Database seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
