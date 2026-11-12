// Shared utilities for the live-API QA suite (node:test + fetch, no extra deps).
//
// Run against an ISOLATED test database only. See test/qa/README.md.
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

export const BASE = process.env.QA_BASE_URL || 'http://localhost:3101/api/v1';
export const QA_DB_URL =
  process.env.QA_DATABASE_URL || 'postgresql://moweb@localhost:5432/shopspot_qa';
export const QA_REFRESH_SECRET =
  process.env.QA_JWT_REFRESH_SECRET || 'qa-refresh-secret';
export const SEED_PASSWORD = 'Password123!';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Thin fetch wrapper. Retries on 429 so rate limiting never causes false failures. */
export async function api(method, path, { token, body, headers = {}, raw } = {}) {
  for (let attempt = 0; attempt < 9; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: raw ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 8) {
      // Back off progressively (1s,2s,4s... capped) so the 100 req/min window can clear.
      await sleep(Math.min(1000 * 2 ** attempt, 20000));
      continue;
    }
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status, body: json, text, headers: res.headers };
  }
}

export const get = (p, o) => api('GET', p, o);
export const post = (p, body, o = {}) => api('POST', p, { ...o, body });
export const put = (p, body, o = {}) => api('PUT', p, { ...o, body });
export const patch = (p, body, o = {}) => api('PATCH', p, { ...o, body });
export const del = (p, o) => api('DELETE', p, o);

let counter = 0;
export const uniq = (prefix = 'qa') =>
  `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Unique valid Indian mobile number (6-9 + 9 digits). */
export function uniqMobile() {
  const n = (Date.now() % 1e8) * 10 + (counter++ % 10);
  return `9${String(n).padStart(9, '0').slice(-9)}`;
}

export async function login(email, password, role) {
  const r = await post('/auth/login', { email, password, role });
  if (r.status !== 200) throw new Error(`login failed ${r.status} ${r.text}`);
  return { token: r.body.tokens.accessToken, refresh: r.body.tokens.refreshToken, user: r.body.user };
}

export async function register(role, extra = {}) {
  const email = `${uniq(role.toLowerCase())}@qa.test`;
  const password = 'QaPass#1234';
  const r = await post('/auth/register', { email, password, role, name: 'QA User', ...extra });
  if (r.status !== 201 && r.status !== 200) {
    throw new Error(`register failed ${r.status} ${r.text}`);
  }
  const tokens = r.body.tokens;
  return { email, password, role, token: tokens.accessToken, refresh: tokens.refreshToken, user: r.body.user };
}

export const seeded = {
  admin: () => login('admin@shopspot.in', SEED_PASSWORD, 'ADMIN'),
  shopkeeper: () => login('shop@example.com', SEED_PASSWORD, 'SHOPKEEPER'),
  influencer: () => login('creator@example.com', SEED_PASSWORD, 'INFLUENCER'),
};

/** Run SQL against the QA database (test fixtures only). */
export function sql(statement) {
  if (!/shopspot_qa/.test(QA_DB_URL)) throw new Error('Refusing to run SQL outside shopspot_qa');
  return execFileSync('psql', [QA_DB_URL, '-At', '-c', statement], { encoding: 'utf8' }).trim();
}

export const hashResetCode = (code) =>
  createHmac('sha256', QA_REFRESH_SECRET).update(code).digest('hex');

/** Create a shopkeeper with a shop and an active product; returns ids and tokens. */
export async function createShopWithProduct({ price = 1000, mrp = 1500, stock = 5, name, lat = 19.076, lng = 72.8777 } = {}) {
  const sk = await register('SHOPKEEPER');
  // Registering a SHOPKEEPER auto-creates a placeholder shop; the owner completes it via PUT.
  const shop = await put(
    '/shopkeeper/shops',
    {
      name: name || `QA Shop ${uniq()}`,
      address: '1 QA Street, Mumbai',
      latitude: lat,
      longitude: lng,
      city: 'Mumbai',
      state: 'MH',
      pincode: '400001',
    },
    { token: sk.token },
  );
  if (![200, 201].includes(shop.status)) throw new Error(`shop update ${shop.status} ${shop.text}`);
  const shopId = shop.body.id ?? shop.body.data?.id;
  const cats = await get('/categories');
  const categoryId = cats.body[0]?.id;
  const prod = await post(
    '/shopkeeper/products',
    {
      name: `QA Product ${uniq()}`,
      description: 'Created by QA suite',
      categoryId,
      mrp: Math.max(mrp, price),
      sellingPrice: price,
      stockQuantity: stock,
    },
    { token: sk.token },
  );
  if (![200, 201].includes(prod.status)) throw new Error(`product create ${prod.status} ${prod.text}`);
  const productId = prod.body.id ?? prod.body.data?.id;
  return { sk, shopId, productId, categoryId };
}
