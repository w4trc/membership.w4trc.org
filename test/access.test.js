import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';
import { mayCallApi } from '../src/lib/auth.js';
import { resetDb, addMember } from './helpers.js';

const SESSIONS = { member: 'a'.repeat(64), board: 'b'.repeat(64), admin: 'c'.repeat(64) };
let memberId;

async function addLogin(role, linkedMember = null) {
  const user = await env.DB.prepare(
    `INSERT INTO users (email, password_hash, role, member_id) VALUES (?, 'x', ?, ?)`
  ).bind(`${role}@example.com`, role, linkedMember).run();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, ip_address, user_agent, expires_at) VALUES (?, ?, '', '', ?)`
  ).bind(SESSIONS[role], user.meta.last_row_id, new Date(Date.now() + 3600e3).toISOString()).run();
}

// A request through the whole worker, the way the browser makes it
async function call(role, method, path) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request('https://members.w4trc.org' + path, {
    method,
    headers: role ? { Cookie: `karc_session=${SESSIONS[role]}` } : {},
  }), env, ctx);
  await waitOnExecutionContext(ctx);
  return res.status;
}

beforeEach(async () => {
  await resetDb();
  memberId = await addMember({ callsign: 'KT4MEM' });
  const other = await addMember({ callsign: 'KT4OTH' });
  await addLogin('member', memberId);
  await addLogin('board');
  await addLogin('admin');
  OFFICER_READS.other = other;
});

// Every area of the officers' API, by one address that reads from it
const OFFICER_READS = {
  paths: () => [
    '/api/members',
    '/api/members/export',
    `/api/members/${OFFICER_READS.other}`,
    `/api/members/${OFFICER_READS.other}/history`,
    '/api/memberships',
    '/api/memberships/stats',
    '/api/donations',
    '/api/donations/stats',
    '/api/reminders',
    `/api/notes?member_id=${OFFICER_READS.other}`,
    '/api/meetings',
    '/api/agendas',
    '/api/officers',
    '/api/inventory',
    '/api/repeaters',
    '/api/prospects',
    '/api/admin/stats',
    '/api/admin/charts',
    '/api/admin/callsigns',
    '/api/admin/treasurer-report',
  ],
};

const ADMIN_READS = ['/api/admin/users', '/api/admin/audit', '/api/admin/sessions'];

describe('who may call the API', () => {
  it('turns away anyone who is not logged in', async () => {
    for (const path of [...OFFICER_READS.paths(), ...ADMIN_READS]) {
      expect(await call(null, 'GET', path), path).toBe(401);
    }
  });

  it('keeps members out of every officer area, including their own record there', async () => {
    for (const path of [...OFFICER_READS.paths(), ...ADMIN_READS, `/api/members/${memberId}`, '/api/lookup/W4TRC']) {
      expect(await call('member', 'GET', path), path).toBe(403);
    }
    for (const [method, path] of [['POST', '/api/members'], ['DELETE', `/api/members/${memberId}`], ['POST', '/api/admin/cutoff'], ['POST', '/api/something-new']]) {
      expect(await call('member', method, path), path).toBe(403);
    }
  });

  it('lets board members read every officer area', async () => {
    for (const path of OFFICER_READS.paths()) {
      expect(await call('board', 'GET', path), path).toBe(200);
    }
  });

  it('keeps the admin-only areas for admins', async () => {
    for (const path of ADMIN_READS) {
      expect(await call('board', 'GET', path), path).toBe(403);
      expect(await call('admin', 'GET', path), path).toBe(200);
    }
    expect(await call('board', 'DELETE', `/api/members/${memberId}`)).toBe(403);
  });

  it('shows the printable directory, with its phone numbers and emails, to officers only', async () => {
    const page = async (role) => {
      const ctx = createExecutionContext();
      const res = await worker.fetch(new Request('https://members.w4trc.org/print', {
        redirect: 'manual',
        headers: role ? { Cookie: `karc_session=${SESSIONS[role]}` } : {},
      }), env, ctx);
      await waitOnExecutionContext(ctx);
      return res.status;
    };
    expect(await page(null)).toBe(302);
    expect(await page('member')).toBe(302);
    expect(await page('board')).toBe(200);
  });

  it('still gives members their portal, password change and online payment', async () => {
    expect(await call('member', 'GET', '/api/portal/me')).toBe(200);
    expect(await call('member', 'GET', '/api/portal/history')).toBe(200);
    const member = { role: 'member' };
    expect(mayCallApi(member, '/api/admin/password')).toBe(true);
    expect(mayCallApi(member, '/api/stripe/create-checkout')).toBe(true);
    expect(mayCallApi(member, '/api/stripe/create-donation-checkout')).toBe(true);
    expect(mayCallApi(member, '/api/admin/passwords')).toBe(false);
    expect(mayCallApi(member, '/api/admin/users')).toBe(false);
  });
});
