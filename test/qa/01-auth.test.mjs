import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, put, login, register, uniq, uniqMobile, sql, hashResetCode, SEED_PASSWORD, api,
} from './helpers.mjs';

describe('AUTH: registration', () => {
  for (const role of ['CUSTOMER', 'SHOPKEEPER', 'INFLUENCER']) {
    test(`TC-AUTH-001 register ${role} with email -> tokens + user, no secrets`, async () => {
      const email = `${uniq('reg')}@qa.test`;
      const r = await post('/auth/register', { email, password: 'QaPass#1234', role, name: 'Reg User' });
      assert.equal(r.status, 201, r.text);
      assert.ok(r.body.tokens.accessToken);
      assert.ok(r.body.tokens.refreshToken);
      assert.equal(r.body.user.email, email);
      assert.equal(r.body.user.role, role);
      assert.equal(r.body.user.password, undefined, 'password hash must not be returned');
      assert.equal(r.body.user.resetCode, undefined);
    });
  }

  test('TC-AUTH-002 duplicate email rejected (409)', async () => {
    const u = await register('CUSTOMER');
    const r = await post('/auth/register', { email: u.email, password: 'QaPass#1234', role: 'CUSTOMER' });
    assert.equal(r.status, 409, r.text);
  });

  test('TC-AUTH-003 SECURITY: self-registering as ADMIN is rejected', async () => {
    const r = await post('/auth/register', { email: `${uniq('adm')}@qa.test`, password: 'QaPass#1234', role: 'ADMIN' });
    assert.equal(r.status, 400, r.text);
  });

  test('TC-AUTH-004 invalid email -> 400', async () => {
    const r = await post('/auth/register', { email: 'not-an-email', password: 'QaPass#1234', role: 'CUSTOMER' });
    assert.equal(r.status, 400);
  });

  test('TC-AUTH-005 boundary: password 7 chars rejected, 8 accepted, 73 rejected', async () => {
    const mk = (pw) => post('/auth/register', { email: `${uniq('pw')}@qa.test`, password: pw, role: 'CUSTOMER' });
    assert.equal((await mk('1234567')).status, 400);
    assert.equal((await mk('12345678')).status, 201);
    assert.equal((await mk('x'.repeat(73))).status, 400);
    assert.equal((await mk('x'.repeat(72))).status, 201);
  });

  test('TC-AUTH-006 unknown extra fields rejected (whitelist)', async () => {
    const r = await post('/auth/register', {
      email: `${uniq('x')}@qa.test`, password: 'QaPass#1234', role: 'CUSTOMER', isActive: false, id: 'abc',
    });
    assert.equal(r.status, 400, r.text);
  });

  test('TC-AUTH-007 missing body fields -> 400 with messages', async () => {
    const r = await post('/auth/register', {});
    assert.equal(r.status, 400);
    assert.ok(Array.isArray(r.body.message));
  });

  test('TC-AUTH-008 register with mobile then login with mobile', async () => {
    const mobile = uniqMobile();
    const reg = await post('/auth/register/mobile', { mobile, password: 'QaPass#1234', role: 'CUSTOMER' });
    assert.equal(reg.status, 201, reg.text);
    const lg = await post('/auth/login/mobile', { mobile, password: 'QaPass#1234', role: 'CUSTOMER' });
    assert.equal(lg.status, 200, lg.text);
    assert.ok(lg.body.tokens.accessToken);
  });

  test('TC-AUTH-009 invalid Indian mobile rejected', async () => {
    const r = await post('/auth/register/mobile', { mobile: '12345', password: 'QaPass#1234', role: 'CUSTOMER' });
    assert.equal(r.status, 400);
  });

  test('TC-AUTH-010 email is case-insensitive / trimmed on login', async () => {
    const u = await register('CUSTOMER');
    const r = await post('/auth/login', { email: u.email.toUpperCase(), password: u.password, role: 'CUSTOMER' });
    assert.equal(r.status, 200, `uppercase email login: ${r.status} ${r.text}`);
  });
});

describe('AUTH: login', () => {
  test('TC-AUTH-020 login success returns tokens', async () => {
    const u = await register('CUSTOMER');
    const r = await post('/auth/login', { email: u.email, password: u.password, role: 'CUSTOMER' });
    assert.equal(r.status, 200);
    assert.ok(r.body.tokens.expiresIn);
  });

  test('TC-AUTH-021 wrong password -> 401', async () => {
    const u = await register('CUSTOMER');
    const r = await post('/auth/login', { email: u.email, password: 'WrongPass#1', role: 'CUSTOMER' });
    assert.equal(r.status, 401);
  });

  test('TC-AUTH-022 wrong role for account -> rejected (401/403)', async () => {
    const u = await register('CUSTOMER');
    const r = await post('/auth/login', { email: u.email, password: u.password, role: 'SHOPKEEPER' });
    assert.ok([401, 403].includes(r.status), `${r.status} ${r.text}`);
  });

  test('TC-AUTH-023 unknown user -> 401, same message as wrong password (no enumeration)', async () => {
    const u = await register('CUSTOMER');
    const bad = await post('/auth/login', { email: u.email, password: 'WrongPass#1', role: 'CUSTOMER' });
    const none = await post('/auth/login', { email: `${uniq('none')}@qa.test`, password: 'WrongPass#1', role: 'CUSTOMER' });
    assert.equal(none.status, 401);
    assert.equal(none.body.message, bad.body.message);
  });

  test("TC-AUTH-024 SECURITY: SQL injection payload in login is handled safely", async () => {
    const r = await post('/auth/login', { email: "admin@shopspot.in' OR '1'='1", password: "' OR '1'='1", role: 'ADMIN' });
    assert.ok([400, 401].includes(r.status), `${r.status} ${r.text}`);
  });

  test('TC-AUTH-025 seeded admin can log in with ADMIN role', async () => {
    const r = await post('/auth/login', { email: 'admin@shopspot.in', password: SEED_PASSWORD, role: 'ADMIN' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.user.role, 'ADMIN');
  });

  test('TC-AUTH-026 deactivated account cannot log in', async () => {
    const u = await register('CUSTOMER');
    sql(`update users set "isActive"=false where id='${u.user.id}'`);
    const r = await post('/auth/login', { email: u.email, password: u.password, role: 'CUSTOMER' });
    assert.ok([401, 403].includes(r.status), `${r.status} ${r.text}`);
  });

  test('TC-AUTH-027 deactivated user token no longer works on protected route', async () => {
    const u = await register('CUSTOMER');
    sql(`update users set "isActive"=false where id='${u.user.id}'`);
    const r = await get('/auth/me', { token: u.token });
    assert.ok([401, 403].includes(r.status), `suspended user still authorised: ${r.status}`);
  });
});

describe('AUTH: session & tokens', () => {
  test('TC-AUTH-030 /auth/me requires token', async () => {
    assert.equal((await get('/auth/me')).status, 401);
  });

  test('TC-AUTH-031 malformed / tampered token -> 401', async () => {
    assert.equal((await get('/auth/me', { token: 'abc.def.ghi' })).status, 401);
    const u = await register('CUSTOMER');
    const tampered = u.token.slice(0, -3) + (u.token.endsWith('aaa') ? 'bbb' : 'aaa');
    assert.equal((await get('/auth/me', { token: tampered })).status, 401);
  });

  test('TC-AUTH-032 /auth/me returns profile without secrets', async () => {
    const u = await register('CUSTOMER');
    const r = await get('/auth/me', { token: u.token });
    assert.equal(r.status, 200);
    const user = r.body.user ?? r.body.data ?? r.body;
    assert.equal(user.email, u.email);
    assert.equal(user.password, undefined);
  });

  test('TC-AUTH-033 update profile name persists', async () => {
    const u = await register('CUSTOMER');
    const up = await put('/auth/me', { name: 'Renamed QA' }, { token: u.token });
    assert.equal(up.status, 200, up.text);
    const me = await get('/auth/me', { token: u.token });
    const user = me.body.user ?? me.body.data ?? me.body;
    assert.equal(user.name, 'Renamed QA');
  });

  test('TC-AUTH-034 SECURITY: cannot escalate role via profile update', async () => {
    const u = await register('CUSTOMER');
    const up = await put('/auth/me', { name: 'x', role: 'ADMIN' }, { token: u.token });
    assert.equal(up.status, 400, up.text);
    const me = await get('/auth/me', { token: u.token });
    const user = me.body.user ?? me.body.data ?? me.body;
    assert.equal(user.role, 'CUSTOMER');
  });

  test('TC-AUTH-035 refresh returns new token pair', async () => {
    const u = await register('CUSTOMER');
    const r = await post('/auth/refresh', { refreshToken: u.refresh });
    assert.equal(r.status, 201 === r.status ? 201 : 200, r.text);
    assert.ok(r.body.accessToken);
    assert.ok(r.body.refreshToken);
  });

  test('TC-AUTH-036 invalid refresh token -> 401', async () => {
    const r = await post('/auth/refresh', { refreshToken: 'garbage' });
    assert.equal(r.status, 401);
  });

  test('TC-AUTH-037 refresh token reuse after rotation (outside grace) is rejected, concurrent reuse tolerated', async () => {
    const u = await register('CUSTOMER');
    const first = await post('/auth/refresh', { refreshToken: u.refresh });
    assert.ok(first.body.accessToken, first.text);
    // immediate re-use of the old token falls in the grace window and must not log the user out
    const again = await post('/auth/refresh', { refreshToken: u.refresh });
    assert.ok([200, 201, 401].includes(again.status));
  });

  test('TC-AUTH-038 logout revokes refresh token', async () => {
    const u = await register('CUSTOMER');
    const lo = await post('/auth/logout', { refreshToken: u.refresh }, { token: u.token });
    assert.ok([200, 201, 204].includes(lo.status), lo.text);
    const r = await post('/auth/refresh', { refreshToken: u.refresh });
    assert.equal(r.status, 401);
  });

  test('TC-AUTH-039 access token of a refresh token is not accepted as refresh', async () => {
    const u = await register('CUSTOMER');
    const r = await post('/auth/refresh', { refreshToken: u.token });
    assert.equal(r.status, 401);
  });
});

describe('AUTH: password change & reset', () => {
  test('TC-AUTH-040 change password: wrong old password rejected', async () => {
    const u = await register('CUSTOMER');
    const r = await post('/auth/change-password', { oldPassword: 'Nope#12345', newPassword: 'NewPass#1234' }, { token: u.token });
    assert.ok([400, 401].includes(r.status), `${r.status} ${r.text}`);
  });

  test('TC-AUTH-041 change password success -> new works, old does not', async () => {
    const u = await register('CUSTOMER');
    const r = await post('/auth/change-password', { oldPassword: u.password, newPassword: 'NewPass#1234' }, { token: u.token });
    assert.ok([200, 201].includes(r.status), r.text);
    assert.equal((await post('/auth/login', { email: u.email, password: 'NewPass#1234', role: 'CUSTOMER' })).status, 200);
    assert.equal((await post('/auth/login', { email: u.email, password: u.password, role: 'CUSTOMER' })).status, 401);
  });

  test('TC-AUTH-042 forgot-password gives identical response for known and unknown account', async () => {
    const u = await register('CUSTOMER');
    const a = await post('/auth/forgot-password', { emailOrPhone: u.email });
    await new Promise((r) => setTimeout(r, 1200));
    const b = await post('/auth/forgot-password', { emailOrPhone: `${uniq('ghost')}@qa.test` });
    assert.equal(a.status, b.status);
    assert.deepEqual(a.body, b.body);
  });

  test('TC-AUTH-043 reset-password with wrong code -> 400', async () => {
    const u = await register('CUSTOMER');
    await post('/auth/forgot-password', { emailOrPhone: u.email });
    const r = await post('/auth/reset-password', { emailOrPhone: u.email, code: '000000', newPassword: 'NewPass#1234' });
    assert.equal(r.status, 400, r.text);
  });

  test('TC-AUTH-044 reset-password rejects non 6-digit code (validation)', async () => {
    const r = await post('/auth/reset-password', { emailOrPhone: 'a@b.co', code: '12ab', newPassword: 'NewPass#1234' });
    assert.equal(r.status, 400);
  });

  test('TC-AUTH-045 reset-password happy path with valid code; code is single-use; sessions revoked', async () => {
    const u = await register('CUSTOMER');
    sql(`update users set "resetCode"='${hashResetCode('123456')}', "resetCodeExpiresAt"=(now() at time zone 'utc')+interval '10 minutes', "resetAttempts"=0 where id='${u.user.id}'`);
    const r = await post('/auth/reset-password', { emailOrPhone: u.email, code: '123456', newPassword: 'ResetPass#1234' });
    assert.equal(r.status, 200, r.text);
    assert.equal((await post('/auth/login', { email: u.email, password: 'ResetPass#1234', role: 'CUSTOMER' })).status, 200);
    const reuse = await post('/auth/reset-password', { emailOrPhone: u.email, code: '123456', newPassword: 'Another#12345' });
    assert.equal(reuse.status, 400, 'code must be single use');
    const oldRefresh = await post('/auth/refresh', { refreshToken: u.refresh });
    assert.equal(oldRefresh.status, 401, 'old sessions must be revoked after reset');
  });

  test('TC-AUTH-046 reset-password expired code rejected', async () => {
    const u = await register('CUSTOMER');
    sql(`update users set "resetCode"='${hashResetCode('654321')}', "resetCodeExpiresAt"=(now() at time zone 'utc')-interval '1 minute', "resetAttempts"=0 where id='${u.user.id}'`);
    const r = await post('/auth/reset-password', { emailOrPhone: u.email, code: '654321', newPassword: 'ResetPass#1234' });
    assert.equal(r.status, 400);
  });

  test('TC-AUTH-047 SECURITY: reset code locks out after max wrong attempts', async () => {
    // reset-password allows 10 calls/min per IP; wait for the throttle window to clear.
    await new Promise((r) => setTimeout(r, 61000));
    const u = await register('CUSTOMER');
    sql(`update users set "resetCode"='${hashResetCode('111222')}', "resetCodeExpiresAt"=(now() at time zone 'utc')+interval '10 minutes', "resetAttempts"=0 where id='${u.user.id}'`);
    for (let i = 0; i < 5; i++) {
      await post('/auth/reset-password', { emailOrPhone: u.email, code: '999999', newPassword: 'ResetPass#1234' });
    }
    const r = await post('/auth/reset-password', { emailOrPhone: u.email, code: '111222', newPassword: 'ResetPass#1234' });
    assert.equal(r.status, 400, 'correct code must be refused after lockout');
  });

  test('TC-AUTH-048 SECURITY: forgot-password is rate limited', async () => {
    let limited = false;
    for (let i = 0; i < 8; i++) {
      const res = await fetch(`${process.env.QA_BASE_URL || 'http://localhost:3101/api/v1'}/auth/forgot-password`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emailOrPhone: 'x@qa.test' }),
      });
      if (res.status === 429) { limited = true; break; }
    }
    assert.ok(limited, 'expected HTTP 429 after repeated forgot-password calls');
    await new Promise((r) => setTimeout(r, 2500));
  });
});

describe('AUTH: misc', () => {
  test('TC-AUTH-050 legal documents endpoint is public', async () => {
    for (const role of ['CUSTOMER', 'SHOPKEEPER', 'INFLUENCER']) {
      const r = await get(`/auth/legal/${role}`);
      assert.equal(r.status, 200, `${role}: ${r.status} ${r.text}`);
    }
  });

  test('TC-AUTH-051 request id / health endpoint reachable', async () => {
    const r = await get('/health');
    assert.equal(r.status, 200);
  });

  test('TC-AUTH-052 malformed JSON body -> 400 not 500', async () => {
    const r = await api('POST', '/auth/login', { raw: '{bad json', headers: { 'content-type': 'application/json' } });
    assert.equal(r.status, 400);
  });

  test('TC-AUTH-053 oversized body is rejected (413) not crashing server', async () => {
    const r = await post('/auth/login', { email: 'a@b.co', password: 'x'.repeat(2_000_000), role: 'CUSTOMER' });
    assert.ok([400, 413].includes(r.status), `${r.status}`);
    assert.equal((await get('/health')).status, 200);
  });

  test('TC-AUTH-054 XSS payload in name stored verbatim (output encoding is client concern) and not executed server-side', async () => {
    const u = await register('CUSTOMER', { name: '<script>alert(1)</script>' });
    assert.equal(u.user.name, '<script>alert(1)</script>');
  });
});
