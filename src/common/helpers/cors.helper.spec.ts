import { isOriginAllowed, parseCorsOrigins } from './cors.helper';

describe('cors helper', () => {
  const explicit = parseCorsOrigins(
    'https://admin.example.com/, ,http://x.test',
  );

  it('parses and trims the configured origins', () => {
    expect(explicit).toEqual(['https://admin.example.com', 'http://x.test']);
  });

  it('allows explicit origins, vercel deployments and localhost', () => {
    expect(isOriginAllowed('https://admin.example.com', explicit)).toBe(true);
    expect(isOriginAllowed('https://my-app.vercel.app', explicit)).toBe(true);
    expect(isOriginAllowed('http://localhost:3000', explicit)).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:5173', explicit)).toBe(true);
  });

  it('rejects look-alike origins', () => {
    expect(isOriginAllowed('https://evilvercel.app', explicit)).toBe(false);
    expect(isOriginAllowed('https://localhost.evil.com', explicit)).toBe(false);
    expect(isOriginAllowed('https://evil.com', explicit)).toBe(false);
    expect(isOriginAllowed('not a url', explicit)).toBe(false);
  });
});
