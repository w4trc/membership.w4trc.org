/**
 * HTTP response helpers
 */

const ALLOWED_ORIGINS = [
  'https://members.w4trc.org',
  'http://localhost:8787', // wrangler dev
];

export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':      allowed,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods':     'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':     'Content-Type, X-Requested-With',
    'Access-Control-Max-Age':           '86400',
  };
}

export function jsonResponse(data, status = 200, request, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(request ? corsHeaders(request, env) : {}),
    },
  });
}

export function jsonError(message, status = 400, details = null) {
  return new Response(JSON.stringify({ error: message, ...(details ? { details } : {}) }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function setCookieHeader(name, value, options = {}) {
  const {
    httpOnly = true,
    secure   = true,
    sameSite = 'Strict',
    maxAge   = 28800, // 8 hours
    path     = '/',
  } = options;

  let cookie = `${name}=${value}; Path=${path}; Max-Age=${maxAge}; SameSite=${sameSite}`;
  if (httpOnly) cookie += '; HttpOnly';
  if (secure)   cookie += '; Secure';
  return cookie;
}

export function clearCookieHeader(name) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
