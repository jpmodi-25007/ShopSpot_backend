import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Bootstraps the first admin account.
 *
 * Credentials are read from the environment so that nothing sensitive lives in
 * source control:
 *
 *   ADMIN_EMAIL           (default: admin@findivo.com)
 *   ADMIN_PASSWORD        (required to create an admin; script is a no-op without it)
 *   ADMIN_RESET_PASSWORD  ("true" to overwrite the password of an existing admin)
 *
 * An existing admin's password is never overwritten on a normal deploy.
 */
const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL || 'admin@findivo.com')
    .toLowerCase()
    .trim();
  const password = process.env.ADMIN_PASSWORD;
  const resetPassword = process.env.ADMIN_RESET_PASSWORD === 'true';

  const existingAdmin = await prisma.user.findUnique({ where: { email } });

  if (existingAdmin) {
    if (resetPassword && password) {
      console.log(`Admin ${email} exists. Resetting password and role...`);
      await prisma.user.update({
        where: { email },
        data: {
          password: await argon2.hash(password),
          role: UserRole.ADMIN,
        },
      });
      console.log('Admin user updated successfully.');
    } else {
      if (existingAdmin.role !== UserRole.ADMIN) {
        await prisma.user.update({
          where: { email },
          data: { role: UserRole.ADMIN },
        });
      }
      console.log(
        `Admin ${email} already exists. Password left unchanged (set ADMIN_RESET_PASSWORD=true with ADMIN_PASSWORD to reset).`,
      );
    }
    return;
  }

  if (!password) {
    console.warn(
      'ADMIN_PASSWORD is not set; skipping admin bootstrap. Set ADMIN_PASSWORD (and optionally ADMIN_EMAIL) to create the first admin.',
    );
    return;
  }

  console.log(`Creating new admin user ${email}...`);
  await prisma.user.create({
    data: {
      email,
      password: await argon2.hash(password),
      name: 'Admin',
      role: UserRole.ADMIN,
      isEmailVerified: true,
    },
  });
  console.log('Admin user created successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
