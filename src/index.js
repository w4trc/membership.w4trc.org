/**
 * KARC Membership System - Main Worker
 * Kingsport Amateur Radio Club (W4TRC)
 * members.w4trc.org
 */

import * as Sentry from '@sentry/cloudflare';
import logoData              from './logo.png';
import { handleAuth }        from './routes/auth.js';
import { handleMembers }     from './routes/members.js';
import { handleMemberships } from './routes/memberships.js';
import { handleDonations }   from './routes/donations.js';
import { handleNotes }       from './routes/notes.js';
import { handleAdmin, handleWeeklyRoundup } from './routes/admin.js';
import { handleLookup }      from './routes/lookup.js';
import { handleSetup }       from './routes/setup.js';
import { handleProspects }   from './routes/prospects.js';
import { handlePrint }       from './routes/print.js';
import { handlePortal, handleRegisterPage, handleDirectoryPage } from './routes/portal.js';
import { handleStripe }      from './routes/stripe.js';
import { serveUI }           from './ui.js';
import { corsHeaders, jsonError } from './lib/response.js';
import { requireAuth }       from './lib/auth.js';
import { rateLimit }         from './lib/rateLimit.js';

export default Sentry.withSentry(
  (env) => ({
    dsn: 'https://63f0e4b4c18a33b74a050a76b04b9678@o4509799469547520.ingest.us.sentry.io/4511391391809536',
    tracesSampleRate: 1.0,
    enableLogs: true,
    sendDefaultPii: true,
  }),
  {
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

    // ── Logo asset ─────────────────────────────────────────────────────
    if (path === '/logo.png') {
      return new Response(logoData, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }

    // ── Print directory (auth required) ────────────────────────────────
    if (path === '/print') {
      return handlePrint(request, env);
    }

    // ── Public portal pages ─────────────────────────────────────────────
    if (path === '/register') {
      return handleRegisterPage();
    }
    if (path === '/directory') {
      return handleDirectoryPage(request, env);
    }

    // ── Static UI (everything non-API) ──────────────────────────────────
    if (!path.startsWith('/api/')) {
      return serveUI(request, env);
    }

    // ── API routes ───────────────────────────────────────────────────────
    try {
      // ── One-time setup endpoint (disabled after first use) ────────────
      if (path === '/api/setup' && method === 'POST') {
        return handleSetup(request, env);
      }

      // Auth routes (login/logout) — rate-limited, no auth required
      if (path.startsWith('/api/auth/')) {
        const rl = await rateLimit(request, env);
        if (rl) return rl;
        return handleAuth(request, env, path);
      }

      // Portal routes — mix of public and authenticated (portal.js handles internally)
      if (path.startsWith('/api/portal/')) {
        const rl = await rateLimit(request, env);
        if (rl) return rl;
        return handlePortal(request, env, path);
      }

      // Stripe webhook — public (signature-verified inside stripe.js)
      if (path === '/api/stripe/webhook' && method === 'POST') {
        return handleStripe(request, env, path);
      }

      // Weekly roundup — cron-triggered, secured by CRON_SECRET (no session required)
      if (path === '/api/admin/weekly-roundup' && method === 'POST') {
        return handleWeeklyRoundup(request, env);
      }

      // All other API routes require authentication
      const authResult = await requireAuth(request, env);
      if (!authResult.ok) {
        return jsonError(authResult.error, 401);
      }
      const user = authResult.user;

      // Stripe authenticated routes (e.g. create-checkout)
      if (path.startsWith('/api/stripe/')) {
        return handleStripe(request, env, path, user);
      }

      // Callsign lookup proxy
      if (path.startsWith('/api/lookup/')) {
        return handleLookup(request, env, path, user);
      }

      // Memberships — must be checked before /api/members (prefix overlap)
      if (path.startsWith('/api/memberships')) {
        return handleMemberships(request, env, path, user);
      }

      // Donations
      if (path.startsWith('/api/donations')) {
        return handleDonations(request, env, path, user);
      }

      // Members CRUD
      if (path.startsWith('/api/members')) {
        return handleMembers(request, env, path, user);
      }

      // Notes
      if (path.startsWith('/api/notes')) {
        return handleNotes(request, env, path, user);
      }

      // Local hams / prospects
      if (path.startsWith('/api/prospects')) {
        return handleProspects(request, env, path, user);
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
});

