/**
 * Simple sliding-window rate limiter using Cloudflare KV
 * Limits login attempts and general API abuse
 */

const LIMITS = {
  login:  { window: 900,  max: 10  }, // 10 attempts per 15 min
  twostep:{ window: 900,  max: 20  }, // 20 two-step setup calls per 15 min, apart from sign-ins
  public: { window: 900,  max: 40  }, // 40 per 15 min for the other no-login forms
  donate: { window: 900,  max: 10  }, // 10 public donation checkouts per 15 min
  demo:   { window: 900,  max: 30  }, // 30 renewal demo checkouts per 15 min
};

// Calls that carry a password or code, or send an email: the strict bucket
const LOGIN_PATHS = ['/auth/login', '/auth/forgot-password', '/portal/request-token', '/portal/claim'];
// Setting two-step sign-in up or turning it off (a password or code, from
// someone already signed in). Counted apart from sign-ins, so a few wrong
// passwords at the door don't lock an officer out of setting it up.
const TWO_STEP_PATHS = ['/auth/two-step/'];
// The other calls anyone can make without logging in
const PUBLIC_PATHS = ['/auth/reset-password', '/portal/lookup', '/portal/register', '/portal/callsign-lookup/'];

// Only the calls above are counted. Everything else under /api/auth and
// /api/portal (the session check on every page load, a member's own portal
// pages) costs no KV write: the free plan allows 1,000 writes a day, and a
// limiter that has run out of writes lets everything through.
export function rateLimitBucket(pathname, type) {
  if (LIMITS[type]) return type;
  if (LOGIN_PATHS.some(p => pathname.includes(p))) return 'login';
  if (TWO_STEP_PATHS.some(p => pathname.includes(p))) return 'twostep';
  if (PUBLIC_PATHS.some(p => pathname.includes(p))) return 'public';
  return null;
}

export async function rateLimit(request, env, type) {
  if (!env.RATE_LIMIT_KV) return null; // Skip if KV not configured

  const key = rateLimitBucket(new URL(request.url).pathname, type);
  if (!key) return null;

  const ip  = request.headers.get('CF-Connecting-IP') || 'unknown';
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
