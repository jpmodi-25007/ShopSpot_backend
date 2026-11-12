import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, put, patch, del, register, createShopWithProduct, sql, uniq } from './helpers.mjs';

const ok = (r) => [200, 201].includes(r.status);
const addr = { line1: '1 Test Road', city: 'Mumbai', pincode: '400001' };

describe('SHOP & PRODUCT management (shopkeeper)', () => {
  test('TC-SHOP-001 shopkeeper registration auto-creates placeholder shop; PUT completes it', async () => {
    const f = await createShopWithProduct();
    const mine = await get('/shopkeeper/shops', { token: f.sk.token });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.id, f.shopId);
    assert.equal(mine.body.city, 'Mumbai');
  });

  test('TC-SHOP-002 product create -> appears in shop catalogue, public detail and search', async () => {
    const f = await createShopWithProduct({ price: 777 });
    const detail = await get(`/products/${f.productId}`);
    assert.equal(detail.status, 200);
    assert.equal(Number(detail.body.sellingPrice), 777);
    const list = await get(`/shops/${f.shopId}/products`);
    assert.equal(list.status, 200);
    const arr = list.body.data ?? list.body;
    assert.ok(arr.some((p) => p.id === f.productId));
  });

  test('TC-SHOP-003 validation: product without name rejected; negative price rejected', async () => {
    const f = await createShopWithProduct();
    const noName = await post('/shopkeeper/products', { sellingPrice: 10, categoryId: f.categoryId }, { token: f.sk.token });
    assert.equal(noName.status, 400, noName.text);
    const neg = await post('/shopkeeper/products', { name: 'Neg', sellingPrice: -5, categoryId: f.categoryId }, { token: f.sk.token });
    assert.equal(neg.status, 400, neg.text);
  });

  test('TC-SHOP-004 update product price & stock persists', async () => {
    const f = await createShopWithProduct();
    // PUT is a full update (UpdateProductDto extends CreateProductDto): name is required.
    const up = await put(`/shopkeeper/products/${f.productId}`, { name: 'QA Renamed', categoryId: f.categoryId, mrp: 1500, sellingPrice: 888 }, { token: f.sk.token });
    assert.ok(ok(up), up.text);
    const st = await put(`/shopkeeper/products/${f.productId}/stock`, { quantity: 42 }, { token: f.sk.token });
    assert.ok(ok(st), st.text);
    const d = await get(`/products/${f.productId}`);
    assert.equal(Number(d.body.sellingPrice), 888);
    assert.equal(d.body.stockQuantity, 42);
  });

  test('TC-SHOP-005 SECURITY (IDOR): shopkeeper B cannot edit/delete shopkeeper A product', async () => {
    const a = await createShopWithProduct();
    const b = await register('SHOPKEEPER');
    const upd = await put(`/shopkeeper/products/${a.productId}`, { name: 'Hijack', categoryId: a.categoryId, sellingPrice: 1 }, { token: b.token });
    assert.ok([403, 404].includes(upd.status), `update: ${upd.status} ${upd.text}`);
    const stock = await put(`/shopkeeper/products/${a.productId}/stock`, { quantity: 0 }, { token: b.token });
    assert.ok([403, 404].includes(stock.status), `stock: ${stock.status}`);
    const rm = await del(`/shopkeeper/products/${a.productId}`, { token: b.token });
    assert.ok([403, 404].includes(rm.status), `delete: ${rm.status}`);
    const d = await get(`/products/${a.productId}`);
    assert.equal(Number(d.body.sellingPrice), 1000, 'price must be unchanged');
  });

  test('TC-SHOP-006 customer cannot use shopkeeper endpoints (RBAC)', async () => {
    const c = await register('CUSTOMER');
    for (const [m, p] of [['GET', '/shopkeeper/products'], ['GET', '/shopkeeper/shops'], ['GET', '/shopkeeper/reservations'], ['GET', '/shopkeeper/inventory/suppliers']]) {
      const r = m === 'GET' ? await get(p, { token: c.token }) : null;
      assert.equal(r.status, 403, `${p} -> ${r.status}`);
    }
  });

  test('TC-SHOP-007 delete product removes it from catalogue', async () => {
    const f = await createShopWithProduct();
    const r = await del(`/shopkeeper/products/${f.productId}`, { token: f.sk.token });
    assert.ok(ok(r) || r.status === 204, r.text);
    const d = await get(`/products/${f.productId}`);
    assert.ok([404, 200].includes(d.status));
    if (d.status === 200) assert.equal(d.body.isActive, false, 'soft-deleted product must be inactive');
  });

  test('TC-SHOP-008 public shop detail does not leak private fields', async () => {
    const f = await createShopWithProduct();
    const r = await get(`/shops/${f.shopId}`);
    assert.equal(r.status, 200);
    for (const k of ['gstNumber', 'gstin', 'panNumber', 'kycDocuments', 'bankDetails']) {
      assert.equal(r.body[k], undefined, `${k} leaked`);
    }
    assert.equal(r.body.owner, undefined);
  });

  test('TC-SHOP-009 shop name boundary: 1 char rejected, 2 accepted', async () => {
    const sk = await register('SHOPKEEPER');
    const bad = await put('/shopkeeper/shops', { name: 'A' }, { token: sk.token });
    assert.equal(bad.status, 400, bad.text);
    const good = await put('/shopkeeper/shops', { name: 'AB' }, { token: sk.token });
    assert.ok(ok(good), good.text);
  });

  test('TC-SHOP-010 latitude/longitude range validated', async () => {
    const sk = await register('SHOPKEEPER');
    const r = await put('/shopkeeper/shops', { latitude: 123, longitude: 200 }, { token: sk.token });
    assert.equal(r.status, 400, r.text);
  });
});

describe('ORDERS', () => {
  test('TC-ORD-001 create order: server recomputes price, decrements stock atomically', async () => {
    const f = await createShopWithProduct({ price: 500, stock: 5 });
    const c = await register('CUSTOMER');
    const r = await post('/orders', {
      shopId: f.shopId, items: [{ productId: f.productId, quantity: 2, price: 1 }],
      subtotal: 1, total: 1, deliveryAddress: addr,
    }, { token: c.token });
    assert.ok(ok(r), r.text);
    assert.equal(Number(r.body.subtotal), 1000, 'client-supplied price must be ignored');
    assert.equal(Number(r.body.total), 1000);
    const d = await get(`/products/${f.productId}`);
    assert.equal(d.body.stockQuantity, 3);
  });

  test('TC-ORD-002 order more than stock -> 400 and stock unchanged', async () => {
    const f = await createShopWithProduct({ stock: 1 });
    const c = await register('CUSTOMER');
    const r = await post('/orders', {
      shopId: f.shopId, items: [{ productId: f.productId, quantity: 2 }], subtotal: 0, total: 0, deliveryAddress: addr,
    }, { token: c.token });
    assert.equal(r.status, 400, r.text);
    assert.equal((await get(`/products/${f.productId}`)).body.stockQuantity, 1);
  });

  test('TC-ORD-003 boundary: quantity 0, -1, 1.5, 1001 rejected', async () => {
    const f = await createShopWithProduct({ stock: 5000 });
    const c = await register('CUSTOMER');
    for (const q of [0, -1, 1.5, 1001, 'abc']) {
      const r = await post('/orders', {
        shopId: f.shopId, items: [{ productId: f.productId, quantity: q }], subtotal: 0, total: 0, deliveryAddress: addr,
      }, { token: c.token });
      assert.equal(r.status, 400, `qty ${q} -> ${r.status} ${r.text}`);
    }
  });

  test('TC-ORD-004 product from another shop rejected', async () => {
    const a = await createShopWithProduct();
    const b = await createShopWithProduct();
    const c = await register('CUSTOMER');
    const r = await post('/orders', {
      shopId: a.shopId, items: [{ productId: b.productId, quantity: 1 }], subtotal: 0, total: 0, deliveryAddress: addr,
    }, { token: c.token });
    assert.equal(r.status, 400, r.text);
  });

  test('TC-ORD-005 SECURITY: concurrent orders never oversell (stock=3, 6 parallel x1)', async () => {
    const f = await createShopWithProduct({ stock: 3 });
    const c = await register('CUSTOMER');
    const rs = await Promise.all(Array.from({ length: 6 }, () => post('/orders', {
      shopId: f.shopId, items: [{ productId: f.productId, quantity: 1 }], subtotal: 0, total: 0, deliveryAddress: addr,
    }, { token: c.token })));
    const okCount = rs.filter(ok).length;
    assert.equal(okCount, 3, `expected exactly 3 successful orders, got ${okCount}`);
    assert.equal((await get(`/products/${f.productId}`)).body.stockQuantity, 0);
  });

  test('TC-ORD-006 customer sees own orders only; shopkeeper sees shop orders', async () => {
    const f = await createShopWithProduct();
    const c1 = await register('CUSTOMER');
    const c2 = await register('CUSTOMER');
    const o = await post('/orders', { shopId: f.shopId, items: [{ productId: f.productId, quantity: 1 }], subtotal: 0, total: 0, deliveryAddress: addr }, { token: c1.token });
    assert.ok(ok(o), o.text);
    assert.equal((await get('/orders', { token: c1.token })).body.length, 1);
    assert.equal((await get('/orders', { token: c2.token })).body.length, 0);
    const shopOrders = await get('/orders/shop', { token: f.sk.token });
    assert.equal(shopOrders.status, 200);
    assert.ok(shopOrders.body.some((x) => x.id === o.body.id));
  });

  test('TC-ORD-007 status workflow: shopkeeper PENDING->CONFIRMED allowed; customer cannot change status', async () => {
    const f = await createShopWithProduct();
    const c = await register('CUSTOMER');
    const o = await post('/orders', { shopId: f.shopId, items: [{ productId: f.productId, quantity: 1 }], subtotal: 0, total: 0, deliveryAddress: addr }, { token: c.token });
    const bad = await patch(`/orders/${o.body.id}/status`, { status: 'DELIVERED' }, { token: c.token });
    assert.equal(bad.status, 403, `customer status change: ${bad.status} ${bad.text}`);
    const good = await patch(`/orders/${o.body.id}/status`, { status: 'CONFIRMED' }, { token: f.sk.token });
    assert.ok(ok(good), good.text);
  });

  test('TC-ORD-008 SECURITY: other shopkeeper cannot update order status', async () => {
    const f = await createShopWithProduct();
    const other = await register('SHOPKEEPER');
    const c = await register('CUSTOMER');
    const o = await post('/orders', { shopId: f.shopId, items: [{ productId: f.productId, quantity: 1 }], subtotal: 0, total: 0, deliveryAddress: addr }, { token: c.token });
    const r = await patch(`/orders/${o.body.id}/status`, { status: 'CONFIRMED' }, { token: other.token });
    assert.equal(r.status, 403, r.text);
  });

  test('TC-ORD-009 shop-cancelled order restores stock; transition out of terminal state rejected', async () => {
    const f = await createShopWithProduct({ stock: 4 });
    const c = await register('CUSTOMER');
    const o = await post('/orders', { shopId: f.shopId, items: [{ productId: f.productId, quantity: 2 }], subtotal: 0, total: 0, deliveryAddress: addr }, { token: c.token });
    const cancel = await patch(`/orders/${o.body.id}/status`, { status: 'CANCELLED' }, { token: f.sk.token });
    assert.ok(ok(cancel), `shop cancel: ${cancel.status} ${cancel.text}`);
    assert.equal((await get(`/products/${f.productId}`)).body.stockQuantity, 4);
    const again = await patch(`/orders/${o.body.id}/status`, { status: 'CONFIRMED' }, { token: f.sk.token });
    assert.equal(again.status, 400, `terminal-state transition: ${again.status}`);
  });

  test('TC-ORD-010 empty items / unknown shop / missing address rejected', async () => {
    const f = await createShopWithProduct();
    const c = await register('CUSTOMER');
    assert.equal((await post('/orders', { shopId: f.shopId, items: [], subtotal: 0, total: 0, deliveryAddress: addr }, { token: c.token })).status, 400);
    assert.ok([400, 404].includes((await post('/orders', { shopId: 'nope', items: [{ productId: f.productId, quantity: 1 }], subtotal: 0, total: 0, deliveryAddress: addr }, { token: c.token })).status));
    assert.equal((await post('/orders', { shopId: f.shopId, items: [{ productId: f.productId, quantity: 1 }], subtotal: 0, total: 0 }, { token: c.token })).status, 400);
  });

  test('TC-ORD-011 unauthenticated order creation -> 401', async () => {
    assert.equal((await post('/orders', {})).status, 401);
  });

  test('TC-ORD-012 negative discount / delivery charge cannot reduce total below subtotal', async () => {
    const f = await createShopWithProduct({ price: 100, stock: 10 });
    const c = await register('CUSTOMER');
    const r = await post('/orders', {
      shopId: f.shopId, items: [{ productId: f.productId, quantity: 1 }], subtotal: 0, total: 0, deliveryCharge: 0, discount: 100000, deliveryAddress: addr,
    }, { token: c.token });
    assert.ok(ok(r), r.text);
    assert.ok(Number(r.body.total) >= 0);
    assert.ok(Number(r.body.discount) <= Number(r.body.subtotal));
  });
});

describe('RESERVATIONS', () => {
  async function reserve(f, c, extra = {}) {
    return post('/reservations', { productId: f.productId, quantity: 1, ...extra }, { token: c.token });
  }

  test('TC-RES-001 create reservation: server price, QR token, stock decremented', async () => {
    const f = await createShopWithProduct({ price: 900, stock: 3 });
    const c = await register('CUSTOMER');
    const r = await reserve(f, c, { reservedPrice: 1 });
    assert.ok(ok(r), r.text);
    assert.equal(Number(r.body.reservedPrice), 900, 'client reservedPrice must be ignored');
    assert.ok(r.body.qrToken);
    assert.equal((await get(`/products/${f.productId}`)).body.stockQuantity, 2);
  });

  test('TC-RES-002 reserve out-of-stock product rejected', async () => {
    const f = await createShopWithProduct({ stock: 0 });
    const c = await register('CUSTOMER');
    const r = await reserve(f, c);
    assert.equal(r.status, 400, r.text);
  });

  test('TC-RES-003 SECURITY: concurrent reservations never oversell (stock=2, 5 parallel)', async () => {
    const f = await createShopWithProduct({ stock: 2 });
    const cs = await Promise.all(Array.from({ length: 5 }, () => register('CUSTOMER')));
    const rs = await Promise.all(cs.map((c) => reserve(f, c)));
    assert.equal(rs.filter(ok).length, 2, rs.map((r) => r.status).join(','));
    assert.equal((await get(`/products/${f.productId}`)).body.stockQuantity, 0);
  });

  test('TC-RES-004 validation: invalid productId / quantity bounds', async () => {
    const f = await createShopWithProduct({ stock: 500 });
    const c = await register('CUSTOMER');
    assert.equal((await post('/reservations', { productId: 'not-a-uuid' }, { token: c.token })).status, 400);
    assert.equal((await reserve(f, c, { quantity: 0 })).status, 400);
    assert.equal((await reserve(f, c, { quantity: 101 })).status, 400);
    assert.equal((await reserve(f, c, { quantity: 1.5 })).status, 400);
  });

  test('TC-RES-005 shopkeeper verifies QR then completes; QR cannot be completed twice', async () => {
    const f = await createShopWithProduct();
    const c = await register('CUSTOMER');
    const r = await reserve(f, c);
    const v = await post('/shopkeeper/reservations/verify-qr', { qrToken: r.body.qrToken }, { token: f.sk.token });
    assert.ok(ok(v), `verify-qr ${v.status} ${v.text}`);
    const done = await post(`/shopkeeper/reservations/${r.body.id}/complete`, {}, { token: f.sk.token });
    assert.ok(ok(done), `complete ${done.status} ${done.text}`);
    const again = await post(`/shopkeeper/reservations/${r.body.id}/complete`, {}, { token: f.sk.token });
    assert.equal(again.status, 400, `double complete -> ${again.status} ${again.text}`);
  });

  test('TC-RES-006 SECURITY: another shopkeeper cannot verify/complete/cancel someone else\'s reservation', async () => {
    const f = await createShopWithProduct();
    const other = await register('SHOPKEEPER');
    const c = await register('CUSTOMER');
    const r = await reserve(f, c);
    const v = await post('/shopkeeper/reservations/verify-qr', { qrToken: r.body.qrToken }, { token: other.token });
    assert.ok([400, 403, 404].includes(v.status), `verify-qr by other: ${v.status} ${v.text}`);
    const done = await post(`/shopkeeper/reservations/${r.body.id}/complete`, {}, { token: other.token });
    assert.ok([403, 404].includes(done.status), `complete by other: ${done.status}`);
    const cancel = await post(`/shopkeeper/reservations/${r.body.id}/cancel`, {}, { token: other.token });
    assert.ok([403, 404].includes(cancel.status), `cancel by other: ${cancel.status}`);
  });

  test('TC-RES-007 customer cancel restores stock; double cancel rejected', async () => {
    const f = await createShopWithProduct({ stock: 2 });
    const c = await register('CUSTOMER');
    const r = await reserve(f, c);
    assert.equal((await get(`/products/${f.productId}`)).body.stockQuantity, 1);
    const cancel = await post(`/reservations/${r.body.id}/cancel`, {}, { token: c.token });
    assert.ok(ok(cancel), cancel.text);
    assert.equal((await get(`/products/${f.productId}`)).body.stockQuantity, 2);
    const again = await post(`/reservations/${r.body.id}/cancel`, {}, { token: c.token });
    assert.equal(again.status, 400, `double cancel -> ${again.status}`);
    assert.equal((await get(`/products/${f.productId}`)).body.stockQuantity, 2, 'stock must not be restored twice');
  });

  test('TC-RES-008 SECURITY (IDOR): customer cannot cancel/reschedule another customer\'s reservation', async () => {
    const f = await createShopWithProduct();
    const c1 = await register('CUSTOMER');
    const c2 = await register('CUSTOMER');
    const r = await reserve(f, c1);
    const cancel = await post(`/reservations/${r.body.id}/cancel`, {}, { token: c2.token });
    assert.ok([403, 404].includes(cancel.status), `${cancel.status}`);
    const rs = await patch(`/reservations/${r.body.id}/reschedule`, { newDateTime: new Date(Date.now() + 86400000).toISOString() }, { token: c2.token });
    assert.ok([403, 404].includes(rs.status), `${rs.status}`);
  });

  test('TC-RES-009 my reservations list isolated per customer', async () => {
    const f = await createShopWithProduct({ stock: 5 });
    const c1 = await register('CUSTOMER');
    const c2 = await register('CUSTOMER');
    await reserve(f, c1);
    const l1 = await get('/reservations', { token: c1.token });
    const l2 = await get('/reservations', { token: c2.token });
    const a1 = l1.body.data ?? l1.body;
    const a2 = l2.body.data ?? l2.body;
    assert.equal(a1.length, 1);
    assert.equal(a2.length, 0);
  });

  test('TC-RES-010 reschedule: valid future date accepted; past/invalid rejected', async () => {
    const f = await createShopWithProduct();
    const c = await register('CUSTOMER');
    const r = await reserve(f, c);
    const good = await patch(`/reservations/${r.body.id}/reschedule`, { newDateTime: new Date(Date.now() + 3600_000 * 5).toISOString() }, { token: c.token });
    assert.ok(ok(good), `${good.status} ${good.text}`);
    const bad = await patch(`/reservations/${r.body.id}/reschedule`, { newDateTime: 'yesterday' }, { token: c.token });
    assert.equal(bad.status, 400);
    const past = await patch(`/reservations/${r.body.id}/reschedule`, { newDateTime: new Date(Date.now() - 86400000).toISOString() }, { token: c.token });
    assert.equal(past.status, 400, `rescheduling to the past -> ${past.status}`);
  });

  test('TC-RES-011 shopkeeper reservation list shows only own shop', async () => {
    const f = await createShopWithProduct();
    const g = await createShopWithProduct();
    const c = await register('CUSTOMER');
    const r = await reserve(f, c);
    const mine = await get('/shopkeeper/reservations', { token: f.sk.token });
    const theirs = await get('/shopkeeper/reservations', { token: g.sk.token });
    const m = mine.body.data ?? mine.body;
    const t = theirs.body.data ?? theirs.body;
    assert.ok(m.some((x) => x.id === r.body.id));
    assert.ok(!t.some((x) => x.id === r.body.id));
  });

  test('TC-RES-012 customer cannot call shopkeeper complete endpoint (RBAC)', async () => {
    const f = await createShopWithProduct();
    const c = await register('CUSTOMER');
    const r = await reserve(f, c);
    const x = await post(`/shopkeeper/reservations/${r.body.id}/complete`, {}, { token: c.token });
    assert.equal(x.status, 403);
  });

  test('TC-RES-014 SECURITY: concurrent cancels restore stock exactly once', async () => {
    const f = await createShopWithProduct({ stock: 2 });
    const c = await register('CUSTOMER');
    const r = await reserve(f, c);
    assert.equal((await get(`/products/${f.productId}`)).body.stockQuantity, 1);
    const rs = await Promise.all(Array.from({ length: 6 }, () => post(`/reservations/${r.body.id}/cancel`, {}, { token: c.token })));
    assert.equal(rs.filter(ok).length, 1, rs.map((x) => x.status).join(','));
    assert.equal((await get(`/products/${f.productId}`)).body.stockQuantity, 2, 'stock was restored more than once');
  });

  test('TC-RES-013 expired reservations are released by the scheduled job', async () => {
    const f = await createShopWithProduct({ stock: 2 });
    const c = await register('CUSTOMER');
    const r = await reserve(f, c);
    sql(`update reservations set "expiresAt"=(now() at time zone 'utc')-interval '1 hour' where id='${r.body.id}'`);
    // cron runs periodically; poll for up to 70s
    let status;
    for (let i = 0; i < 16; i++) {
      await new Promise((res) => setTimeout(res, 5000));
      status = sql(`select status from reservations where id='${r.body.id}'`);
      if (status !== 'ACTIVE') break;
    }
    assert.ok(['EXPIRED', 'CANCELLED'].includes(status), `reservation still ${status} after expiry`);
    assert.equal((await get(`/products/${f.productId}`)).body.stockQuantity, 2, 'expired reservation must return stock');
  });
});

describe('NEGOTIATIONS', () => {
  async function start(f, c, price = 800) {
    return post('/negotiations', { productId: f.productId, offeredPrice: price, message: 'deal?' }, { token: c.token });
  }

  test('TC-NEG-001 customer starts negotiation -> PENDING', async () => {
    const f = await createShopWithProduct();
    const c = await register('CUSTOMER');
    const r = await start(f, c);
    assert.ok(ok(r), r.text);
    assert.equal(r.body.status, 'PENDING');
  });

  test('TC-NEG-002 SECURITY: customer cannot accept own PENDING offer (no unilateral price)', async () => {
    const f = await createShopWithProduct();
    const c = await register('CUSTOMER');
    const n = await start(f, c, 1);
    const r = await post(`/negotiations/${n.body.id}/accept`, {}, { token: c.token });
    assert.equal(r.status, 400, r.text);
  });

  test('TC-NEG-003 full flow: offer -> shop counter -> customer accept -> reservation uses agreed price', async () => {
    const f = await createShopWithProduct({ price: 1000, stock: 3 });
    const c = await register('CUSTOMER');
    const n = await start(f, c, 700);
    const counter = await post(`/shopkeeper/negotiations/${n.body.id}/counter`, { counterPrice: 850, message: 'best price' }, { token: f.sk.token });
    assert.ok(ok(counter), counter.text);
    const acc = await post(`/negotiations/${n.body.id}/accept`, {}, { token: c.token });
    assert.ok(ok(acc), acc.text);
    const r = await post('/reservations', { productId: f.productId, quantity: 1, negotiationId: n.body.id }, { token: c.token });
    assert.ok(ok(r), r.text);
    assert.equal(Number(r.body.reservedPrice), 850);
  });

  test('TC-NEG-004 shopkeeper accepts offer -> customer reserves at offered price', async () => {
    const f = await createShopWithProduct({ price: 1000 });
    const c = await register('CUSTOMER');
    const n = await start(f, c, 900);
    const a = await post(`/shopkeeper/negotiations/${n.body.id}/accept`, {}, { token: f.sk.token });
    assert.ok(ok(a), a.text);
    const r = await post('/reservations', { productId: f.productId, quantity: 1, negotiationId: n.body.id }, { token: c.token });
    assert.ok(ok(r), r.text);
    assert.equal(Number(r.body.reservedPrice), 900);
  });

  test('TC-NEG-005 SECURITY: cannot reserve with a PENDING/REJECTED negotiation to get a low price', async () => {
    const f = await createShopWithProduct({ price: 1000 });
    const c = await register('CUSTOMER');
    const n = await start(f, c, 1);
    const r = await post('/reservations', { productId: f.productId, quantity: 1, negotiationId: n.body.id }, { token: c.token });
    if (ok(r)) assert.equal(Number(r.body.reservedPrice), 1000, 'unaccepted negotiation must not set price');
    else assert.ok([400, 403].includes(r.status));
  });

  test('TC-NEG-006 shopkeeper reject; no further actions on closed negotiation', async () => {
    const f = await createShopWithProduct();
    const c = await register('CUSTOMER');
    const n = await start(f, c);
    const rej = await post(`/shopkeeper/negotiations/${n.body.id}/reject`, {}, { token: f.sk.token });
    assert.ok(ok(rej), rej.text);
    assert.equal((await post(`/shopkeeper/negotiations/${n.body.id}/counter`, { counterPrice: 900 }, { token: f.sk.token })).status, 400);
    assert.equal((await post(`/shopkeeper/negotiations/${n.body.id}/accept`, {}, { token: f.sk.token })).status, 400);
    assert.equal((await post(`/negotiations/${n.body.id}/reject`, {}, { token: c.token })).status, 400);
  });

  test('TC-NEG-007 SECURITY (IDOR): other shopkeeper / other customer cannot act on negotiation', async () => {
    const f = await createShopWithProduct();
    const other = await register('SHOPKEEPER');
    const c1 = await register('CUSTOMER');
    const c2 = await register('CUSTOMER');
    const n = await start(f, c1);
    const a = await post(`/shopkeeper/negotiations/${n.body.id}/accept`, {}, { token: other.token });
    assert.ok([403, 404].includes(a.status), `other shopkeeper: ${a.status}`);
    const r = await post(`/negotiations/${n.body.id}/reject`, {}, { token: c2.token });
    assert.ok([403, 404].includes(r.status), `other customer: ${r.status}`);
    const g = await get(`/negotiations/${n.body.id}`, { token: c2.token });
    assert.ok([403, 404].includes(g.status), `other customer GET: ${g.status}`);
  });

  test('TC-NEG-008 validation: offeredPrice 0/negative/NaN, missing productId', async () => {
    const f = await createShopWithProduct();
    const c = await register('CUSTOMER');
    for (const p of [0, -5, 'abc']) {
      assert.equal((await post('/negotiations', { productId: f.productId, offeredPrice: p }, { token: c.token })).status, 400, `price ${p}`);
    }
    assert.equal((await post('/negotiations', { offeredPrice: 10 }, { token: c.token })).status, 400);
  });

  test('TC-NEG-009 customer counter only allowed after shop counter (COUNTERED)', async () => {
    const f = await createShopWithProduct();
    const c = await register('CUSTOMER');
    const n = await start(f, c);
    const early = await post(`/negotiations/${n.body.id}/counter`, { counterPrice: 100 }, { token: c.token });
    assert.equal(early.status, 400, `${early.status} ${early.text}`);
  });

  test('TC-NEG-010 offer above selling price handled sanely', async () => {
    const f = await createShopWithProduct({ price: 1000 });
    const c = await register('CUSTOMER');
    const r = await start(f, c, 5000);
    assert.ok([200, 201, 400].includes(r.status), `${r.status}`);
  });

  test('TC-NEG-011 lists scoped to the user', async () => {
    const f = await createShopWithProduct();
    const c1 = await register('CUSTOMER');
    const c2 = await register('CUSTOMER');
    const n = await start(f, c1);
    const l1 = await get('/negotiations', { token: c1.token });
    const l2 = await get('/negotiations', { token: c2.token });
    const a1 = l1.body.data ?? l1.body;
    const a2 = l2.body.data ?? l2.body;
    assert.ok(a1.some((x) => x.id === n.body.id));
    assert.ok(!a2.some((x) => x.id === n.body.id));
    const sl = await get('/shopkeeper/negotiations', { token: f.sk.token });
    assert.ok((sl.body.data ?? sl.body).some((x) => x.id === n.body.id));
  });
});
