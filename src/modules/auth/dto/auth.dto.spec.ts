import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterEmailDto, RegisterMobileDto } from './auth.dto';

const errorsFor = async (cls: any, body: object) =>
  validate(plainToInstance(cls, body));

describe('registration role validation', () => {
  const base = { password: 'SecurePass@123', name: 'Test' };

  it.each(['CUSTOMER', 'SHOPKEEPER', 'INFLUENCER'])(
    'accepts %s for email registration',
    async (role) => {
      const errors = await errorsFor(RegisterEmailDto, {
        ...base,
        email: 'a@b.com',
        role,
      });
      expect(errors).toHaveLength(0);
    },
  );

  it('rejects ADMIN for email registration', async () => {
    const errors = await errorsFor(RegisterEmailDto, {
      ...base,
      email: 'a@b.com',
      role: 'ADMIN',
    });
    expect(errors.some((e) => e.property === 'role')).toBe(true);
  });

  it('rejects ADMIN for mobile registration', async () => {
    const errors = await errorsFor(RegisterMobileDto, {
      ...base,
      mobile: '+919876543210',
      role: 'ADMIN',
    });
    expect(errors.some((e) => e.property === 'role')).toBe(true);
  });
});
