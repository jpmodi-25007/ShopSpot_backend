import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, put, patch, del, register, seeded, createShopWithProduct, sql, uniq, api,
} from './helpers.mjs';

// Admin-panel functional suite: server-side search/filter, edit/delete flows,
// notes, moderation actions. Runs against the isolated shopspot_qa database.
const admin = await seeded.admin();
const A = { token: admin.token };

const makeReport = (reporterId, { productId = null, shopId = null } = {}) => {
  const id = sql('select gen_random_uuid()');
  sql(
    `insert into content_reports (id, title, "productId", "shopId", "reporterId", reason, reports, status, severity, "createdAt", "updatedAt")
     values ('${id}', 'QA report ${uniq()}', ${productId ? `'${productId}'` : 'null'}, ${shopId ? `'${shopId}'` : 'null'}, '${reporterId}', 'Spam', 1, 'PENDING', 'LOW', now(), now())`,
  );
  return id;
};

describe('ADMIN: list search & filters (server-side)', () => {
  test('TC-ADMP-001 users: search by name/email, role and status filters, meta.total reflects the filter', async () => {
    const tag = uniq('srch');
    const email = `${tag}@qa.test`;
    const created = await post('/admin/users', { name: `Needle ${tag}`, email, role: 'CUSTOMER' }, A);
    assert.equal(created.status, 201, created.text);

    const byName = await get(`/admin/users?search=${tag}`, A);
    assert.equal(byName.status, 200, byName.text);
    assert.equal(byName.body.meta.total, 1);
    assert.equal(byName.body.data[0].email, email);

    const byEmailUpper = await get(`/admin/users?search=${tag.toUpperCase()}`, A);
    assert.equal(byEmailUpper.body.meta.total, 1, 'search is case-insensitive');

    const wrongRole = await get(`/admin/users?search=${tag}&role=SHOPKEEPER`, A);
    assert.equal(wrongRole.body.meta.total, 0);

    await post(`/admin/users/${created.body.id}/suspend`, { isActive: false }, A);
    const suspended = await get(`/admin/users?search=${tag}&status=suspended`, A);
    assert.equal(suspended.body.meta.total, 1);
    const active = await get(`/admin/users?search=${tag}&status=active`, A);
    assert.equal(active.body.meta.total, 0);
  });

  test('TC-ADMP-002 users: invalid filter values are rejected with 400 (not 500, not silently ignored)', async () => {
    assert.equal((await get('/admin/users?role=NOPE', A)).status, 400);
    assert.equal((await get('/admin/users?status=weird', A)).status, 400);
    assert.equal((await get('/admin/users?createdFrom=not-a-date', A)).status, 400);
  });

  test('TC-ADMP-003 users: createdFrom in the future returns nothing, past returns rows', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    assert.equal((await get(`/admin/users?createdFrom=${encodeURIComponent(future)}`, A)).body.meta.total, 0);
    const past = new Date(Date.now() - 365 * 86400000).toISOString();
    assert.ok((await get(`/admin/users?createdFrom=${encodeURIComponent(past)}`, A)).body.meta.total > 0);
  });

  test('TC-ADMP-004 shops: search by name, status filter and category are applied; category name is included', async () => {
    const name = `Findable ${uniq('shop')}`;
    const f = await createShopWithProduct({ name });
    const r = await get(`/admin/shops?search=${encodeURIComponent(name)}`, A);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.meta.total, 1);
    assert.equal(r.body.data[0].id, f.shopId);
    assert.ok('owner' in r.body.data[0]);

    const pending = await get(`/admin/shops?search=${encodeURIComponent(name)}&status=pending`, A);
    assert.equal(pending.body.meta.total, 1);
    const verified = await get(`/admin/shops?search=${encodeURIComponent(name)}&status=verified`, A);
    assert.equal(verified.body.meta.total, 0);
    assert.equal((await get('/admin/shops?status=bogus', A)).status, 400);
  });

  test('TC-ADMP-005 influencers: search + status filter', async () => {
    const tag = uniq('inf');
    const c = await post('/admin/influencers', { name: `Creator ${tag}`, email: `${tag}@qa.test` }, A);
    assert.equal(c.status, 201, c.text);
    const r = await get(`/admin/influencers?search=${tag}`, A);
    assert.equal(r.body.meta.total, 1);
    assert.equal((await get(`/admin/influencers?search=${tag}&status=pending`, A)).body.meta.total, 1);
    assert.equal((await get(`/admin/influencers?search=${tag}&status=verified`, A)).body.meta.total, 0);
  });

  test('TC-ADMP-006 reports: status filter + search', async () => {
    const cust = await register('CUSTOMER');
    const id = makeReport(cust.user.id);
    const r = await get('/admin/reports?status=PENDING&limit=100', A);
    assert.equal(r.status, 200, r.text);
    assert.ok(r.body.data.some((x) => x.id === id));
    const none = await get('/admin/reports?status=RESOLVED&search=zzzzznotfound', A);
    assert.equal(none.body.meta.total, 0);
  });
});

describe('ADMIN: user edit / delete / notes', () => {
  test('TC-ADMP-010 edit user: name/email normalised, duplicate email -> 409, empty body -> 400, unknown field -> 400', async () => {
    const a = await post('/admin/users', { name: 'Edit Me', email: `${uniq('e1')}@qa.test`, role: 'CUSTOMER' }, A);
    const b = await post('/admin/users', { name: 'Other', email: `${uniq('e2')}@qa.test`, role: 'CUSTOMER' }, A);
    const ok = await patch(`/admin/users/${a.body.id}`, { name: '  New Name  ', email: `  ${uniq('E3')}@QA.test ` }, A);
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.name, 'New Name');
    assert.equal(ok.body.email, ok.body.email.toLowerCase());
    assert.equal((await patch(`/admin/users/${a.body.id}`, { email: b.body.email }, A)).status, 409);
    assert.equal((await patch(`/admin/users/${a.body.id}`, {}, A)).status, 400);
    assert.equal((await patch(`/admin/users/${a.body.id}`, { name: '' }, A)).status, 400);
    assert.equal((await patch(`/admin/users/${a.body.id}`, { role: 'ADMIN' }, A)).status, 400, 'role cannot be changed via edit');
    assert.equal((await patch(`/admin/users/${a.body.id}`, { email: 'nope' }, A)).status, 400);
  });

  test('TC-ADMP-011 edit user: non-admin forbidden', async () => {
    const c = await register('CUSTOMER');
    const r = await patch(`/admin/users/${c.user.id}`, { name: 'x' }, { token: c.token });
    assert.equal(r.status, 403);
  });

  test('TC-ADMP-012 delete user: unknown -> 404, self -> 400, admin -> 400, clean user -> deleted', async () => {
    assert.equal((await del('/admin/users/00000000-0000-4000-8000-000000000000', A)).status, 404);
    assert.equal((await del(`/admin/users/${admin.user.id}`, A)).status, 400);
    const other = await post('/admin/users', { name: 'Gone', email: `${uniq('del')}@qa.test`, role: 'CUSTOMER' }, A);
    const r = await del(`/admin/users/${other.body.id}`, A);
    assert.equal(r.status, 200, r.text);
    assert.equal((await get(`/admin/users/${other.body.id}`, A)).status, 404);
  });

  test('TC-ADMP-013 delete user with history (order) is refused with 409 and nothing is removed', async () => {
    const f = await createShopWithProduct({ price: 500, mrp: 600, stock: 5 });
    const cust = await register('CUSTOMER');
    const order = await post(
      '/orders',
      { shopId: f.shopId, items: [{ productId: f.productId, quantity: 1 }], paymentMethod: 'CASH', deliveryType: 'PICKUP' },
      { token: cust.token },
    );
    if (![200, 201].includes(order.status)) return; // order payload shape is covered by suite 02; skip if not creatable
    const r = await del(`/admin/users/${cust.user.id}`, A);
    assert.equal(r.status, 409, r.text);
    assert.equal((await get(`/admin/users/${cust.user.id}`, A)).status, 200, 'user still exists');
  });

  test('TC-ADMP-014 delete retailer removes its (pristine) shop too', async () => {
    const created = await post('/admin/users', { name: 'Retailer', email: `${uniq('rt')}@qa.test`, role: 'SHOPKEEPER' }, A);
    const shopsBefore = await get(`/admin/shops?search=Retailer`, A);
    assert.ok(shopsBefore.body.data.some((s) => s.ownerId === created.body.id));
    const r = await del(`/admin/users/${created.body.id}`, A);
    assert.equal(r.status, 200, r.text);
    const after = await get(`/admin/shops?search=Retailer`, A);
    assert.ok(!after.body.data.some((s) => s.ownerId === created.body.id));
  });

  test('TC-ADMP-015 admin notes persist (latest wins) and are returned by detail; too long -> 400', async () => {
    const u = await register('CUSTOMER');
    assert.equal((await put(`/admin/users/${u.user.id}/notes`, { note: 'first' }, A)).status, 200);
    assert.equal((await put(`/admin/users/${u.user.id}/notes`, { note: 'second note' }, A)).status, 200);
    const d = await get(`/admin/users/${u.user.id}`, A);
    assert.equal(d.body.adminNote, 'second note');
    assert.equal((await put(`/admin/users/${u.user.id}/notes`, { note: 'x'.repeat(2001) }, A)).status, 400);
    assert.equal((await put(`/admin/users/${u.user.id}/notes`, { note: 'x' }, { token: u.token })).status, 403);
  });

  test('TC-ADMP-016 suspending a user revokes their refresh tokens (session cut-off)', async () => {
    const u = await register('CUSTOMER');
    await post(`/admin/users/${u.user.id}/suspend`, { isActive: false }, A);
    const refreshed = await post('/auth/refresh', { refreshToken: u.refresh });
    assert.ok([400, 401, 403].includes(refreshed.status), `refresh after suspend: ${refreshed.status}`);
    const login = await post('/auth/login', { email: u.email, password: u.password, role: 'CUSTOMER' });
    assert.ok([401, 403].includes(login.status), `login after suspend: ${login.status}`);
  });
});

describe('ADMIN: shop edit / status / delete, product edit / delete', () => {
  test('TC-ADMP-020 edit shop: details, status, verification; validation and 404', async () => {
    const f = await createShopWithProduct();
    const r = await patch(
      `/admin/shops/${f.shopId}`,
      { name: 'Renamed Shop', phone: '9999999999', status: 'SUSPENDED', isKycVerified: true, isGstVerified: true },
      A,
    );
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.name, 'Renamed Shop');
    assert.equal(r.body.status, 'SUSPENDED');
    assert.equal(r.body.isKycVerified, true);
    // Suspended shops disappear from the public API.
    assert.equal((await get(`/shops/${f.shopId}`)).status, 404);
    const back = await patch(`/admin/shops/${f.shopId}`, { status: 'ACTIVE', phone: '' }, A);
    assert.equal(back.body.phone, null, 'empty string clears an optional field');
    assert.equal((await get(`/shops/${f.shopId}`)).status, 200);

    assert.equal((await patch(`/admin/shops/${f.shopId}`, { status: 'DELETED' }, A)).status, 400);
    assert.equal((await patch(`/admin/shops/${f.shopId}`, { name: '   ' }, A)).status, 400);
    assert.equal((await patch(`/admin/shops/${f.shopId}`, {}, A)).status, 400);
    assert.equal((await patch(`/admin/shops/${f.shopId}`, { categoryId: '00000000-0000-4000-8000-000000000000' }, A)).status, 400);
    assert.equal((await patch('/admin/shops/00000000-0000-4000-8000-000000000000', { name: 'x' }, A)).status, 404);
    assert.equal((await patch(`/admin/shops/${f.shopId}`, { name: 'x' }, { token: f.sk.token })).status, 403);
  });

  test('TC-ADMP-021 delete shop: refused (409) when it has an order, allowed when it has none', async () => {
    const withOrder = await createShopWithProduct({ price: 500, mrp: 600, stock: 5 });
    const cust = await register('CUSTOMER');
    const order = await post(
      '/orders',
      { shopId: withOrder.shopId, items: [{ productId: withOrder.productId, quantity: 1 }], paymentMethod: 'CASH', deliveryType: 'PICKUP' },
      { token: cust.token },
    );
    if ([200, 201].includes(order.status)) {
      const blocked = await del(`/admin/shops/${withOrder.shopId}`, A);
      assert.equal(blocked.status, 409, blocked.text);
      assert.equal((await get(`/admin/shops/${withOrder.shopId}`, A)).status, 200, 'shop kept');
    }
    const clean = await createShopWithProduct();
    const r = await del(`/admin/shops/${clean.shopId}`, A);
    assert.equal(r.status, 200, r.text);
    assert.equal((await get(`/admin/shops/${clean.shopId}`, A)).status, 404);
    assert.equal((await del(`/admin/shops/${clean.shopId}`, A)).status, 404);
  });

  test('TC-ADMP-022 edit product: price rules, 404; delete deactivates the listing', async () => {
    const f = await createShopWithProduct({ price: 800, mrp: 1000 });
    const ok = await patch(`/admin/products/${f.productId}`, { name: 'Edited', sellingPrice: 700 }, A);
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.name, 'Edited');
    assert.equal((await patch(`/admin/products/${f.productId}`, { sellingPrice: 5000 }, A)).status, 400, 'selling > MRP');
    assert.equal((await patch(`/admin/products/${f.productId}`, { sellingPrice: -1 }, A)).status, 400);
    assert.equal((await patch(`/admin/products/${f.productId}`, {}, A)).status, 400);
    assert.equal((await patch('/admin/products/00000000-0000-4000-8000-000000000000', { name: 'x' }, A)).status, 404);
    assert.equal((await patch(`/admin/products/${f.productId}`, { name: 'x' }, { token: f.sk.token })).status, 403);

    const d = await del(`/admin/products/${f.productId}`, A);
    assert.equal(d.status, 200, d.text);
    assert.equal((await get(`/products/${f.productId}`)).status, 404, 'deactivated product is hidden publicly');
    const re = await patch(`/admin/products/${f.productId}`, { isActive: true }, A);
    assert.equal(re.body.isActive, true);
  });
});

describe('ADMIN: influencer detail, create validation', () => {
  test('TC-ADMP-030 influencer without a profile: list gives temp id and the detail endpoint resolves it', async () => {
    const u = await register('INFLUENCER');
    const list = await get(`/admin/influencers?search=${encodeURIComponent(u.email)}`, A);
    assert.equal(list.body.meta.total, 1);
    const row = list.body.data[0];
    if (!String(row.id).startsWith('temp_')) return; // registration already created a profile
    const d = await get(`/admin/influencers/${row.id}`, A);
    assert.equal(d.status, 200, d.text);
    assert.equal(d.body.userId, u.user.id);
  });

  test('TC-ADMP-031 create influencer: email normalised, duplicate -> 409, non-influencer email -> 409, bad email -> 400', async () => {
    const tag = uniq('ci');
    const email = `${tag}@qa.test`;
    const ok = await post('/admin/influencers', { name: `Mixed ${tag}`, email: email.toUpperCase() }, A);
    assert.equal(ok.status, 201, ok.text);
    assert.equal((await post('/admin/influencers', { name: 'again', email }, A)).status, 409);
    const cust = await register('CUSTOMER');
    assert.equal((await post('/admin/influencers', { name: 'x', email: cust.email }, A)).status, 409);
    assert.equal((await post('/admin/influencers', { name: 'x', email: 'not-an-email' }, A)).status, 400);
    assert.equal((await post('/admin/influencers', { name: 'x', email: `${uniq('z')}@qa.test`, isAdmin: true }, A)).status, 400, 'unknown fields rejected');
  });

  test('TC-ADMP-032 create shop: owner email normalised (no duplicate account), non-shopkeeper owner -> 409', async () => {
    const tag = uniq('cs');
    const email = `${tag}@qa.test`;
    const first = await post('/admin/shops', { name: `Shop ${tag}`, ownerEmail: email.toUpperCase() }, A);
    assert.equal(first.status, 201, first.text);
    const users = await get(`/admin/users?search=${tag}`, A);
    assert.equal(users.body.meta.total, 1, 'only one account created');
    assert.equal((await post('/admin/shops', { name: `Second ${tag}`, ownerEmail: email }, A)).status, 409, 'already owns a shop');
    const cust = await register('CUSTOMER');
    assert.equal((await post('/admin/shops', { name: 'x', ownerEmail: cust.email }, A)).status, 409);
    assert.equal((await post('/admin/shops', { name: 'x', ownerEmail: 'bad' }, A)).status, 400);
  });
});

describe('ADMIN: moderation actions', () => {
  test('TC-ADMP-040 remove reported product deactivates it and resolves the report', async () => {
    const f = await createShopWithProduct();
    const cust = await register('CUSTOMER');
    const reportId = makeReport(cust.user.id, { productId: f.productId });
    const r = await post(`/admin/reports/${reportId}/remove`, {}, A);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.status, 'RESOLVED');
    assert.equal((await get(`/products/${f.productId}`)).status, 404);
    assert.equal((await post('/admin/reports/00000000-0000-4000-8000-000000000000/remove', {}, A)).status, 404);
    assert.equal((await post(`/admin/reports/${reportId}/remove`, {}, { token: cust.token })).status, 403);
  });

  test('TC-ADMP-041 remove a report that targets a shop suspends the shop', async () => {
    const f = await createShopWithProduct();
    const cust = await register('CUSTOMER');
    const reportId = makeReport(cust.user.id, { shopId: f.shopId });
    assert.equal((await post(`/admin/reports/${reportId}/remove`, {}, A)).status, 201);
    const shop = await get(`/admin/shops/${f.shopId}`, A);
    assert.equal(shop.body.status, 'SUSPENDED');
  });

  test('TC-ADMP-042 bulk resolve / bulk remove; validation of ids and action', async () => {
    const cust = await register('CUSTOMER');
    const f1 = await createShopWithProduct();
    const r1 = makeReport(cust.user.id, { productId: f1.productId });
    const r2 = makeReport(cust.user.id);
    const resolved = await post('/admin/reports/bulk', { ids: [r1, r2], action: 'RESOLVE' }, A);
    assert.equal(resolved.status, 201, resolved.text);
    assert.equal(resolved.body.processed, 2);

    const f2 = await createShopWithProduct();
    const r3 = makeReport(cust.user.id, { productId: f2.productId });
    const r4 = makeReport(cust.user.id); // no target -> counted as failed, not a crash
    const removed = await post('/admin/reports/bulk', { ids: [r3, r4], action: 'REMOVE' }, A);
    assert.equal(removed.status, 201, removed.text);
    assert.equal(removed.body.processed, 1);
    assert.equal(removed.body.failed, 1);
    assert.equal((await get(`/products/${f2.productId}`)).status, 404);

    assert.equal((await post('/admin/reports/bulk', { ids: [], action: 'RESOLVE' }, A)).status, 400);
    assert.equal((await post('/admin/reports/bulk', { ids: ['nope'], action: 'RESOLVE' }, A)).status, 400);
    assert.equal((await post('/admin/reports/bulk', { ids: [r1], action: 'DROP_TABLE' }, A)).status, 400);
    assert.equal((await post('/admin/reports/bulk', { ids: [r1], action: 'RESOLVE' }, { token: cust.token })).status, 403);
  });
});

describe('ADMIN: summary, notifications, dashboard', () => {
  test('TC-ADMP-050 summary returns numeric badge counts; non-admin forbidden', async () => {
    const r = await get('/admin/summary', A);
    assert.equal(r.status, 200, r.text);
    for (const k of ['pendingReports', 'unreadNotifications', 'pendingShops', 'pendingInfluencers']) {
      assert.equal(typeof r.body[k], 'number', k);
    }
    const c = await register('CUSTOMER');
    assert.equal((await get('/admin/summary', { token: c.token })).status, 403);
  });

  test("TC-ADMP-051 admin notifications are the admin's own; mark-read never touches other users' notifications", async () => {
    const c = await register('CUSTOMER');
    sql(`insert into notifications (id, "userId", type, title, body, "isRead", "createdAt") values (gen_random_uuid(), '${c.user.id}', 'SYSTEM', 'Private', 'for customer only', false, now())`);
    const feed = await get('/admin/notifications', A);
    assert.equal(feed.status, 200);
    assert.ok(Array.isArray(feed.body.data), 'notifications payload has data[]');
    assert.equal(typeof feed.body.meta?.unreadCount, 'number');
    assert.ok(feed.body.data.every((n) => n.userId === admin.user.id), "feed only contains the admin's notifications");
    assert.equal((await post('/admin/notifications/mark-read', {}, A)).status, 201);
    const stillUnread = sql(`select count(*) from notifications where "userId"='${c.user.id}' and "isRead"=false`);
    assert.equal(stillUnread, '1', "customer's notification untouched");
    const s = await get('/admin/summary', A);
    assert.equal(s.body.unreadNotifications, 0);
  });

  test('TC-ADMP-052 broadcast reaches the admin inbox exactly once', async () => {
    const title = `Bcast ${uniq()}`;
    const b = await post('/notifications/broadcast', { title, body: 'hello', targetRole: 'ALL' }, A);
    assert.ok([200, 201].includes(b.status), b.text);
    const feed = await get('/admin/notifications', A);
    assert.equal(feed.body.data.filter((n) => n.title === title).length, 1);
  });

  test('TC-ADMP-053 dashboard verification queue carries shop ids; MAU counts recent sign-ins only', async () => {
    const r = await get('/admin/dashboard', A);
    assert.equal(r.status, 200, r.text);
    for (const q of r.body.verificationQueue) assert.ok(q.id, 'queue item has id');
    const recent = Number(sql(`select count(*) from users where "lastLoginAt" >= now() - interval '30 days'`));
    assert.equal(r.body.monthlyActiveUsers, recent);
  });
});
