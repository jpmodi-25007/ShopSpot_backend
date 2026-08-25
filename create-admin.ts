import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@findivo.com';
  const password = 'Jaymodi@2507';
  
  const existingAdmin = await prisma.user.findUnique({
    where: { email },
  });

  if (existingAdmin) {
    console.log(`Admin ${email} already exists. Updating password and role...`);
    const hashed = await argon2.hash(password);
    await prisma.user.update({
      where: { email },
      data: {
        password: hashed,
        role: UserRole.ADMIN,
      },
    });
    console.log('Admin user updated successfully.');
  } else {
    console.log(`Creating new admin user ${email}...`);
    const hashed = await argon2.hash(password);
    await prisma.user.create({
      data: {
        email,
        password: hashed,
        name: 'Admin',
        role: UserRole.ADMIN,
        isEmailVerified: true,
      },
    });
    console.log('Admin user created successfully.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
