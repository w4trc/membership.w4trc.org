import { describe, expect, it } from 'vitest';
import { rateLimit, rateLimitBucket } from '../src/lib/rateLimit.js';

// A stand-in for the KV namespace that counts what the limiter does to it
function fakeKv() {
  const data = new Map();
  const kv = {
    writes: 0,
    reads: 0,
    async get(k) { kv.reads++; return data.get(k) ?? null; },
    async put(k, v) { kv.writes++; data.set(k, v); },
  };
  return kv;
}

const req = (path, ip = '203.0.113.7') =>
  new Request('https://members.w4trc.org' + path, { method: 'POST', headers: { 'CF-Connecting-IP': ip } });

describe('rate limiter', () => {
  it('does not touch KV for ordinary page use', async () => {
    const env = { RATE_LIMIT_KV: fakeKv() };
    for (const path of ['/api/auth/me', '/api/auth/logout', '/api/portal/me', '/api/portal/history', '/api/portal/donations', '/api/portal/directory', '/api/portal/directory-opt-in']) {
      expect(rateLimitBucket(path), path).toBeNull();
      expect(await rateLimit(req(path), env)).toBeNull();
    }
    expect(env.RATE_LIMIT_KV.writes).toBe(0);
    expect(env.RATE_LIMIT_KV.reads).toBe(0);
  });

  it('puts passwords, codes and emails in the strict bucket', () => {
    for (const path of ['/api/auth/login', '/api/auth/forgot-password', '/api/portal/request-token', '/api/portal/claim']) {
      expect(rateLimitBucket(path), path).toBe('login');
    }
    for (const path of ['/api/auth/two-step/setup', '/api/auth/two-step/enable', '/api/auth/two-step/disable']) {
      expect(rateLimitBucket(path), path).toBe('twostep');
    }
    // Looking at whether two-step sign-in is on is an ordinary page load
    expect(rateLimitBucket('/api/auth/two-step')).toBeNull();
  });

  it('lets someone who used up their sign-in attempts still set up two-step', async () => {
    const env = { RATE_LIMIT_KV: fakeKv() };
    for (let i = 0; i < 10; i++) await rateLimit(req('/api/auth/login'), env);
    expect((await rateLimit(req('/api/auth/login'), env)).status).toBe(429);
    expect(await rateLimit(req('/api/auth/two-step/setup'), env)).toBeNull();
    expect(await rateLimit(req('/api/auth/two-step/enable'), env)).toBeNull();
  });

  it('counts the other forms that need no login', () => {
    for (const path of ['/api/auth/reset-password', '/api/portal/lookup', '/api/portal/register', '/api/portal/callsign-lookup/W4TRC']) {
      expect(rateLimitBucket(path), path).toBe('public');
    }
  });

  it('lets the caller name a bucket', () => {
    expect(rateLimitBucket('/api/stripe/create-public-donation-checkout', 'donate')).toBe('donate');
    expect(rateLimitBucket('/api/demo/checkout', 'demo')).toBe('demo');
  });

  it('blocks the eleventh login attempt from one address, and only that address', async () => {
    const env = { RATE_LIMIT_KV: fakeKv() };
    for (let i = 0; i < 10; i++) {
      expect(await rateLimit(req('/api/auth/login'), env)).toBeNull();
    }
    const blocked = await rateLimit(req('/api/auth/login'), env);
    expect(blocked.status).toBe(429);
    expect(await rateLimit(req('/api/auth/login', '203.0.113.8'), env)).toBeNull();
    // A blocked address can still load the page it is on
    expect(await rateLimit(req('/api/auth/me'), env)).toBeNull();
  });
});
