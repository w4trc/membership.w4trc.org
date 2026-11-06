import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../src/index.js';
import { TOOLS } from '../src/routes/mcp.js';
import { resetDb, addMember, addMembership, auditActions } from './helpers.js';

const TOKEN = 'mcp_vitest_token';
const testEnv = { ...env, MCP_TOKEN: TOKEN, MCP_USER_EMAIL: 'hermes@w4trc.org' };
const ctx = { waitUntil() {}, passThroughOnException() {} };

let nextId = 1;
async function rpc(method, params, { token = TOKEN, headers = {} } = {}) {
  const res = await worker.fetch(new Request('https://members.w4trc.org/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  }), testEnv, ctx);
  return { status: res.status, body: res.status === 202 ? null : await res.json() };
}

async function call(name, args = {}) {
  const { body } = await rpc('tools/call', { name, arguments: args });
  const result = body.result;
  const text = result.content[0].text;
  return { isError: !!result.isError, text, data: result.isError ? null : JSON.parse(text) };
}

async function addUser(role = 'board', email = 'hermes@w4trc.org', is_active = 1) {
  const r = await env.DB.prepare(`INSERT INTO users (email, password_hash, role, is_active) VALUES (?, 'x', ?, ?)`)
    .bind(email, role, is_active).run();
  return r.meta.last_row_id;
}

beforeEach(async () => {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM notes'),
    env.DB.prepare('DELETE FROM meeting_attendees'),
    env.DB.prepare('DELETE FROM meetings'),
  ]);
  // Unknown callsigns fall through to HamDB; keep tests offline
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }));
});
afterEach(() => vi.restoreAllMocks());

describe('MCP auth', () => {
  it('rejects a missing or wrong token', async () => {
    await addUser();
    expect((await rpc('tools/list', {}, { token: null })).status).toBe(401);
    expect((await rpc('tools/list', {}, { token: 'nope' })).status).toBe(401);
  });

  it('rejects when the service account is missing, inactive, or only a member', async () => {
    expect((await rpc('tools/list')).status).toBe(403);
    await addUser('member');
    expect((await rpc('tools/list')).status).toBe(403);
    await env.DB.prepare(`UPDATE users SET role = 'board', is_active = 0`).run();
    expect((await rpc('tools/list')).status).toBe(403);
  });

  it('rejects browser requests from another site', async () => {
    await addUser();
    expect((await rpc('tools/list', {}, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
  });

  it('only accepts POST', async () => {
    const res = await worker.fetch(new Request('https://members.w4trc.org/mcp'), testEnv, ctx);
    expect(res.status).toBe(405);
  });
});

describe('MCP protocol', () => {
  beforeEach(() => addUser());

  it('initializes with the requested protocol version', async () => {
    const { body } = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(body.result.protocolVersion).toBe('2025-03-26');
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it('accepts notifications with 202', async () => {
    const res = await worker.fetch(new Request('https://members.w4trc.org/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }), testEnv, ctx);
    expect(res.status).toBe(202);
  });

  it('lists tools without exposing anything that edits members, dues, or money', async () => {
    const { body } = await rpc('tools/list');
    const names = body.result.tools.map(t => t.name);
    expect(names).toEqual(TOOLS.map(t => t.name));
    const writes = body.result.tools.filter(t => !t.annotations.readOnlyHint).map(t => t.name);
    expect(writes.sort()).toEqual(['add_meeting_attendees', 'add_note', 'record_meeting']);
  });

  it('returns an error for an unknown tool', async () => {
    const { body } = await rpc('tools/call', { name: 'delete_member', arguments: {} });
    expect(body.error.code).toBe(-32602);
  });
});

describe('MCP tools', () => {
  let userId;
  beforeEach(async () => { userId = await addUser('admin'); });

  it('searches members', async () => {
    await addMember({ callsign: 'W4AAA', last_name: 'Alpha' });
    await addMember({ callsign: 'W4BBB', last_name: 'Bravo' });
    const { data } = await call('search_members', { query: 'Bravo' });
    expect(data.members.map(m => m.callsign)).toEqual(['W4BBB']);
  });

  it('gets a member by callsign with dues history and notes', async () => {
    const id = await addMember({ callsign: 'W4AAA' });
    await addMembership(id, 2026, { status: 'active', amount_paid: 20 });
    const { data } = await call('get_member', { callsign: 'w4aaa' });
    expect(data.member).toBeDefined();
    expect(JSON.stringify(data.dues_history)).toContain('2026');
    expect(data.notes).toEqual([]);
  });

  it('reports a missing member as a tool error', async () => {
    const r = await call('get_member', { callsign: 'N0PE' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('N0PE');
  });

  it('adds a note as the service account, and audits it', async () => {
    const id = await addMember({ callsign: 'W4AAA' });
    const { data } = await call('add_note', { member_id: id, note_text: 'Called about renewal' });
    expect(data).toMatchObject({ member_id: id, author_id: userId, note_text: 'Called about renewal', is_private: 1 });
    expect((await auditActions()).map(a => a.action)).toContain('note.create');
  });

  it('records a meeting and then adds attendees without dropping existing ones', async () => {
    const id = await addMember({ callsign: 'W4AAA' });
    const { data } = await call('record_meeting', {
      meeting_date: '2026-11-03', meeting_type: 'monthly', callsigns: ['W4AAA'], guests: ['Jane Doe'],
    });
    expect(data.attendees).toHaveLength(2);
    expect(data.attendees.find(a => a.callsign === 'W4AAA').member_id).toBe(id);

    const added = await call('add_meeting_attendees', { meeting_id: data.meeting.id, callsigns: ['W4AAA', 'KQ4ZZZ'], guests: ['John Roe'] });
    expect(added.data.attendees.map(a => a.callsign || a.name).sort()).toEqual(['John Roe', 'Jane Doe', 'KQ4ZZZ', 'W4AAA'].sort());
  });

  it('passes validation errors back to the agent', async () => {
    const r = await call('record_meeting', { meeting_date: 'Tuesday', meeting_type: 'monthly' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('meeting_date');
  });

  it('runs every read-only tool without error', async () => {
    const id = await addMember({ callsign: 'W4AAA' });
    const args = {
      get_member: { member_id: id }, treasurer_report: { year: 2026 }, lookup_callsign: { callsign: 'W4AAA' },
      resolve_callsigns: { callsigns: ['W4AAA'] },
    };
    const skip = ['get_meeting', 'get_inventory_item', 'lookup_callsign']; // need fixtures / network
    for (const t of TOOLS.filter(t => t.annotations.readOnlyHint && !skip.includes(t.name))) {
      const r = await call(t.name, args[t.name] || {});
      expect(r.isError, `${t.name}: ${r.text}`).toBe(false);
    }
  });
});
