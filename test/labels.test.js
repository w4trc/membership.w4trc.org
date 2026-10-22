import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { handlePrintLabels, handleItemLink, parseIds, itemLink } from '../src/routes/labels.js';
import { qrSvg } from '../src/lib/qr.js';
import { resetDb } from './helpers.js';

const testEnv = {
  DB: env.DB, CLUB_NAME: 'Kingsport Amateur Radio Club', CLUB_CALLSIGN: 'W4TRC',
  CLUB_DOMAIN: 'members.w4trc.org', CONTACT_EMAIL: 'contact@example.org',
};

let sessions = 0;

/** A signed-in request from a user with `role`. */
async function request(path, role) {
  const id = String(++sessions).padStart(64, 'c');
  const user = await env.DB.prepare(
    `INSERT INTO users (email, password_hash, role) VALUES (?, 'x', ?)`
  ).bind(`labels${sessions}@example.com`, role).run();
  await env.DB.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`)
    .bind(id, user.meta.last_row_id, new Date(Date.now() + 60000).toISOString()).run();
  return new Request(`https://members.w4trc.org${path}`, { headers: { Cookie: `karc_session=${id}` } });
}

async function addItem(fields = {}) {
  const it = { name: 'Item', ...fields };
  const cols = Object.keys(it);
  const result = await env.DB.prepare(
    `INSERT INTO inventory_items (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).bind(...Object.values(it)).run();
  return result.meta.last_row_id;
}

const labelCount = (html) => (html.match(/<div class="label">/g) || []).length;
const qrCount = (html) => (html.match(/<svg /g) || []).length;

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM inventory_items').run();
  await resetDb();
});

describe('QR codes', () => {
  it('makes a square SVG with a quiet zone', () => {
    const svg = qrSvg('https://members.w4trc.org/i/12');
    // 29 modules (version 3) plus 2 on each side
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 33 33"/);
    expect(svg).toContain('<path d="M');
  });

  it('links each item to its own page', () => {
    expect(itemLink(testEnv, 12)).toBe('https://members.w4trc.org/i/12');
    expect(qrSvg(itemLink(testEnv, 12))).not.toBe(qrSvg(itemLink(testEnv, 13)));
  });
});

describe('parseIds', () => {
  it('keeps positive whole numbers once each', () => {
    expect(parseIds('3, 7,x,7,-1,0,2.5')).toEqual([3, 7]);
    expect(parseIds('')).toEqual([]);
    expect(parseIds(null)).toBeNull();
  });
});

describe('/print/labels', () => {
  it('sends anyone but board and admin back to the start page', async () => {
    for (const req of [new Request('https://members.w4trc.org/print/labels'), await request('/print/labels', 'member')]) {
      const res = await handlePrintLabels(req, testEnv);
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('/');
    }
  });

  it('prints a label for every item by default', async () => {
    const radio = await addItem({ name: 'HF Radio', manufacturer: 'Yaesu', model: 'FT-991A', serial_number: 'SN123' });
    await addItem({ name: 'Antenna Analyzer' });

    const res = await handlePrintLabels(await request('/print/labels', 'board'), testEnv);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(labelCount(html)).toBe(2);
    expect(qrCount(html)).toBe(2);
    expect(html).toContain('Yaesu FT-991A');
    expect(html).toContain('S/N SN123');
    expect(html).toContain(`Item #${radio}`);
    expect(html.indexOf('Antenna Analyzer')).toBeLessThan(html.indexOf('HF Radio'));
  });

  it('prints only the items asked for', async () => {
    const a = await addItem({ name: 'Wanted' });
    await addItem({ name: 'Not wanted' });

    const html = await (await handlePrintLabels(await request(`/print/labels?ids=${a}`, 'admin'), testEnv)).text();

    expect(labelCount(html)).toBe(1);
    expect(html).toContain('Wanted');
    expect(html).not.toContain('Not wanted');
    expect(html).toContain(`name="ids" value="${a}"`); // kept when the skip form is applied
  });

  it('leaves blank labels to reuse a partly used sheet', async () => {
    await addItem();
    const html = await (await handlePrintLabels(await request('/print/labels?skip=4', 'board'), testEnv)).text();

    expect(labelCount(html)).toBe(5);
    expect(qrCount(html)).toBe(1);
  });

  it('starts a new sheet after 30 labels', async () => {
    for (let i = 0; i < 31; i++) await addItem({ name: `Item ${i}` });
    const html = await (await handlePrintLabels(await request('/print/labels', 'board'), testEnv)).text();

    expect((html.match(/<div class="sheet">/g) || []).length).toBe(2);
  });

  it('escapes item text', async () => {
    await addItem({ name: '<script>alert(1)</script>' });
    const html = await (await handlePrintLabels(await request('/print/labels', 'board'), testEnv)).text();

    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('/i/:id (scanned label)', () => {
  const APP = 'the app';
  const scan = async (req) => handleItemLink(req, testEnv, () => new Response(APP));
  const anon = (path) => new Request(`https://members.w4trc.org${path}`);

  it('opens the item in the app for a signed-in officer', async () => {
    const id = await addItem({ name: 'HF Radio' });
    for (const role of ['board', 'admin']) {
      expect(await (await scan(await request(`/i/${id}`, role))).text()).toBe(APP);
    }
  });

  it('shows anyone else who owns it and how to get in touch', async () => {
    const id = await addItem({ name: 'HF Radio', serial_number: 'SECRET-SN' });
    await env.DB.prepare(`INSERT INTO inventory_locations (name) VALUES ('Joshua Garage')`).run();

    for (const req of [anon(`/i/${id}`), await request(`/i/${id}`, 'member')]) {
      const res = await scan(req);
      const html = await res.text();

      expect(res.status).toBe(200);
      expect(html).toContain('belongs to the Kingsport Amateur Radio Club (W4TRC)');
      expect(html).toContain('HF Radio');
      expect(html).toContain(`Item #${id}`);
      expect(html).toContain('mailto:contact@example.org?subject=' + encodeURIComponent(`Found equipment: HF Radio (item #${id})`));
      expect(html).toContain(`href="/i/${id}?signin"`);
      expect(html).not.toContain('SECRET-SN');
    }
  });

  it('serves the app to sign in when asked', async () => {
    const id = await addItem();
    expect(await (await scan(anon(`/i/${id}?signin`))).text()).toBe(APP);
  });

  it('still gives contact info for an unknown or deleted item', async () => {
    for (const path of ['/i/99999', '/i/abc', '/i/']) {
      const res = await scan(anon(path));
      const html = await res.text();
      expect(res.status).toBe(404);
      expect(html).toContain('mailto:contact@example.org');
    }
  });
});
