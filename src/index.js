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
import { handleMeetings }    from './routes/meetings.js';
import { handleInventory }   from './routes/inventory.js';
import { serveUI }           from './ui.js';
import { corsHeaders, jsonError } from './lib/response.js';
import { requireAuth, cleanExpiredSessions } from './lib/auth.js';
import { rateLimit }         from './lib/rateLimit.js';
import { activateRenewedMembers } from './lib/duesYear.js';
import { backupDatabase, backupStatus } from './lib/backup.js';
import { syncGoogleGroups } from './lib/googleGroups.js';

// ── Health check ────────────────────────────────────────────────────────
// Public, unauthenticated endpoint for uptime monitors. Verifies the worker
// is running, that D1 is reachable, and that the daily backup is current;
// does not leak any sensitive data.
async function handleHealth(env) {
  const checks = { db: 'ok', backup: 'ok' };
  let healthy = true;
  let lastBackup = null;

  try {
    await env.DB.prepare('SELECT 1').first();
  } catch (err) {
    checks.db = 'error';
    healthy = false;
  }

  try {
    const backup = await backupStatus(env);
    checks.backup = backup.status;
    lastBackup = backup.last_backup;
  } catch (err) {
    checks.backup = 'error';
  }
  if (checks.backup !== 'ok') healthy = false;

  return new Response(
    JSON.stringify({
      status: healthy ? 'ok' : 'error',
      time: new Date().toISOString(),
      checks,
      last_backup: lastBackup,
    }),
    {
      status: healthy ? 200 : 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }
  );
}

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

    // ── Health check (public, for uptime monitoring) ────────────────────
    if (path === '/health') {
      return handleHealth(env);
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

      // Meeting attendance
      if (path.startsWith('/api/meetings')) {
        return handleMeetings(request, env, path, user);
      }

      // Equipment inventory
      if (path.startsWith('/api/inventory')) {
        return handleInventory(request, env, path, user);
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

  // ── Scheduled cleanup and backup (Cron Trigger, see wrangler.toml) ─────
  async scheduled(controller, env, ctx) {
    // Hourly trigger: Google Groups sync only
    if (controller.cron === '15 * * * *') {
      ctx.waitUntil(
        syncGoogleGroups(env)
          .then(r => { if (r.error) console.error('syncGoogleGroups failed:', r.error); })
          .catch(err => console.error('syncGoogleGroups failed:', err))
      );
      return;
    }

    ctx.waitUntil(cleanExpiredSessions(env).catch(err => console.error('cleanExpiredSessions failed:', err)));
    ctx.waitUntil(activateRenewedMembers(env).catch(err => console.error('activateRenewedMembers failed:', err)));
    ctx.waitUntil(
      backupDatabase(env)
        .then(b => console.log(`Backup ${b.key}: ${b.rows} rows, ${b.size} bytes`))
        .catch(err => console.error('backupDatabase failed:', err))
    );
  },
});

