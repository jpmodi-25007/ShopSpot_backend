import {
  omitPrivateShopFields,
  scrubNestedShops,
  stripSecrets,
} from './sanitize.helper';

describe('sanitize helpers', () => {
  it('stripSecrets removes password/reset fields at any depth', () => {
    const payload = {
      id: 1,
      password: 'hash',
      owner: { id: 2, password: 'hash2', resetCode: 'abc', name: 'A' },
      list: [{ resetCodeExpiresAt: new Date(), resetAttempts: 1, ok: true }],
      createdAt: new Date('2026-01-01'),
    };
    const out: any = stripSecrets(payload);
    expect(out.password).toBeUndefined();
    expect(out.owner.password).toBeUndefined();
    expect(out.owner.resetCode).toBeUndefined();
    expect(out.owner.name).toBe('A');
    expect(out.list[0].resetCodeExpiresAt).toBeUndefined();
    expect(out.list[0].resetAttempts).toBeUndefined();
    expect(out.list[0].ok).toBe(true);
    // Dates are left untouched
    expect(out.createdAt).toBeInstanceOf(Date);
  });

  it('omitPrivateShopFields hides KYC/tax data but keeps public data', () => {
    const shop = {
      id: 's1',
      name: 'Shop',
      email: 'shop@example.com',
      gstNumber: '22AAAAA0000A1Z5',
      verificationDocuments: { pan: 'x' },
    };
    const out: any = omitPrivateShopFields(shop);
    expect(out.gstNumber).toBeUndefined();
    expect(out.verificationDocuments).toBeUndefined();
    expect(out.name).toBe('Shop');
    expect(out.email).toBe('shop@example.com');
    // does not mutate the source object
    expect(shop.gstNumber).toBeDefined();
  });

  it('scrubNestedShops cleans shops nested in query results', () => {
    const events: any = [
      { id: 'e1', shop: { id: 's1', gstNumber: 'x', name: 'N' } },
      { id: 'e2', shop: null },
    ];
    scrubNestedShops(events);
    expect(events[0].shop.gstNumber).toBeUndefined();
    expect(events[0].shop.name).toBe('N');
    expect(events[1].shop).toBeNull();
  });
});
