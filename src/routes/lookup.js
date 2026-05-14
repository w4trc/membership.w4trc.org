/**
 * Callsign lookup proxy
 * GET /api/lookup/:callsign
 *
 * Uses HamDB API (free, no key needed): https://api.hamdb.org/
 * Falls back to graceful error if unavailable.
 *
 * Returns normalized fields ready to auto-fill member form.
 */

import { jsonResponse, jsonError } from '../lib/response.js';
import { audit } from '../lib/audit.js';

const HAMDB_URL = 'https://api.hamdb.org/v1';

// Map HamDB class codes to readable strings
const CLASS_MAP = {
  'T':  'Technician',
  'G':  'General',
  'E':  'Amateur Extra',
  'N':  'Novice',
  'A':  'Advanced',
  'P':  'Technician Plus',
};

export async function handleLookup(request, env, path, user) {
  if (request.method !== 'GET') return jsonError('Method not allowed', 405);

  // /api/lookup/N4JHC → callsign = 'N4JHC'
  const url       = new URL(request.url);
  const force     = url.searchParams.get('force') === '1';
  const segments  = path.split('/');
  const callsign  = segments[3]?.toUpperCase().trim();

  if (!callsign) return jsonError('Callsign required', 400);

  // Basic callsign format validation
  if (!/^[A-Z0-9]{3,8}$/.test(callsign)) {
    return jsonError('Invalid callsign format', 400);
  }

  try {
    const resp = await fetch(`${HAMDB_URL}/${callsign}/json`, {
      headers: { 'User-Agent': 'KARC-Membership/1.0 (W4TRC)' },
      cf: { cacheTtl: 3600 }, // Cache in Cloudflare edge for 1 hour
    });

    if (!resp.ok) {
      return jsonError('Lookup service unavailable', 502);
    }

    const data = await resp.json();
    const ham  = data?.hamdb?.callsign;

    if (!ham || ham.call === 'NOT_FOUND') {
      return jsonResponse({ found: false, callsign });
    }

    // Parse expiry date (HamDB format: YYYY-MM-DD)
    const expiryDate = ham.expires || null;

    // Normalize the class field
    const rawClass = (ham.class || '').toUpperCase();
    const licenseClass = CLASS_MAP[rawClass] || rawClass || null;

    // Map address fields
    const normalized = {
      found:          true,
      callsign:       ham.call,
      first_name:     ham.fname || '',
      last_name:      ham.name  || '',
      address:        ham.addr1 || '',
      city:           ham.addr2 || '',
      state:          ham.state || '',
      zip:            ham.zip   || '',
      country:        ham.country || 'US',
      license_class:  licenseClass,
      license_expiry: expiryDate,
      license_status: ham.status || null,   // 'A' = active, 'E' = expired
      grid_square:    ham.grid  || null,
      trustee:        ham.trustee || null,  // For club callsigns
    };

    await updateMemberFromHamDB(env, callsign, normalized, force, user);

    return jsonResponse(normalized);

  } catch (err) {
    console.error('HamDB lookup error:', err);
    return jsonError('Callsign lookup failed', 502);
  }
}

async function updateMemberFromHamDB(env, callsign, data, force = false, user = null) {
  try {
    const member = await env.DB.prepare(
      'SELECT id, last_name, callsign_mismatch FROM members WHERE callsign = ?'
    ).bind(callsign).first();

    if (!member) return; // Callsign not in our system, nothing to update

    const staleCondition = 'hamdb_synced_at IS NULL OR hamdb_synced_at < datetime(\'now\', \'-7 days\')';
    if (!force) {
      const isStale = await env.DB.prepare(
        `SELECT 1 FROM members WHERE callsign = ? AND (${staleCondition})`
      ).bind(callsign).first();
      if (!isStale) return; // Not due for a sync yet
    }

    // Compare last names to detect if the callsign changed hands
    const storedLast = (member.last_name || '').trim().toLowerCase();
    const hamdbLast  = (data.last_name  || '').trim().toLowerCase();
    const mismatch   = storedLast && hamdbLast && storedLast !== hamdbLast;

    if (mismatch) {
      // Callsign appears to have changed hands — update license fields only,
      // flag the record, and store what HamDB returned for admin review
      const wasAlreadyFlagged = member.callsign_mismatch === 1;
      await env.DB.prepare(`
        UPDATE members SET
          license_class      = ?,
          license_expiry     = ?,
          license_status     = ?,
          hamdb_synced_at    = datetime('now'),
          callsign_mismatch  = 1,
          hamdb_mismatch_data = ?
        WHERE callsign = ?
      `).bind(
        data.license_class,
        data.license_expiry,
        data.license_status,
        JSON.stringify({ first_name: data.first_name, last_name: data.last_name, address: data.address, city: data.city, state: data.state, zip: data.zip }),
        callsign,
      ).run();

      if (!wasAlreadyFlagged) {
        await audit(env, {
          userId: user?.id ?? null,
          action: 'member.callsign_mismatch',
          targetType: 'member',
          targetId: member.id,
          detail: { callsign, stored_last: member.last_name, hamdb_last: data.last_name },
        });
      }
    } else {
      // Names match (or no stored name yet) — safe to update, clear any prior flag
      await env.DB.prepare(`
        UPDATE members SET
          license_class      = ?,
          license_expiry     = ?,
          license_status     = ?,
          hamdb_synced_at    = datetime('now'),
          callsign_mismatch  = 0,
          hamdb_mismatch_data = NULL
        WHERE callsign = ?
      `).bind(
        data.license_class,
        data.license_expiry,
        data.license_status,
        callsign,
      ).run();
    }
  } catch (err) {
    console.error('updateMemberFromHamDB error:', err);
  }
}
