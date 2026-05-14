/**
 * KARC Membership System - Main Worker
 * Kingsport Amateur Radio Club (W4TRC)
 * members.w4trc.org
 */

import { handleAuth }        from './routes/auth.js';
import { handleMembers }     from './routes/members.js';
import { handleMemberships } from './routes/memberships.js';
import { handleNotes }       from './routes/notes.js';
import { handleAdmin }       from './routes/admin.js';
import { handleLookup }      from './routes/lookup.js';
import { handleSetup }       from './routes/setup.js';
import { serveUI }           from './ui.js';
import { corsHeaders, jsonError } from './lib/response.js';
import { requireAuth }       from './lib/auth.js';
import { rateLimit }         from './lib/rateLimit.js';

export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env),
      });
    }

    // ── One-time setup endpoint (disabled after first use) ──────────────
    if (path === '/api/setup' && method === 'POST') {
      return handleSetup(request, env);
    }

    // ── Static UI (everything non-API) ──────────────────────────────────
    if (!path.startsWith('/api/')) {
      return serveUI(request, env);
    }

    // ── API routes ───────────────────────────────────────────────────────
    try {
      // Global rate limiting on API
      const rl = await rateLimit(request, env);
      if (rl) return rl;

      // Auth routes (login/logout) — no auth required
      if (path.startsWith('/api/auth/')) {
        return handleAuth(request, env, path);
      }

      // All other API routes require authentication
      const authResult = await requireAuth(request, env);
      if (!authResult.ok) {
        return jsonError(authResult.error, 401);
      }
      const user = authResult.user;

      // Callsign lookup proxy
      if (path.startsWith('/api/lookup/')) {
        return handleLookup(request, env, path, user);
      }

      // Members CRUD
      if (path.startsWith('/api/members')) {
        return handleMembers(request, env, path, user);
      }

      // Memberships (nested under members)
      if (path.startsWith('/api/memberships')) {
        return handleMemberships(request, env, path, user);
      }

      // Notes
      if (path.startsWith('/api/notes')) {
        return handleNotes(request, env, path, user);
      }

      // Admin-only routes
      if (path.startsWith('/api/admin/')) {
        return handleAdmin(request, env, path, user);
      }

      return jsonError('Not found', 404);

    } catch (err) {
      console.error('Unhandled error:', err);
      return jsonError('Internal server error', 500);
    }
  },
};
