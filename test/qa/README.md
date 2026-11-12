# QA live-API suite

Black-box tests that call a **running** backend over HTTP (`node:test` + global `fetch`; no extra dependencies).

## Safety
Run only against a throw-away database. The helpers' SQL fixtures use `psql` against `QA_DATABASE_URL` (the helper refuses any URL not containing `shopspot_qa`); never point this at production.

## Run
```bash
# 1. Create + migrate + seed an isolated DB (shopspot_qa), then start the API on :3101
DATABASE_URL="postgresql://$USER@localhost:5432/shopspot_qa" PORT=3101 NODE_ENV=development \
CORS_ORIGINS="http://localhost:3100" JWT_ACCESS_SECRET=qa-access-secret JWT_REFRESH_SECRET=qa-refresh-secret \
QR_SIGNING_SECRET=qa-qr-secret SMTP_HOST=127.0.0.1 SMTP_PORT=1 SMTP_EMAIL=qa@example.test SMTP_PASSWORD=x \
node dist/src/main

# 2. Run a suite. Overridable env: QA_BASE_URL (default http://localhost:3101/api/v1),
#    QA_DATABASE_URL (must contain 'shopspot_qa'), QA_JWT_REFRESH_SECRET (default qa-refresh-secret)
node --test test/qa/01-auth.test.mjs
node --test test/qa/02-commerce.test.mjs
node --test test/qa/03-platform.test.mjs
node --test test/qa/04-journeys-perf-ws.test.mjs
```

Notes
- Seeded users (`admin@shopspot.in`, a shopkeeper, an influencer) must exist in the QA DB.
- Auth routes are throttled; the suites back off on HTTP 429 (a few tests intentionally take ~60 s).
- TC-RES-013 waits for the expiry cron (≈50 s). TC-UPL-002 self-skips without Cloudinary credentials (report as BLOCKED).
- Suites 01–03 should be run one at a time (they share the seeded admin).
