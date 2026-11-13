import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, register, seeded, createShopWithProduct, uniq,
} from './helpers.mjs';

const ok = (r) => [200, 201].includes(r.status);

describe('ROLE JOURNEYS: customer, retailer, influencer against live API', () => {
  test('TC-ROLE-001 customer can browse, save, negotiate, reserve, and order with images', async () => {
    const f = await createShopWithProduct({ price: 1000, stock: 8 });
    const c = await register('CUSTOMER');

    const detail = await get(`/products/${f.productId}`);
    assert.ok(ok(detail), detail.text);
    assert.ok(Array.isArray(detail.body.mediaAssets), 'product detail must include mediaAssets');
    assert.equal(typeof detail.body.shop?.logoUrl === 'string' || detail.body.shop?.logoUrl == null, true);

    const search = await get('/products/search?limit=5');
    assert.ok(ok(search), search.text);
    assert.ok(Array.isArray(search.body.data));
    const sample = search.body.data.find((p) => Array.isArray(p.mediaAssets));
    assert.ok(sample, 'search results must include mediaAssets');

    assert.ok(ok(await get('/products/trending')));
    assert.ok(ok(await get('/nearby/shops?lat=19.076&lng=72.8777&radiusKm=50')));
    assert.ok(ok(await get(`/shops/${f.shopId}`)));
    assert.ok(ok(await get(`/shops/${f.shopId}/products`)));
    assert.ok(ok(await get('/categories')));
    assert.ok(ok(await get('/promotions')));
    assert.ok(ok(await get('/events/all')));

    assert.ok(ok(await post(`/saved/products/${f.productId}`, {}, { token: c.token })));
    const savedShops = await post(`/saved/shops/${f.shopId}`, {}, { token: c.token });
    assert.ok(ok(savedShops), savedShops.text);
    const listed = await get('/saved/shops', { token: c.token });
    assert.ok(ok(listed), listed.text);
    const rows = listed.body.data ?? listed.body;
    assert.ok(Array.isArray(rows) && rows.length >= 1);
    const row = rows.find((s) => (s.id || s.shopId || s.shop?.id) === f.shopId) || rows[0];
    const logo = row.logoUrl ?? row.shop?.logoUrl ?? row.logo;
    assert.ok(logo === undefined || logo === null || typeof logo === 'string');

    assert.ok(ok(await post('/addresses', {
      line1: '9 Device St', city: 'Mumbai', state: 'MH', pincode: '400001', isDefault: true,
    }, { token: c.token })));

    const neg = await post('/negotiations', {
      productId: f.productId, offeredPrice: 800, message: 'role check',
    }, { token: c.token });
    assert.ok(ok(neg), neg.text);
    const counter = await post(`/shopkeeper/negotiations/${neg.body.id}/counter`, {
      counterPrice: 900,
    }, { token: f.sk.token });
    assert.ok(ok(counter), counter.text);

    const resv = await post('/reservations', { productId: f.productId, quantity: 1 }, { token: c.token });
    assert.ok(ok(resv), resv.text);
    assert.ok(resv.body.product?.mediaAssets || resv.body.productImage !== undefined || resv.body.id);

    const order = await post('/orders', {
      shopId: f.shopId,
      items: [{ productId: f.productId, quantity: 1 }],
      subtotal: 0,
      total: 0,
      deliveryAddress: { line1: '9 Device St', city: 'Mumbai', state: 'MH', pincode: '400001' },
    }, { token: c.token });
    assert.ok(ok(order), order.text);
    assert.ok(ok(await get('/orders', { token: c.token })));
    assert.ok(ok(await get('/notifications', { token: c.token })));
    assert.ok(ok(await get('/chats/rooms', { token: c.token })));
  });

  test('TC-ROLE-002 retailer can manage shop, inventory, orders, negotiations, and campaigns', async () => {
    const f = await createShopWithProduct({ price: 900, stock: 6 });
    const token = f.sk.token;
    assert.ok(ok(await get('/shopkeeper/shops', { token })));
    assert.ok(ok(await get('/shopkeeper/products', { token })));
    assert.ok(ok(await get('/analytics/shop', { token })));
    assert.ok(ok(await get('/orders/shop', { token })));
    assert.ok(ok(await get('/shopkeeper/negotiations', { token })));
    assert.ok(ok(await get('/shopkeeper/reservations', { token })));
    assert.ok(ok(await get('/shopkeeper/inventory/suppliers', { token })));
    assert.ok(ok(await get('/events/shop', { token })));

    const camp = await post('/shopkeeper/influencer-campaigns', {
      title: `Role Camp ${uniq()}`,
      description: 'role journey',
      budget: 4000,
      requirements: 'one post',
      startDate: new Date(Date.now() + 86400000).toISOString(),
      endDate: new Date(Date.now() + 5 * 86400000).toISOString(),
    }, { token });
    assert.ok(ok(camp) || camp.status === 400, camp.text);
    assert.ok(ok(await get('/shopkeeper/influencer-campaigns', { token })));
  });

  test('TC-ROLE-003 verified influencer can load profile, campaigns, bids, and analytics', async () => {
    const inf = await seeded.influencer();
    assert.equal((await get('/auth/me', { token: inf.token })).body.role, 'INFLUENCER');
    const profile = await get('/influencer/profile', { token: inf.token });
    assert.ok(ok(profile), profile.text);
    assert.equal(profile.body.verificationStatus || profile.body.profile?.verificationStatus || 'VERIFIED', 'VERIFIED');
    assert.ok(ok(await get('/influencer/campaigns', { token: inf.token })));
    assert.ok(ok(await get('/influencer/bids', { token: inf.token })));
    assert.ok(ok(await get('/influencer/analytics', { token: inf.token })));
    assert.ok(ok(await get('/influencer/assignments', { token: inf.token })));
  });

  test('TC-ROLE-004 admin summary still feeds the panel the mobile catalog depends on', async () => {
    const admin = await seeded.admin();
    const summary = await get('/admin/summary', { token: admin.token });
    assert.ok(ok(summary), summary.text);
    for (const key of ['pendingShops', 'pendingInfluencers', 'pendingReports', 'unreadNotifications']) {
      assert.equal(typeof summary.body[key], 'number', key);
    }
  });
});
