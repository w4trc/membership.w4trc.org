/**
 * MCP server for AI agents (Model Context Protocol, Streamable HTTP, stateless)
 * POST /mcp  - JSON-RPC 2.0: initialize, ping, tools/list, tools/call
 *
 * Auth: Authorization: Bearer <MCP_TOKEN>. Calls run as the login account named
 * by MCP_USER_EMAIL, capped at the board role, so the agent can never do
 * admin-only things (delete records, manage users) even if that account is an admin.
 *
 * Each tool calls an existing /api route handler, so permission checks,
 * validation, and audit logging are the same as in the web app. The tool list
 * is the allowlist: reads, plus adding notes, meeting attendance, and agenda items.
 */

import { handleMembers }     from './members.js';
import { handleMemberships } from './memberships.js';
import { handleDonations }   from './donations.js';
import { handleNotes }       from './notes.js';
import { handleAdmin }       from './admin.js';
import { handleLookup }      from './lookup.js';
import { handleProspects }   from './prospects.js';
import { handleMeetings }    from './meetings.js';
import { handleAgendas }     from './agendas.js';
import { handleOfficers }    from './officers.js';
import { handleInventory }   from './inventory.js';

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'w4trc-membership', version: '1.0.0' };

const INSTRUCTIONS = `Membership data for the Kingsport Amateur Radio Club (W4TRC).
Dues run by calendar year; renewal season for next year opens in October.
Use search_members or get_member (by callsign) to find a member_id before adding a note.
To record attendance, call resolve_callsigns first to check who each callsign is, then record_meeting.
Officers plan meetings on agendas: list_agendas finds one, get_agenda reads it, and add_agenda_item adds business or an announcement.
You can read everything and add notes, meeting attendance, and agenda items, but you cannot change members, dues, donations, or inventory.`;

// ── Tool definitions ─────────────────────────────────────────────────────────

const str  = (description, extra = {}) => ({ type: 'string', description, ...extra });
const int  = (description) => ({ type: 'integer', description });
const yearProp = int('Calendar year, e.g. 2026');
const READ  = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const qs = (params) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
};

export const TOOLS = [
  {
    name: 'search_members',
    title: 'Search members',
    description: 'Search and filter members (50 per page). Each row includes current-year dues status. Matches callsign, name, or email.',
    inputSchema: {
      type: 'object',
      properties: {
        query:         str('Text to match against callsign, first/last name, or email'),
        status:        str('Member status', { enum: ['all', 'active', 'inactive', 'silent_key'] }),
        dues_year:     int('Only members with a dues record for this year'),
        license_class: str('License class', { enum: ['Technician', 'General', 'Amateur Extra', 'Novice', 'Advanced'] }),
        arrl:          str('ARRL membership filter', { enum: ['all', 'arrl', 'nonarrl'] }),
        eastman:       str('Eastman employee/retiree filter', { enum: ['all', 'eastman', 'noneastman'] }),
        page:          int('Page number, starting at 1'),
      },
    },
    annotations: READ,
    run: (a) => ['GET', `/api/members${qs({ q: a.query, status: a.status, year: a.dues_year, class: a.license_class, arrl: a.arrl, eastman: a.eastman, page: a.page })}`],
  },
  {
    name: 'get_member',
    title: 'Get member',
    description: 'Full record for one member by member_id or callsign: contact and license details, every dues year, and board notes.',
    inputSchema: {
      type: 'object',
      properties: { member_id: int('Member id'), callsign: str('Callsign') },
    },
    annotations: READ,
    run: getMemberTool,
  },
  {
    name: 'list_dues',
    title: 'List dues records',
    description: 'Every dues (membership) record for a year, with payment amount, date, method, and family coverage.',
    inputSchema: {
      type: 'object',
      properties: {
        year:   yearProp,
        status: str('Dues status', { enum: ['all', 'active', 'expired', 'honorary', 'pending', 'waived'] }),
      },
    },
    annotations: READ,
    run: (a) => ['GET', `/api/memberships${qs({ year: a.year, status: a.status })}`],
  },
  {
    name: 'dues_stats',
    title: 'Dues statistics',
    description: 'Totals for a dues year: paid count, revenue, and counts by status.',
    inputSchema: { type: 'object', properties: { year: yearProp } },
    annotations: READ,
    run: (a) => ['GET', `/api/memberships/stats${qs({ year: a.year })}`],
  },
  {
    name: 'dashboard_stats',
    title: 'Dashboard statistics',
    description: 'The headline numbers from the admin dashboard (member counts, current dues, etc.).',
    inputSchema: { type: 'object', properties: {} },
    annotations: READ,
    run: () => ['GET', '/api/admin/stats'],
  },
  {
    name: 'membership_trends',
    title: 'Membership trends',
    description: 'Members per dues year (total, paid, exempt, Eastman) and active members by license class.',
    inputSchema: { type: 'object', properties: {} },
    annotations: READ,
    run: () => ['GET', '/api/admin/charts'],
  },
  {
    name: 'list_donations',
    title: 'List donations',
    description: 'Donations, optionally filtered by year, member, or kind (monetary or item).',
    inputSchema: {
      type: 'object',
      properties: {
        year:      yearProp,
        member_id: int('Only donations from this member'),
        kind:      str('Donation kind', { enum: ['monetary', 'item'] }),
      },
    },
    annotations: READ,
    run: (a) => ['GET', `/api/donations${qs({ year: a.year, member_id: a.member_id, kind: a.kind })}`],
  },
  {
    name: 'donation_stats',
    title: 'Donation statistics',
    description: 'Donation totals and counts, for one year or all time.',
    inputSchema: { type: 'object', properties: { year: yearProp } },
    annotations: READ,
    run: (a) => ['GET', `/api/donations/stats${qs({ year: a.year })}`],
  },
  {
    name: 'treasurer_report',
    title: 'Treasurer report',
    description: 'All money received in a year (dues and donations), as on the printed treasurer report.',
    inputSchema: { type: 'object', properties: { year: yearProp }, required: ['year'] },
    annotations: READ,
    run: (a) => ['GET', `/api/admin/treasurer-report${qs({ year: a.year })}`],
  },
  {
    name: 'list_meetings',
    title: 'List meetings',
    description: 'Meetings with attendee counts (members, visiting hams, guests), newest first.',
    inputSchema: { type: 'object', properties: { year: yearProp } },
    annotations: READ,
    run: (a) => ['GET', `/api/meetings${qs({ year: a.year })}`],
  },
  {
    name: 'get_meeting',
    title: 'Get meeting',
    description: 'One meeting and its full attendee list.',
    inputSchema: { type: 'object', properties: { meeting_id: int('Meeting id') }, required: ['meeting_id'] },
    annotations: READ,
    run: (a) => ['GET', `/api/meetings/${posInt(a.meeting_id, 'meeting_id')}`],
  },
  {
    name: 'list_agendas',
    title: 'List meeting agendas',
    description: 'Meeting agendas, newest first, with counts of business items (and how many are still open), motions, and attendees.',
    inputSchema: { type: 'object', properties: { year: yearProp } },
    annotations: READ,
    run: (a) => ['GET', `/api/agendas${qs({ year: a.year })}`],
  },
  {
    name: 'get_agenda',
    title: 'Get meeting agenda',
    description: 'One agenda in full: the checklist and what is ticked, officer reports, old and new business, announcements, motions and votes, the presentation, attendance, and money received since the last meeting.',
    inputSchema: { type: 'object', properties: { agenda_id: int('Agenda id') }, required: ['agenda_id'] },
    annotations: READ,
    run: (a) => ['GET', `/api/agendas/${posInt(a.agenda_id, 'agenda_id')}`],
  },
  {
    name: 'add_agenda_item',
    title: 'Add agenda item',
    description: 'Add an item to an agenda: new business, old (unfinished) business, or an announcement. Check get_agenda first so you do not add the same item twice.',
    inputSchema: {
      type: 'object',
      properties: {
        agenda_id: int('Agenda id'),
        section:   str('Where it goes', { enum: ['new', 'old', 'announcement'] }),
        title:     str('Short title'),
        details:   str('Optional details'),
        owner:     str('Optional: who is bringing it'),
      },
      required: ['agenda_id', 'section', 'title'],
    },
    annotations: WRITE,
    run: (a) => ['POST', `/api/agendas/${posInt(a.agenda_id, 'agenda_id')}/items`, {
      section: a.section, title: a.title, details: a.details, owner: a.owner,
    }],
  },
  {
    name: 'list_officers',
    title: 'List officers',
    description: 'Every club officer on record, newest year first.',
    inputSchema: { type: 'object', properties: {} },
    annotations: READ,
    run: () => ['GET', '/api/officers'],
  },
  {
    name: 'search_inventory',
    title: 'Search inventory',
    description: 'Club equipment inventory. location is a location id, or "out" for items checked out to members.',
    inputSchema: {
      type: 'object',
      properties: { query: str('Text to search for'), location: str('Location id, or "out"') },
    },
    annotations: READ,
    run: (a) => ['GET', `/api/inventory${qs({ q: a.query, location: a.location })}`],
  },
  {
    name: 'get_inventory_item',
    title: 'Get inventory item',
    description: 'One inventory item with its location and history.',
    inputSchema: { type: 'object', properties: { item_id: int('Item id') }, required: ['item_id'] },
    annotations: READ,
    run: (a) => ['GET', `/api/inventory/${posInt(a.item_id, 'item_id')}`],
  },
  {
    name: 'search_prospects',
    title: 'Search local hams',
    description: 'Licensed hams in the area who are not members (outreach list synced from HamDB), 75 per page.',
    inputSchema: {
      type: 'object',
      properties: {
        query:       str('Text to match against callsign or name'),
        city:        str('City name'),
        status:      str('Outreach status, or "gone" for hams the FCC says moved away or lapsed'),
        postcard:    str('Postcard filter'),
        license_age: str('License age filter'),
        added:       str('"auto" for hams added from the FCC daily files, or a number of days to show only recent additions'),
        page:        int('Page number, starting at 1'),
      },
    },
    annotations: READ,
    run: (a) => ['GET', `/api/prospects${qs({ q: a.query, city: a.city, status: a.status, postcard: a.postcard, license_age: a.license_age, added: a.added, page: a.page })}`],
  },
  {
    name: 'prospect_stats',
    title: 'Local ham statistics',
    description: 'Summary counts for the local-ham outreach list.',
    inputSchema: { type: 'object', properties: {} },
    annotations: READ,
    run: () => ['GET', '/api/prospects/stats'],
  },
  {
    name: 'lookup_callsign',
    title: 'Look up callsign',
    description: 'FCC license details for any callsign from HamDB.',
    inputSchema: { type: 'object', properties: { callsign: str('Callsign') }, required: ['callsign'] },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: (a) => ['GET', `/api/lookup/${encodeURIComponent(requireText(a.callsign, 'callsign'))}`],
  },
  {
    name: 'resolve_callsigns',
    title: 'Resolve callsigns',
    description: 'Check who a list of callsigns belongs to (member, local ham, or HamDB) without saving anything. Use before record_meeting.',
    inputSchema: {
      type: 'object',
      properties: { callsigns: { type: 'array', items: { type: 'string' }, description: 'Callsigns' } },
      required: ['callsigns'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: (a) => ['POST', '/api/meetings/resolve', { callsigns: a.callsigns }],
  },
  {
    name: 'add_note',
    title: 'Add member note',
    description: 'Add a note to a member\'s record. Notes are board-only unless is_private is false.',
    inputSchema: {
      type: 'object',
      properties: {
        member_id:  int('Member id'),
        note_text:  str('The note'),
        is_private: { type: 'boolean', description: 'Board-only (default true)' },
      },
      required: ['member_id', 'note_text'],
    },
    annotations: WRITE,
    run: (a) => ['POST', '/api/notes', { member_id: posInt(a.member_id, 'member_id'), note_text: a.note_text, is_private: a.is_private !== false }],
  },
  {
    name: 'record_meeting',
    title: 'Record meeting',
    description: 'Create a meeting with its attendees. Callsigns are matched to members automatically; guests are non-ham names. Check list_meetings first so you do not record the same meeting twice.',
    inputSchema: {
      type: 'object',
      properties: {
        meeting_date: str('Date, YYYY-MM-DD'),
        meeting_type: str('Meeting type', { enum: ['monthly', 'board', 've_session', 'field_day', 'special', 'other'] }),
        title:        str('Optional title'),
        notes:        str('Optional notes'),
        callsigns:    { type: 'array', items: { type: 'string' }, description: 'Callsigns of hams who attended' },
        guests:       { type: 'array', items: { type: 'string' }, description: 'Names of non-ham guests' },
      },
      required: ['meeting_date', 'meeting_type'],
    },
    annotations: WRITE,
    run: (a) => ['POST', '/api/meetings', {
      meeting_date: a.meeting_date, meeting_type: a.meeting_type, title: a.title, notes: a.notes,
      callsigns: a.callsigns || [], guests: a.guests || [],
    }],
  },
  {
    name: 'add_meeting_attendees',
    title: 'Add meeting attendees',
    description: 'Add attendees to a meeting that is already recorded. Existing attendees are kept.',
    inputSchema: {
      type: 'object',
      properties: {
        meeting_id: int('Meeting id'),
        callsigns:  { type: 'array', items: { type: 'string' }, description: 'Callsigns to add' },
        guests:     { type: 'array', items: { type: 'string' }, description: 'Guest names to add' },
      },
      required: ['meeting_id'],
    },
    annotations: { ...WRITE, idempotentHint: true },
    run: addAttendeesTool,
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map(t => [t.name, t]));

// ── Argument helpers ─────────────────────────────────────────────────────────

class ToolInputError extends Error {}

function posInt(v, name) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new ToolInputError(`${name} must be a positive integer`);
  return n;
}

function requireText(v, name) {
  if (typeof v !== 'string' || !v.trim()) throw new ToolInputError(`${name} is required`);
  return v.trim();
}

// ── Calling the existing API handlers ────────────────────────────────────────

const HANDLERS = [
  ['/api/memberships', handleMemberships], // before /api/members (prefix overlap)
  ['/api/members',     handleMembers],
  ['/api/donations',   handleDonations],
  ['/api/notes',       handleNotes],
  ['/api/admin/',      handleAdmin],
  ['/api/lookup/',     handleLookup],
  ['/api/prospects',   handleProspects],
  ['/api/meetings',    handleMeetings],
  ['/api/agendas',     handleAgendas],
  ['/api/officers',    handleOfficers],
  ['/api/inventory',   handleInventory],
];

async function callApi(ctx, method, pathAndQuery, body) {
  const url  = new URL(pathAndQuery, ctx.origin);
  const path = url.pathname;
  const entry = HANDLERS.find(([prefix]) => path.startsWith(prefix));
  if (!entry) throw new Error(`No handler for ${path}`);

  const headers = {
    'Content-Type': 'application/json',
    'CF-Connecting-IP': ctx.request.headers.get('CF-Connecting-IP') || '',
    'User-Agent': `mcp (${ctx.request.headers.get('User-Agent') || 'unknown'})`,
  };
  const req = new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await entry[1](req, ctx.env, path, ctx.user);

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const msg = (data && typeof data === 'object' && data.error) || `HTTP ${res.status}`;
    throw new ToolInputError(msg);
  }
  return data;
}

async function getMemberTool(a, ctx) {
  let id;
  if (a.member_id !== undefined && a.member_id !== null) {
    id = posInt(a.member_id, 'member_id');
  } else {
    const callsign = requireText(a.callsign, 'member_id or callsign');
    const row = await ctx.env.DB.prepare('SELECT id FROM members WHERE callsign = ?').bind(callsign.toUpperCase()).first();
    if (!row) throw new ToolInputError(`No member with callsign ${callsign.toUpperCase()}`);
    id = row.id;
  }
  const [member, history, notes] = await Promise.all([
    callApi(ctx, 'GET', `/api/members/${id}`),
    callApi(ctx, 'GET', `/api/members/${id}/history`),
    callApi(ctx, 'GET', `/api/notes?member_id=${id}`),
  ]);
  return { member, dues_history: history, notes: notes.notes };
}

async function addAttendeesTool(a, ctx) {
  const id = posInt(a.meeting_id, 'meeting_id');
  const { meeting, attendees } = await callApi(ctx, 'GET', `/api/meetings/${id}`);
  // The update endpoint replaces the whole list, so send the current attendees plus the new ones.
  return callApi(ctx, 'PUT', `/api/meetings/${id}`, {
    meeting_date: meeting.meeting_date,
    meeting_type: meeting.meeting_type,
    title:        meeting.title,
    notes:        meeting.notes,
    callsigns: [...attendees.filter(x => x.callsign).map(x => x.callsign), ...(a.callsigns || [])],
    guests:    [...attendees.filter(x => !x.callsign).map(x => x.name),    ...(a.guests || [])],
  });
}

// ── Auth ─────────────────────────────────────────────────────────────────────

async function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function authenticate(request, env) {
  if (!env.MCP_TOKEN || !env.MCP_USER_EMAIL) return { status: 503, error: 'MCP is not configured' };

  const header   = request.headers.get('Authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!provided || !(await timingSafeEqual(provided, env.MCP_TOKEN))) return { status: 401, error: 'Unauthorized' };

  const row = await env.DB.prepare(
    'SELECT id, email, role, is_active, member_id FROM users WHERE email = ?'
  ).bind(env.MCP_USER_EMAIL.trim()).first();
  if (!row || !row.is_active || !['admin', 'board'].includes(row.role)) {
    return { status: 403, error: 'MCP_USER_EMAIL must be an active board or admin login account' };
  }

  // Cap at board: never admin, whatever the account's real role is
  return { user: { id: row.id, email: row.email, role: 'board', memberId: row.member_id, sessionId: null } };
}

// ── JSON-RPC ─────────────────────────────────────────────────────────────────

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError  = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function callTool(params, ctx) {
  const tool = TOOL_BY_NAME.get(params?.name);
  if (!tool) return null;
  const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};

  try {
    let data;
    const out = await tool.run(args, ctx);
    if (Array.isArray(out)) data = await callApi(ctx, ...out);
    else data = out;
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  } catch (err) {
    if (!(err instanceof ToolInputError)) console.error(`MCP tool ${tool.name} failed:`, err);
    const message = err instanceof ToolInputError ? err.message : 'Internal error';
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
}

async function dispatch(msg, ctx) {
  const { id, method, params } = msg;
  const isNotification = id === undefined;

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, {
        tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
      });
    case 'tools/call': {
      const result = await callTool(params, ctx);
      if (!result) return rpcError(id, -32602, `Unknown tool: ${params?.name}`);
      return rpcResult(id, result);
    }
    default:
      if (isNotification) return null; // notifications/initialized, cancelled, etc.
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function handleMcp(request, env) {
  if (request.method !== 'POST') {
    // Stateless server: no server-initiated SSE stream, no sessions to delete
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  // Browsers send Origin; agents don't. Block cross-site browser requests.
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json(rpcError(null, -32600, 'Origin not allowed'), 403);

  const auth = await authenticate(request, env);
  if (auth.error) {
    const headers = auth.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {};
    return new Response(JSON.stringify(rpcError(null, -32001, auth.error)), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  }

  let msg;
  try { msg = await request.json(); } catch { return json(rpcError(null, -32700, 'Parse error'), 400); }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return json(rpcError(msg?.id, -32600, 'Invalid request'), 400);
  }

  const ctx = { env, request, user: auth.user, origin: new URL(request.url).origin };
  const response = await dispatch(msg, ctx);
  if (!response) return new Response(null, { status: 202 });
  return json(response);
}
