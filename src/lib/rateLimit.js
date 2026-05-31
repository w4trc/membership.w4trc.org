/**
 * Simple sliding-window rate limiter using Cloudflare KV
 * Limits login attempts and general API abuse
 */

const LIMITS = {
  login:  { window: 900,  max: 10  }, // 10 attempts per 15 min
  api:    { window: 60,   max: 120 }, // 120 req/min general
};

export async function rateLimit(request, env, type = 'api') {
  if (!env.RATE_LIMIT_KV) return null; // Skip if KV not configured

  const ip  = request.headers.get('CF-Connecting-IP') || 'unknown';
  const url = new URL(request.url);

  // Routes that carry credentials or trigger outbound emails get the strict login bucket
  const LOGIN_PATHS = ['/auth/login', '/auth/forgot-password', '/portal/request-token', '/portal/claim'];
  const detectedKey = LOGIN_PATHS.some(p => url.pathname.includes(p)) ? 'login' : 'api';
  // Caller can override with an explicit type; fall back to path detection
  const key   = LIMITS[type] ? type : detectedKey;
  const limit = LIMITS[key];
  const kvKey = `rl:${key}:${ip}`;

  try {
    const existing = await env.RATE_LIMIT_KV.get(kvKey);
    const count    = existing ? parseInt(existing, 10) : 0;

    if (count >= limit.max) {
      return new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(limit.window),
        },
      });
    }

    await env.RATE_LIMIT_KV.put(kvKey, String(count + 1), { expirationTtl: limit.window });
  } catch {
    // Don't block requests if KV fails
  }

  return null;
}
