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

    // Also update the member record in DB if we have a member with this callsign
    // (background sync — fire and forget)
    updateMemberFromHamDB(env, callsign, normalized);

    return jsonResponse(normalized);

  } catch (err) {
    console.error('HamDB lookup error:', err);
    return jsonError('Callsign lookup failed', 502);
  }
}

async function updateMemberFromHamDB(env, callsign, data) {
  try {
    await env.DB.prepare(`
      UPDATE members SET
        license_class   = ?,
        license_expiry  = ?,
        license_status  = ?,
        hamdb_synced_at = datetime('now')
      WHERE callsign = ? AND (hamdb_synced_at IS NULL OR hamdb_synced_at < datetime('now', '-7 days'))
    `).bind(
      data.license_class,
      data.license_expiry,
      data.license_status,
      callsign,
    ).run();
  } catch {
    // Background task, ignore errors
  }
}
