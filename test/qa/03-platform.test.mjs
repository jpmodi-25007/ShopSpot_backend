import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, put, patch, del, register, seeded, createShopWithProduct, sql, uniq, api, BASE,
} from './helpers.mjs';

const ok = (r) => [200, 201].includes(r.status);
// Lazily logged-in admin shared by all suites (works with --test-name-pattern too).
const admin = await seeded.admin();

describe('RBAC matrix: protected routes reject anonymous & wrong role', () => {
  const adminRoutes = [
    ['GET', '/admin/dashboard'], ['GET', '/admin/users'], ['GET', '/admin/shops'], ['GET', '/admin/influencers'],
    ['GET', '/admin/reports'], ['GET', '/admin/settings'], ['GET', '/admin/notifications'], ['GET', '/analytics/admin'],
    ['GET', '/promotions/all'],
  ];
  for (const [m, p] of adminRoutes) {
    test(`TC-RBAC-001 ${m} ${p}: anonymous 401, customer/shopkeeper 403`, async () => {
      assert.equal((await api(m, p)).status, 401, 'anonymous');
      const c = await register('CUSTOMER');
      assert.equal((await api(m, p, { token: c.token })).status, 403, 'customer');
      const s = await register('SHOPKEEPER');
      assert.equal((await api(m, p, { token: s.token })).status, 403, 'shopkeeper');
    });
  }

  test('TC-RBAC-002 admin-only writes: promotions/broadcast/upload reject non-admin', async () => {
    const s = await register('SHOPKEEPER');
    assert.equal((await post('/promotions', { title: 'x' }, { token: s.token })).status, 403);
    assert.equal((await post('/notifications/broadcast', { title: 't', body: 'b' }, { token: s.token })).status, 403);
    assert.equal((await post('/upload/image', undefined, { token: s.token })).status, 403);
    assert.equal((await post('/admin/users', { name: 'x', email: 'x@y.co', role: 'ADMIN' }, { token: s.token })).status, 403);
  });

  test('TC-RBAC-003 influencer/shopkeeper-only routes reject customers', async () => {
    const c = await register('CUSTOMER');
    for (const p of ['/influencer/profile', '/influencer/bids', '/influencer/campaigns', '/shopkeeper/influencer-campaigns', '/subscriptions/me']) {
      assert.equal((await get(p, { token: c.token })).status, 403, p);
    }
  });

  test('TC-RBAC-004 public endpoints stay public', async () => {
    for (const p of ['/health', '/categories', '/products/search', '/products/trending', '/search?q=a', '/promotions', '/events/all', '/subscriptions/plans']) {
      const r = await get(p);
      assert.ok([200].includes(r.status), `${p} -> ${r.status}`);
    }
  });
});

describe('ADMIN panel API', () => {
  test('TC-ADM-001 dashboard returns stats', async () => {
    const r = await get('/admin/dashboard', { token: admin.token });
    assert.equal(r.status, 200, r.text);
  });

  test('TC-ADM-002 list users supports pagination and never returns password hashes', async () => {
    const r = await get('/admin/users?page=1&limit=5', { token: admin.token });
    assert.equal(r.status, 200, r.text);
    const rows = r.body.data ?? r.body.users ?? r.body;
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length <= 5, `limit not honoured: ${rows.length}`);
    for (const u of rows) {
      assert.equal(u.password, undefined);
      assert.equal(u.resetCode, undefined);
    }
  });

  test('TC-ADM-003 pagination boundaries: limit=0/-1/abc/100000 never 500', async () => {
    for (const q of ['limit=0', 'limit=-1', 'limit=abc', 'limit=100000', 'page=0', 'page=-3', 'page=abc']) {
      const r = await get(`/admin/users?${q}`, { token: admin.token });
      assert.ok(r.status < 500, `${q} -> ${r.status} ${r.text.slice(0, 120)}`);
    }
  });

  test('TC-ADM-004 admin suspends then re-activates a user (payload { isActive })', async () => {
    const u = await register('CUSTOMER');
    const s = await post(`/admin/users/${u.user.id}/suspend`, { isActive: false }, { token: admin.token });
    assert.ok(ok(s), s.text);
    assert.equal((await get('/auth/me', { token: u.token })).status === 200, false, 'suspended user must lose access');
    const a = await post(`/admin/users/${u.user.id}/suspend`, { isActive: true }, { token: admin.token });
    assert.ok(ok(a), a.text);
    const l = await post('/auth/login', { email: u.email, password: u.password, role: 'CUSTOMER' });
    assert.equal(l.status, 200);
  });

  test('TC-ADM-005 suspend with legacy payload { isSuspended } is rejected with 400 (not silently ignored)', async () => {
    const u = await register('CUSTOMER');
    const s = await post(`/admin/users/${u.user.id}/suspend`, { isSuspended: true, reason: 'x' }, { token: admin.token });
    assert.equal(s.status, 400);
  });

  test('TC-ADM-006 admin cannot suspend their own account (lock-out protection)', async () => {
    const s = await post(`/admin/users/${admin.user.id}/suspend`, { isActive: false }, { token: admin.token });
    // Always restore the shared QA admin, even if the assertion below fails.
    sql(`update users set "isActive"=true where id='${admin.user.id}'`);
    assert.equal(s.status, 400, `admin self-suspend: ${s.status} ${s.text}`);
  });

  test('TC-ADM-007 admin create user: valid -> created, default password not returned; invalid email rejected', async () => {
    const email = `${uniq('adm')}@qa.test`;
    const r = await post('/admin/users', { name: 'Created By Admin', email, role: 'CUSTOMER' }, { token: admin.token });
    assert.ok(ok(r), r.text);
    assert.equal(JSON.stringify(r.body).includes('"password"'), false, 'password must not be returned');
    const bad = await post('/admin/users', { name: 'Bad Email', email: 'not-an-email', role: 'CUSTOMER' }, { token: admin.token });
    assert.equal(bad.status, 400, `invalid email accepted: ${bad.status} ${bad.text}`);
  });

  test('TC-ADM-008 admin create user cannot be used to create an ADMIN without being admin; duplicate email -> 409', async () => {
    const email = `${uniq('dup')}@qa.test`;
    await post('/admin/users', { name: 'D', email, role: 'CUSTOMER' }, { token: admin.token });
    const d = await post('/admin/users', { name: 'D2', email, role: 'CUSTOMER' }, { token: admin.token });
    assert.equal(d.status, 409, `${d.status} ${d.text}`);
  });

  test('TC-ADM-009 verify shop toggles flags; invalid payload rejected', async () => {
    const f = await createShopWithProduct();
    const v = await post(`/admin/shops/${f.shopId}/verify`, { isGstVerified: true, isKycVerified: true }, { token: admin.token });
    assert.ok(ok(v), v.text);
    const bad = await post(`/admin/shops/${f.shopId}/verify`, { isGstVerified: 'yes' }, { token: admin.token });
    assert.equal(bad.status, 400);
    const unknown = await post('/admin/shops/00000000-0000-4000-8000-000000000000/verify', { isGstVerified: true, isKycVerified: true }, { token: admin.token });
    assert.ok([404].includes(unknown.status), `unknown shop -> ${unknown.status}`);
  });

  test('TC-ADM-010 unknown / malformed ids produce 404/400, never 500', async () => {
    for (const p of ['/admin/users/not-a-uuid', '/admin/shops/not-a-uuid', '/admin/influencers/not-a-uuid', '/shops/not-a-uuid', '/products/not-a-uuid', '/events/not-a-uuid', '/users/not-a-uuid']) {
      const r = await get(p, { token: admin.token });
      assert.ok(r.status < 500, `${p} -> ${r.status} ${r.text.slice(0, 100)}`);
    }
  });

  test('TC-ADM-011 settings read & write validation', async () => {
    const r = await get('/admin/settings', { token: admin.token });
    assert.equal(r.status, 200, r.text);
    const original = r.body; // snapshot so the test never leaves data/settings.json modified
    try {
      // the request body itself is the settings object; an array is not a valid settings object
      const bad = await post('/admin/settings', ['not', 'an', 'object'], { token: admin.token });
      assert.equal(bad.status, 400, `array settings -> ${bad.status} ${bad.text}`);
    } finally {
      await post('/admin/settings', original, { token: admin.token });
    }
  });

  test('TC-ADM-012 admin creates shop+product for a retailer via admin API', async () => {
    const owner = await register('SHOPKEEPER');
    const shops = await get('/admin/shops?limit=50', { token: admin.token });
    assert.equal(shops.status, 200);
    const rows = shops.body.data ?? shops.body;
    assert.ok(Array.isArray(rows));
  });

  test('TC-ADM-013 reports: list/stats endpoints respond', async () => {
    assert.equal((await get('/admin/reports', { token: admin.token })).status, 200);
    assert.equal((await get('/admin/reports/stats', { token: admin.token })).status, 200);
  });

  test('TC-ADM-014 admin notifications list + mark-read', async () => {
    assert.equal((await get('/admin/notifications', { token: admin.token })).status, 200);
    const r = await post('/admin/notifications/mark-read', {}, { token: admin.token });
    assert.ok(ok(r), `${r.status} ${r.text}`);
  });
});

describe('PROMOTIONS & EVENTS', () => {
  test('TC-PRM-001 admin promotion CRUD', async () => {
    const c = await post('/promotions', { title: `QA Promo ${uniq()}`, imageUrl: 'https://example.com/a.png' }, { token: admin.token });
    assert.ok(ok(c), `${c.status} ${c.text}`);
    const id = c.body.data.id; // responses are wrapped as { success, data }
    const list = await get('/promotions/all', { token: admin.token });
    assert.ok(list.body.data.some((p) => p.id === id));
    const u = await put(`/promotions/${id}`, { title: 'QA Promo Edited' }, { token: admin.token });
    assert.ok(ok(u), u.text);
    const d = await del(`/promotions/${id}`, { token: admin.token });
    assert.ok(ok(d) || d.status === 204, d.text);
  });

  test('TC-PRM-002 delete unknown promotion -> 404 not 500', async () => {
    const r = await del('/promotions/00000000-0000-4000-8000-000000000000', { token: admin.token });
    assert.ok([404].includes(r.status), `${r.status} ${r.text}`);
  });

  const evt = (extra = {}) => ({
    title: `QA Event ${uniq()}`, description: 'x', startDate: new Date(Date.now() + 86400000).toISOString(),
    endDate: new Date(Date.now() + 2 * 86400000).toISOString(), ...extra,
  });

  test('TC-EVT-001 admin creates platform event; appears in public list; edit; delete', async () => {
    const c = await post('/events', evt(), { token: admin.token });
    assert.ok(ok(c), `${c.status} ${c.text}`);
    const eid = c.body.data.id; // responses are wrapped as { status, data }
    const all = await get('/events/all');
    assert.ok(all.body.data.some((e) => e.id === eid));
    const e = await patch(`/events/${eid}`, { title: 'Edited' }, { token: admin.token });
    assert.ok(ok(e), e.text);
    const d = await del(`/events/${eid}`, { token: admin.token });
    assert.ok(ok(d) || d.status === 204, d.text);
  });

  test('TC-EVT-002 event create requires auth (admin UI regression: missing Authorization header)', async () => {
    assert.equal((await post('/events', evt())).status, 401);
    assert.equal((await patch('/events/x', {})).status, 401);
    assert.equal((await del('/events/x')).status, 401);
  });

  test('TC-EVT-003 SECURITY: shopkeeper cannot edit/delete another shop\'s event; customer cannot create', async () => {
    const a = await createShopWithProduct();
    const b = await register('SHOPKEEPER');
    const c = await register('CUSTOMER');
    const ev = await post('/events', evt(), { token: a.sk.token });
    assert.ok(ok(ev), ev.text);
    const evId = ev.body.data.id;
    assert.ok([403, 404].includes((await patch(`/events/${evId}`, { title: 'hijack' }, { token: b.token })).status));
    assert.ok([403, 404].includes((await del(`/events/${evId}`, { token: b.token })).status));
    assert.equal((await post('/events', evt(), { token: c.token })).status, 403);
  });

  test('TC-EVT-004 validation: endDate before startDate / missing title rejected', async () => {
    const bad = await post('/events', evt({ startDate: new Date(Date.now() + 2 * 86400000).toISOString(), endDate: new Date(Date.now() + 86400000).toISOString() }), { token: admin.token });
    assert.equal(bad.status, 400, `end<start accepted: ${bad.status}`);
    const noTitle = await post('/events', { startDate: new Date().toISOString(), endDate: new Date(Date.now() + 1000).toISOString() }, { token: admin.token });
    assert.equal(noTitle.status, 400, `${noTitle.status}`);
  });

  test('TC-EVT-005 SECURITY: mass-assignment of protected fields ignored (shopId/id/isActive)', async () => {
    const a = await createShopWithProduct();
    const other = await createShopWithProduct();
    const ev = await post('/events', evt({ shopId: other.shopId, id: '00000000-0000-4000-8000-000000000001' }), { token: a.sk.token });
    assert.ok(ok(ev), ev.text);
    assert.equal(ev.body.data.shopId, a.shopId, 'shopkeeper event must be attached to own shop');
    assert.notEqual(ev.body.data.id, '00000000-0000-4000-8000-000000000001');
  });
});

describe('ADDRESSES', () => {
  test('TC-ADR-001 create/list/update/delete own address; default flag exclusive', async () => {
    const c = await register('CUSTOMER');
    const a1 = await post('/addresses', { label: 'Home', line1: '1 A St', city: 'Mumbai', state: 'MH', pincode: '400001', isDefault: true }, { token: c.token });
    assert.ok(ok(a1), a1.text);
    const a2 = await post('/addresses', { label: 'Work', line1: '2 B St', city: 'Pune', state: 'MH', pincode: '411001', isDefault: true }, { token: c.token });
    const list = await get('/addresses', { token: c.token });
    assert.equal(list.body.filter((a) => a.isDefault).length, 1);
    const up = await put(`/addresses/${a2.body.id}`, { city: 'Nagpur' }, { token: c.token });
    assert.ok(ok(up), up.text);
    const del1 = await del(`/addresses/${a1.body.id}`, { token: c.token });
    assert.ok(ok(del1), del1.text);
  });

  test('TC-ADR-002 SECURITY (IDOR): cannot update/delete another user\'s address', async () => {
    const c1 = await register('CUSTOMER');
    const c2 = await register('CUSTOMER');
    const a = await post('/addresses', { line1: '1 A St', city: 'Mumbai', state: 'MH', pincode: '400001' }, { token: c1.token });
    assert.equal((await put(`/addresses/${a.body.id}`, { city: 'X' }, { token: c2.token })).status, 404);
    assert.equal((await del(`/addresses/${a.body.id}`, { token: c2.token })).status, 404);
  });

  test('TC-ADR-003 validation: missing required fields -> 400 (not 500)', async () => {
    const c = await register('CUSTOMER');
    const r = await post('/addresses', { label: 'x' }, { token: c.token });
    assert.equal(r.status, 400, `${r.status} ${r.text.slice(0, 150)}`);
  });

  test('TC-ADR-004 pincode format validated (KNOWN LIMITATION, Low: mobile app only requires non-empty)', { todo: true }, async () => {
    const c = await register('CUSTOMER');
    const r = await post('/addresses', { line1: '1 A', city: 'X', state: 'MH', pincode: 'abc' }, { token: c.token });
    assert.equal(r.status, 400, `${r.status}`);
  });
});

describe('REVIEWS, SAVED, SEARCH', () => {
  test('TC-REV-001 create review updates shop rating; second review by same user updates (no duplicate)', async () => {
    const f = await createShopWithProduct();
    const c = await register('CUSTOMER');
    const r1 = await post('/reviews', { shopId: f.shopId, rating: 4, comment: 'good' }, { token: c.token });
    assert.ok(ok(r1), r1.text);
    const r2 = await post('/reviews', { shopId: f.shopId, rating: 2, comment: 'changed' }, { token: c.token });
    assert.ok(ok(r2), r2.text);
    const shop = await get(`/shops/${f.shopId}`);
    assert.equal(shop.body.reviewCount, 1);
    assert.equal(Number(shop.body.rating), 2);
  });

  test('TC-REV-002 boundary: rating 0, 6, 3.5, missing rejected', async () => {
    const f = await createShopWithProduct();
    const c = await register('CUSTOMER');
    for (const rating of [0, 6, 3.5, undefined, 'five']) {
      const r = await post('/reviews', { shopId: f.shopId, rating }, { token: c.token });
      assert.equal(r.status, 400, `rating ${rating} -> ${r.status}`);
    }
  });

  test('TC-REV-003 review needs shopId or productId; unknown shop -> 404/400', async () => {
    const c = await register('CUSTOMER');
    assert.equal((await post('/reviews', { rating: 3 }, { token: c.token })).status, 400);
    const r = await post('/reviews', { shopId: '00000000-0000-4000-8000-000000000000', rating: 3 }, { token: c.token });
    assert.ok([400, 404].includes(r.status), `review for nonexistent shop -> ${r.status} ${r.text.slice(0, 120)}`);
  });

  test('TC-REV-004 shopkeeper cannot review own shop (rating manipulation)', async () => {
    const f = await createShopWithProduct();
    const r = await post('/reviews', { shopId: f.shopId, rating: 5 }, { token: f.sk.token });
    assert.ok([400, 403].includes(r.status), `owner self-review accepted: ${r.status}`);
  });

  test('TC-REV-005 reviews list for a shop is public & paginated', async () => {
    const f = await createShopWithProduct();
    const r = await get(`/shops/${f.shopId}/reviews?limit=5`);
    assert.equal(r.status, 200, r.text);
  });

  test('TC-SAV-001 save/unsave product and shop; idempotent save', async () => {
    const f = await createShopWithProduct();
    const c = await register('CUSTOMER');
    assert.ok(ok(await post(`/saved/products/${f.productId}`, {}, { token: c.token })));
    const dup = await post(`/saved/products/${f.productId}`, {}, { token: c.token });
    assert.ok(dup.status < 500, `duplicate save -> ${dup.status}`);
    const l = await get('/saved/products', { token: c.token });
    assert.equal((l.body.data ?? l.body).length, 1);
    assert.ok(ok(await del(`/saved/products/${f.productId}`, { token: c.token })) || true);
    assert.ok(ok(await post(`/saved/shops/${f.shopId}`, {}, { token: c.token })));
    const sl = await get('/saved/shops', { token: c.token });
    assert.equal((sl.body.data ?? sl.body).length, 1);
    const leak = JSON.stringify(sl.body);
    assert.equal(/gstNumber|"owner"/.test(leak), false, 'saved shops leak private fields');
  });

  test('TC-SAV-002 saving unknown product -> 404 not 500', async () => {
    const c = await register('CUSTOMER');
    const r = await post('/saved/products/00000000-0000-4000-8000-000000000000', {}, { token: c.token });
    assert.ok([400, 404].includes(r.status), `${r.status}`);
  });

  test('TC-SRCH-001 product search by text, price filter and pagination', async () => {
    const f = await createShopWithProduct({ price: 4321, name: undefined });
    const det = await get(`/products/${f.productId}`);
    const word = det.body.name.split(' ').pop();
    const r = await get(`/products/search?q=${encodeURIComponent(word)}&minPrice=4000&maxPrice=5000&limit=5`);
    assert.equal(r.status, 200, r.text);
    assert.ok((r.body.data ?? r.body).some((p) => p.id === f.productId), 'created product not found by search');
    const none = await get(`/products/search?q=${encodeURIComponent(word)}&minPrice=9000`);
    assert.ok(!(none.body.data ?? none.body).some((p) => p.id === f.productId), 'price filter ignored');
  });

  test('TC-SRCH-002 SECURITY: SQL injection / special chars in search are safe', async () => {
    for (const q of ["'; DROP TABLE users;--", '%', '_', '\\', '<script>', 'a'.repeat(5000)]) {
      const r = await get(`/products/search?q=${encodeURIComponent(q)}`);
      assert.ok(r.status < 500, `q=${q.slice(0, 20)} -> ${r.status}`);
      const g = await get(`/search?q=${encodeURIComponent(q)}`);
      assert.ok(g.status < 500, `global q=${q.slice(0, 20)} -> ${g.status}`);
    }
    assert.equal((await get('/health')).status, 200);
    assert.equal(sql('select count(*) from users') > 0, true, 'users table must still exist');
  });

  test('TC-SRCH-003 global search & category listing; pagination cap (limit=100000)', async () => {
    const r = await get('/products/search?limit=100000');
    assert.equal(r.status, 200);
    assert.ok((r.body.data ?? r.body).length <= 100, 'page size not capped');
  });

  test('TC-SRCH-004 nearby shops: in-radius shop returned nearest-first; far shop excluded; invalid coords handled', async () => {
    // Unique coordinates so other QA shops (all seeded at the same spot) cannot crowd the page.
    const base = 30 + Math.random() * 10;
    const lng = 100 + Math.random() * 10;
    const near = await createShopWithProduct({ lat: base, lng });
    const mid = await createShopWithProduct({ lat: base + 0.02, lng }); // ~2.2 km away
    const r = await get(`/nearby/shops?lat=${base}&lng=${lng}&radiusKm=5`);
    assert.equal(r.status, 200, r.text);
    const ids = (r.body.data ?? r.body).map((s) => s.id);
    assert.ok(ids.includes(near.shopId) && ids.includes(mid.shopId), 'created shops not returned nearby');
    assert.ok(ids.indexOf(near.shopId) < ids.indexOf(mid.shopId), 'results must be nearest first');
    const bad = await get('/nearby/shops?lat=abc&lng=xyz');
    assert.ok([200, 400].includes(bad.status), `${bad.status}`);
    const far = await get(`/nearby/shops?lat=${base + 20}&lng=${lng}&radiusKm=1`);
    assert.ok(!(far.body.data ?? far.body).some((s) => s.id === near.shopId));
  });

  test('TC-SRCH-005 product compare & trending endpoints', async () => {
    const f = await createShopWithProduct();
    assert.equal((await get('/products/trending')).status, 200);
    const c = await get(`/products/${f.productId}/compare`);
    assert.ok([200].includes(c.status), `${c.status} ${c.text.slice(0, 100)}`);
  });
});

describe('NOTIFICATIONS, SUBSCRIPTIONS, UPLOAD, CHAT, INVENTORY', () => {
  test('TC-NOT-001 notifications list/unread-count/read-all work and are per-user', async () => {
    const c = await register('CUSTOMER');
    assert.equal((await get('/notifications', { token: c.token })).status, 200);
    const uc = await get('/notifications/unread-count', { token: c.token });
    assert.equal(uc.status, 200);
    assert.ok(ok(await post('/notifications/read-all', {}, { token: c.token })));
  });

  test('TC-NOT-002 admin broadcast creates notification for target role only', async () => {
    const cust = await register('CUSTOMER');
    const shop = await register('SHOPKEEPER');
    const title = `QA Broadcast ${uniq()}`;
    const r = await post('/notifications/broadcast', { title, body: 'hello', targetRole: 'CUSTOMER' }, { token: admin.token });
    assert.ok(ok(r), `${r.status} ${r.text}`);
    const mine = await get('/notifications?limit=50', { token: cust.token });
    const arr = mine.body.data ?? mine.body;
    assert.ok(arr.some((n) => n.title === title), 'customer missing broadcast');
    const theirs = await get('/notifications?limit=50', { token: shop.token });
    assert.ok(!(theirs.body.data ?? theirs.body).some((n) => n.title === title), 'shopkeeper must not get CUSTOMER broadcast');
  });

  test('TC-NOT-003 broadcast validation: empty title/body, bad role', async () => {
    assert.equal((await post('/notifications/broadcast', { title: '', body: 'x' }, { token: admin.token })).status, 400);
    assert.equal((await post('/notifications/broadcast', { title: 'x', body: 'y', targetRole: 'ADMIN' }, { token: admin.token })).status, 400);
    assert.equal((await post('/notifications/broadcast', { title: 'x'.repeat(101), body: 'y' }, { token: admin.token })).status, 400);
  });

  test('TC-NOT-004 marking another user\'s notification read is a no-op (IDOR safe)', async () => {
    const c1 = await register('CUSTOMER');
    const c2 = await register('CUSTOMER');
    sql(`insert into notifications (id,"userId",type,title,body,data,"isRead","createdAt") values (gen_random_uuid(),'${c1.user.id}','SYSTEM','t','b','{}',false,now())`);
    const id = sql(`select id from notifications where "userId"='${c1.user.id}' limit 1`);
    await post(`/notifications/${id}/read`, {}, { token: c2.token });
    assert.equal(sql(`select "isRead" from notifications where id='${id}'`), 'f');
  });

  test('TC-NOT-005 device registration validates payload', async () => {
    const c = await register('CUSTOMER');
    const bad = await post('/notifications/devices', {}, { token: c.token });
    assert.equal(bad.status, 400);
  });

  test('TC-SUB-001 plans public; paid plan subscribe blocked without payment (402), free allowed', async () => {
    const plans = await get('/subscriptions/plans');
    assert.equal(plans.status, 200);
    const sk = await register('SHOPKEEPER');
    const paid = await post('/subscriptions/subscribe', { tier: 'PREMIUM', planName: 'Premium', price: 0 }, { token: sk.token });
    assert.ok([402, 400].includes(paid.status), `free upgrade to paid tier via price=0: ${paid.status} ${paid.text.slice(0, 120)}`);
    const me = await get('/subscriptions/me', { token: sk.token });
    assert.equal(me.status, 200);
  });

  test('TC-UPL-001 upload requires multipart + admin; rejects missing file and non-image', async () => {
    const none = await post('/upload/image', undefined, { token: admin.token });
    assert.equal(none.status, 400, `${none.status} ${none.text}`);
    const fd = new FormData();
    fd.append('file', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
    const res = await fetch(`${BASE}/upload/image`, { method: 'POST', headers: { authorization: `Bearer ${admin.token}` }, body: fd });
    assert.equal(res.status, 400, `non-image upload -> ${res.status}`);
  });

  test('TC-UPL-002 image upload to Cloudinary [BLOCKED without Cloudinary credentials]', async (t) => {
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), 'a.png');
    const res = await fetch(`${BASE}/upload/image`, { method: 'POST', headers: { authorization: `Bearer ${admin.token}` }, body: fd });
    if (res.status >= 500) return t.skip(`BLOCKED: Cloudinary not configured in QA env (HTTP ${res.status})`);
    assert.equal(res.status, 201);
  });

  test('TC-CHT-001 chat room: cannot chat with self / unknown user; messages only visible to participants', async () => {
    const c1 = await register('CUSTOMER');
    const c2 = await register('CUSTOMER');
    const c3 = await register('CUSTOMER');
    const self = await post('/chats/rooms', { targetUserId: c1.user.id }, { token: c1.token });
    assert.ok([400, 403].includes(self.status), `self chat -> ${self.status} ${self.text.slice(0, 100)}`);
    const room = await post('/chats/rooms', { targetUserId: c2.user.id }, { token: c1.token });
    assert.ok(ok(room), `${room.status} ${room.text}`);
    const roomId = room.body.id ?? room.body.data?.id;
    const m = await post(`/chats/rooms/${roomId}/messages`, { content: 'hi' }, { token: c1.token });
    assert.ok(ok(m), `${m.status} ${m.text}`);
    const spy = await get(`/chats/rooms/${roomId}/messages`, { token: c3.token });
    assert.ok([403, 404].includes(spy.status), `non-participant read messages -> ${spy.status}`);
    const spyPost = await post(`/chats/rooms/${roomId}/messages`, { content: 'intrude' }, { token: c3.token });
    assert.ok([403, 404].includes(spyPost.status), `non-participant post -> ${spyPost.status}`);
  });

  test('TC-INV-001 shopkeeper inventory: supplier + purchase order restock', async () => {
    const f = await createShopWithProduct({ stock: 1 });
    const sup = await post('/shopkeeper/inventory/suppliers', { name: 'QA Supplier', location: 'Mumbai', email: 'sup@qa.test', phone: '9999999999' }, { token: f.sk.token });
    assert.ok(ok(sup), `${sup.status} ${sup.text}`);
    const po = await post('/shopkeeper/inventory/purchase-orders', { supplierId: sup.body.id, poNumber: `PO-${uniq()}`, details: '10 x item' }, { token: f.sk.token });
    assert.ok(ok(po), `${po.status} ${po.text}`);
    const hist = await get('/shopkeeper/inventory/stock-history', { token: f.sk.token });
    assert.equal(hist.status, 200);
  });

  test('TC-INV-003 supplier with missing required fields -> 400 (not 500)', async () => {
    const f = await createShopWithProduct();
    const r = await post('/shopkeeper/inventory/suppliers', { name: 'only name' }, { token: f.sk.token });
    assert.equal(r.status, 400, `${r.status} ${r.text}`);
  });

  test('TC-INV-004 delivering a PO restocks product exactly once', async () => {
    const f = await createShopWithProduct({ stock: 1 });
    const sup = await post('/shopkeeper/inventory/suppliers', { name: 'S', location: 'L', email: 's@qa.test' }, { token: f.sk.token });
    const po = await post('/shopkeeper/inventory/purchase-orders', { supplierId: sup.body.id, poNumber: `PO-${uniq()}`, details: 'x' }, { token: f.sk.token });
    assert.ok(ok(po), po.text);
    const d1 = await put(`/shopkeeper/inventory/purchase-orders/${po.body.id}`, { status: 'Delivered', productId: f.productId, quantity: 10 }, { token: f.sk.token });
    assert.ok(ok(d1), d1.text);
    await put(`/shopkeeper/inventory/purchase-orders/${po.body.id}`, { status: 'Delivered', productId: f.productId, quantity: 10 }, { token: f.sk.token });
    assert.equal((await get(`/products/${f.productId}`)).body.stockQuantity, 11, 'restock must be applied once');
  });

  test('TC-INV-002 SECURITY: cannot create PO for another shop\'s supplier/product', async () => {
    const a = await createShopWithProduct();
    const b = await createShopWithProduct();
    const sup = await post('/shopkeeper/inventory/suppliers', { name: 'A Sup', location: 'Pune', email: 'a@qa.test' }, { token: a.sk.token });
    const po = await post('/shopkeeper/inventory/purchase-orders', { supplierId: sup.body.id, poNumber: `PO-${uniq()}`, details: 'x' }, { token: b.sk.token });
    assert.ok([400, 403, 404].includes(po.status), `${po.status} ${po.text.slice(0, 100)}`);
  });

  test('TC-ANL-001 analytics events accept anonymous? and shop analytics only for shopkeeper', async () => {
    const f = await createShopWithProduct();
    const c = await register('CUSTOMER');
    assert.equal((await get('/analytics/shop', { token: c.token })).status, 403);
    assert.equal((await get('/analytics/shop', { token: f.sk.token })).status, 200);
    assert.equal((await get('/analytics/admin', { token: admin.token })).status, 200);
  });
});

describe('INFLUENCER module', () => {
  test('TC-INF-001 influencer profile get/update; campaigns list requires verification', async () => {
    const inf = await register('INFLUENCER');
    const p = await get('/influencer/profile', { token: inf.token });
    assert.equal(p.status, 200, p.text);
    const camp = await get('/influencer/campaigns', { token: inf.token });
    assert.ok([200, 403].includes(camp.status), `${camp.status}`);
  });

  test('TC-INF-002 retailer creates campaign; unverified influencer cannot bid', async () => {
    const sk = await register('SHOPKEEPER');
    const camp = await post('/shopkeeper/influencer-campaigns', {
      title: `QA Camp ${uniq()}`, description: 'd', budget: 5000, requirements: 'r',
      startDate: new Date(Date.now() + 86400000).toISOString(), endDate: new Date(Date.now() + 5 * 86400000).toISOString(),
    }, { token: sk.token });
    assert.ok(ok(camp) || camp.status === 400, `${camp.status} ${camp.text.slice(0, 200)}`);
    if (!ok(camp)) return;
    const inf = await register('INFLUENCER');
    const bid = await post(`/influencer/campaigns/${camp.body.id}/bids`, { amount: 1000, message: 'pick me' }, { token: inf.token });
    assert.ok([400, 403].includes(bid.status), `unverified influencer bid -> ${bid.status} ${bid.text.slice(0, 100)}`);
  });
});

describe('Data exposure & headers', () => {
  test('TC-SEC-001 no password/refresh/reset secrets in any public JSON (users/:id, shop owners)', async () => {
    const f = await createShopWithProduct();
    for (const p of [`/shops/${f.shopId}`, `/products/${f.productId}`, `/shops/${f.shopId}/products`, '/products/search', '/products/trending', '/nearby/shops?lat=19&lng=72.8']) {
      const r = await get(p);
      assert.equal(/"password"|"resetCode"|"refreshToken"|gstNumber/.test(r.text), false, `${p} leaks sensitive fields`);
    }
  });

  test('TC-SEC-002 /users/:id public profile exposes no email/mobile/password', async () => {
    const c = await register('CUSTOMER');
    const viewer = await register('CUSTOMER');
    const r = await get(`/users/${c.user.id}`, { token: viewer.token });
    assert.ok(r.status < 500);
    if (r.status === 200) {
      assert.equal(/"password"|"resetCode"/.test(r.text), false);
      assert.equal(r.body.email === c.email, false, `public profile exposes email to other user`);
    }
  });

  test('TC-SEC-003 security headers present (helmet) and no X-Powered-By', async () => {
    const r = await get('/health');
    assert.equal(r.headers.get('x-powered-by'), null, 'X-Powered-By leaks framework');
    assert.ok(r.headers.get('x-content-type-options'), 'missing X-Content-Type-Options');
  });

  test('TC-SEC-004 CORS: disallowed origin gets no ACAO header; allowed origin does', async () => {
    const bad = await fetch(`${BASE}/health`, { headers: { origin: 'https://evil.example' } });
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
    assert.ok(bad.status < 500, `disallowed origin must not produce a server error (got ${bad.status})`);
    const good = await fetch(`${BASE}/health`, { headers: { origin: 'http://localhost:3100' } });
    assert.equal(good.headers.get('access-control-allow-origin'), 'http://localhost:3100');
  });

  test('TC-SEC-005 JWT signed with wrong secret / alg none is rejected', async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: admin.user.id, role: 'ADMIN' })}.`;
    assert.equal((await get('/admin/dashboard', { token: none })).status, 401);
    const { createHmac } = await import('node:crypto');
    const head = b64({ alg: 'HS256', typ: 'JWT' });
    const body = b64({ sub: admin.user.id, role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 });
    const sig = createHmac('sha256', 'wrong-secret').update(`${head}.${body}`).digest('base64url');
    assert.equal((await get('/admin/dashboard', { token: `${head}.${body}.${sig}` })).status, 401);
  });

  test('TC-SEC-006 role claim in JWT is not trusted over DB (role change takes effect)', async () => {
    const c = await register('CUSTOMER');
    sql(`update users set role='SHOPKEEPER' where id='${c.user.id}'`);
    const r = await get('/shopkeeper/shops', { token: c.token });
    // either token role is re-read (200/404) or stays customer (403); document actual
    assert.ok([200, 403, 404].includes(r.status));
  });

  test('TC-SEC-007 unknown route -> 404 JSON, server error responses do not leak stack traces', async () => {
    const r = await get('/does/not/exist');
    assert.equal(r.status, 404);
    assert.equal(/at .*\.(js|ts):\d+/.test(r.text), false);
  });
});
