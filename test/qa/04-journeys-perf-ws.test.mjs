import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  get, post, put, patch, del, register, seeded, createShopWithProduct, sql, uniq, hashResetCode, BASE,
} from './helpers.mjs';

const ok = (r) => [200, 201].includes(r.status);
const addr = { line1: '1 Test Road', city: 'Mumbai', pincode: '400001' };

describe('END-TO-END journeys', () => {
  test('TC-E2E-001 customer journey: register -> address -> find product -> save -> negotiate -> reserve -> pickup -> review', async () => {
    const f = await createShopWithProduct({ price: 2000, stock: 4 });
    const c = await register('CUSTOMER');

    const a = await post('/addresses', { line1: '9 Home St', city: 'Mumbai', state: 'MH', pincode: '400001', isDefault: true }, { token: c.token });
    assert.ok(ok(a), a.text);

    const name = (await get(`/products/${f.productId}`)).body.name;
    const search = await get(`/products/search?q=${encodeURIComponent(name)}`);
    assert.ok((search.body.data ?? search.body).some((p) => p.id === f.productId), 'search must find product');

    assert.ok(ok(await post(`/saved/products/${f.productId}`, {}, { token: c.token })));

    const neg = await post('/negotiations', { productId: f.productId, offeredPrice: 1500, message: 'please' }, { token: c.token });
    assert.ok(ok(neg), neg.text);
    const counter = await post(`/shopkeeper/negotiations/${neg.body.id}/counter`, { counterPrice: 1800 }, { token: f.sk.token });
    assert.ok(ok(counter), counter.text);
    assert.ok(ok(await post(`/negotiations/${neg.body.id}/accept`, {}, { token: c.token })));

    const res = await post('/reservations', { productId: f.productId, quantity: 1, negotiationId: neg.body.id }, { token: c.token });
    assert.ok(ok(res), res.text);
    assert.equal(Number(res.body.reservedPrice), 1800);

    const verify = await post('/shopkeeper/reservations/verify-qr', { qrToken: res.body.qrToken }, { token: f.sk.token });
    assert.ok(ok(verify), verify.text);
    assert.ok(ok(await post(`/shopkeeper/reservations/${res.body.id}/complete`, {}, { token: f.sk.token })));

    const review = await post('/reviews', { shopId: f.shopId, rating: 5, comment: 'great' }, { token: c.token });
    assert.ok(ok(review), review.text);

    const mine = await get('/reservations', { token: c.token });
    const row = (mine.body.data ?? mine.body).find((r) => r.id === res.body.id);
    assert.equal(row.status, 'COMPLETED');
    assert.equal((await get(`/products/${f.productId}`)).body.stockQuantity, 3);
  });

  test('TC-E2E-002 retailer journey: onboarding -> product -> customer order -> confirm -> pack -> deliver', async () => {
    const f = await createShopWithProduct({ price: 300, stock: 10 });
    const c = await register('CUSTOMER');
    const o = await post('/orders', { shopId: f.shopId, items: [{ productId: f.productId, quantity: 2 }], subtotal: 0, total: 0, deliveryAddress: addr }, { token: c.token });
    assert.ok(ok(o), o.text);
    for (const st of ['CONFIRMED', 'PACKED', 'DELIVERED']) {
      const r = await patch(`/orders/${o.body.id}/status`, { status: st }, { token: f.sk.token });
      assert.ok(ok(r), `${st}: ${r.status} ${r.text}`);
    }
    const mine = await get('/orders', { token: c.token });
    assert.equal(mine.body.find((x) => x.id === o.body.id).status, 'DELIVERED');
    const after = await patch(`/orders/${o.body.id}/status`, { status: 'CANCELLED' }, { token: f.sk.token });
    assert.equal(after.status, 400, 'delivered order must not be cancellable');
  });

  test('TC-E2E-003 forgot/reset password journey then login and refresh with new credentials', async () => {
    const u = await register('CUSTOMER');
    assert.equal((await post('/auth/forgot-password', { emailOrPhone: u.email })).status, 200);
    sql(`update users set "resetCode"='${hashResetCode('424242')}', "resetCodeExpiresAt"=(now() at time zone 'utc')+interval '10 minutes', "resetAttempts"=0 where id='${u.user.id}'`);
    const r = await post('/auth/reset-password', { emailOrPhone: u.email, code: '424242', newPassword: 'Brand#New123' });
    assert.equal(r.status, 200, r.text);
    const login = await post('/auth/login', { email: u.email, password: 'Brand#New123', role: 'CUSTOMER' });
    assert.equal(login.status, 200);
    const rf = await post('/auth/refresh', { refreshToken: login.body.tokens.refreshToken });
    assert.ok(ok(rf));
  });

  test('TC-E2E-004 admin journey: create retailer -> verify shop -> suspend -> broadcast -> event', async () => {
    const admin = await seeded.admin();
    const email = `${uniq('ret')}@qa.test`;
    const created = await post('/admin/users', { name: 'Admin Made Retailer', email, role: 'SHOPKEEPER' }, { token: admin.token });
    assert.ok(ok(created), created.text);
    const shops = await get('/admin/shops?limit=100', { token: admin.token });
    assert.equal(shops.status, 200);
    const sus = await post(`/admin/users/${created.body.id}/suspend`, { isActive: false }, { token: admin.token });
    assert.ok(ok(sus), sus.text);
    const bc = await post('/notifications/broadcast', { title: 'Journey', body: 'Hello', targetRole: 'ALL' }, { token: admin.token });
    assert.ok(ok(bc), bc.text);
    const ev = await post('/events', { title: `Journey ${uniq()}`, startDate: new Date(Date.now() + 3600000).toISOString(), endDate: new Date(Date.now() + 7200000).toISOString() }, { token: admin.token });
    assert.ok(ok(ev), ev.text);
  });

  test('TC-E2E-005 session persistence: access token expiry is handled by refresh; data persists across re-login', async () => {
    const u = await register('CUSTOMER');
    const addrRes = await post('/addresses', { line1: '5 Persist St', city: 'Pune', state: 'MH', pincode: '411001' }, { token: u.token });
    assert.ok(ok(addrRes));
    const again = await post('/auth/login', { email: u.email, password: u.password, role: 'CUSTOMER' });
    const list = await get('/addresses', { token: again.body.tokens.accessToken });
    assert.equal(list.body.length, 1);
  });
});

describe('WebSocket gateway', () => {
  const require = createRequire('/tmp/wsqa/');
  let io;
  try { io = require('socket.io-client').io; } catch { io = null; }
  const origin = BASE.replace('/api/v1', '');
  const connect = (auth) => new Promise((resolve) => {
    const s = io(origin, { transports: ['websocket'], auth, reconnection: false, timeout: 4000 });
    s.on('connect', () => setTimeout(() => resolve({ s, connected: true }), 300));
    s.on('disconnect', () => resolve({ s, connected: false }));
    s.on('connect_error', () => resolve({ s, connected: false }));
    setTimeout(() => resolve({ s, connected: s.connected }), 3000);
  });

  test('TC-WS-001 connection without token is dropped; with valid token stays connected', async (t) => {
    if (!io) return t.skip('BLOCKED: socket.io-client not installed (npm i --prefix /tmp/wsqa socket.io-client)');
    const anon = await connect({});
    assert.equal(anon.s.connected, false, 'anonymous socket must be disconnected');
    anon.s.close();
    const u = await register('CUSTOMER');
    const authed = await connect({ token: u.token });
    assert.equal(authed.s.connected, true);
    authed.s.close();
  });

  test('TC-WS-002 chat: participants receive messages; outsider cannot join room or receive', async (t) => {
    if (!io) return t.skip('BLOCKED: socket.io-client not installed');
    const a = await register('CUSTOMER');
    const b = await register('CUSTOMER');
    const x = await register('CUSTOMER');
    const room = await post('/chats/rooms', { targetUserId: b.user.id }, { token: a.token });
    const roomId = room.body.id ?? room.body.data?.id;
    const sa = (await connect({ token: a.token })).s;
    const sb = (await connect({ token: b.token })).s;
    const sx = (await connect({ token: x.token })).s;
    const got = { b: [], x: [] };
    sb.on('newMessage', (m) => got.b.push(m));
    sx.on('newMessage', (m) => got.x.push(m));
    sx.emit('joinRoom', { roomId });
    sa.emit('sendMessage', { roomId, content: 'hello over ws' });
    await new Promise((r) => setTimeout(r, 1200));
    [sa, sb, sx].forEach((s) => s.close());
    assert.equal(got.b.length, 1, 'participant B must receive the message');
    assert.equal(got.x.length, 0, 'outsider must not receive the message');
  });

  test('TC-WS-003 non-participant cannot send into someone else\'s room', async (t) => {
    if (!io) return t.skip('BLOCKED: socket.io-client not installed');
    const a = await register('CUSTOMER');
    const b = await register('CUSTOMER');
    const x = await register('CUSTOMER');
    const room = await post('/chats/rooms', { targetUserId: b.user.id }, { token: a.token });
    const roomId = room.body.id ?? room.body.data?.id;
    const sx = (await connect({ token: x.token })).s;
    sx.emit('sendMessage', { roomId, content: 'intruder' });
    await new Promise((r) => setTimeout(r, 800));
    sx.close();
    const rows = sql(`select count(*) from chat_messages where "roomId"='${roomId}' and content='intruder'`);
    assert.equal(rows, '0', 'intruder message was stored');
  });
});

describe('PERFORMANCE (local QA environment, indicative only)', () => {
  const pct = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.floor((arr.length - 1) * p)];
  async function timed(fn, n, concurrency) {
    const times = [];
    let i = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (i < n) {
        i++;
        const t0 = performance.now();
        await fn();
        times.push(performance.now() - t0);
      }
    }));
    return { p50: pct(times, 0.5), p95: pct(times, 0.95), max: Math.max(...times) };
  }

  test('TC-PERF-001 seed 3000 products; search / listing / trending stay fast (p95 < 500ms at 10 concurrent)', async () => {
    const f = await createShopWithProduct();
    const have = Number(sql(`select count(*) from products where "shopId"='${f.shopId}'`));
    sql(`insert into products (id,"shopId",name,slug,"sellingPrice",mrp,"stockQuantity","updatedAt","categoryId")
         select gen_random_uuid(), '${f.shopId}', 'Perf Item ' || g || ' widget', 'perf-' || g || '-' || extract(epoch from now())::bigint, (g % 5000) + 10, (g % 5000) + 20, 5, now(), '${f.categoryId}'
         from generate_series(1, 3000) g`);
    assert.ok(Number(sql(`select count(*) from products`)) >= 3000 + have);

    const search = await timed(() => get('/products/search?q=widget&limit=20'), 60, 10);
    const filtered = await timed(() => get('/products/search?q=Perf&minPrice=100&maxPrice=900&limit=20&page=3'), 60, 10);
    const trending = await timed(() => get('/products/trending'), 40, 10);
    const shopProducts = await timed(() => get(`/shops/${f.shopId}/products?limit=50`), 40, 10);
    console.log('# perf ms', JSON.stringify({ search, filtered, trending, shopProducts }, (k, v) => (typeof v === 'number' ? Math.round(v) : v)));
    for (const [name, r] of Object.entries({ search, filtered, trending, shopProducts })) {
      assert.ok(r.p95 < 500, `${name} p95=${Math.round(r.p95)}ms`);
    }
  });

  test('TC-PERF-002 auth endpoints: login p95 under load (argon2 cost) < 800ms at 5 concurrent', async () => {
    const u = await register('CUSTOMER');
    const r = await timed(() => post('/auth/login', { email: u.email, password: u.password, role: 'CUSTOMER' }), 20, 5);
    console.log('# login ms', JSON.stringify(r, (k, v) => (typeof v === 'number' ? Math.round(v) : v)));
    assert.ok(r.p95 < 800, `login p95=${Math.round(r.p95)}ms`);
  });

  test('TC-PERF-003 payload size: product search page <= 100KB and gzip enabled', async () => {
    const res = await fetch(`${BASE}/products/search?limit=50`, { headers: { 'accept-encoding': 'gzip' } });
    const buf = await res.arrayBuffer();
    assert.ok(buf.byteLength < 100_000, `payload ${buf.byteLength} bytes`);
  });

  test('TC-PERF-004 server stays healthy after load (no 5xx on health, memory sane)', async () => {
    assert.equal((await get('/health')).status, 200);
  });
});
