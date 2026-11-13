import { describe, expect, it } from 'vitest';
import { serveUI } from '../src/ui.js';
import appScript from '../public/app.js?raw';

// The app's script as the browser gets it (a Windows checkout has CRLF line ends)
async function servedScript() {
  return appScript.replace(/\r\n/g, '\n');
}

// Pull one top-level function out of the served script and make it callable
async function servedFunction(name) {
  const script = await servedScript();
  const start = script.indexOf(`function ${name}(`);
  const end = script.indexOf('\n}\n', start);
  return new Function(`${script.slice(start, end + 2)}; return ${name};`)();
}

describe('served page', () => {
  it('loads the stylesheet and script from their own files', async () => {
    const html = await serveUI(new Request('https://members.w4trc.org/admin/members'), {}).text();
    expect(html).toContain('<link rel="stylesheet" href="/app.css">');
    expect(html).toContain('<script src="/app.js"></script>');
    expect(html).not.toMatch(/<style|<script>/);
  });
});

describe('served page script', () => {
  it('parses', async () => {
    const script = await servedScript();
    expect(() => new Function(script)).not.toThrow();
  });
});

describe('localToday', () => {
  it('is the local calendar date as YYYY-MM-DD', async () => {
    const localToday = await servedFunction('localToday');
    const now = new Date();
    const [y, m, d] = localToday().split('-').map(Number);
    expect(localToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([y, m, d]).toEqual([now.getFullYear(), now.getMonth() + 1, now.getDate()]);
  });
});

describe('fmtDate', () => {
  it('shows a plain date as that calendar day, with no time', async () => {
    const fmtDate = await servedFunction('fmtDate');
    expect(fmtDate('2026-10-22')).toBe('Oct 22, 2026');
    expect(fmtDate('2026-01-01')).toBe('Jan 1, 2026');
  });

  it('reads a D1 datetime as UTC', async () => {
    const fmtDate = await servedFunction('fmtDate');
    const expected = new Date(Date.UTC(2026, 9, 22, 14, 5)).toLocaleString('en-US',
      { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    expect(fmtDate('2026-10-22 14:05:00')).toBe(expected);
    expect(fmtDate('2026-10-22T14:05:00Z')).toBe(expected);
  });

  it('keeps a time zone that is already there', async () => {
    const fmtDate = await servedFunction('fmtDate');
    const expected = new Date(Date.UTC(2026, 9, 22, 14, 5)).toLocaleString('en-US',
      { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    expect(fmtDate('2026-10-22T10:05:00-04:00')).toBe(expected);
    expect(fmtDate('2026-10-22T14:05:00+00:00')).toBe(expected);
  });

  it('falls back to the raw text instead of "Invalid Date"', async () => {
    const fmtDate = await servedFunction('fmtDate');
    expect(fmtDate('not a date')).toBe('not a date');
    expect(fmtDate(null)).toBe('—');
  });
});

describe('repeater note Markdown', () => {
  async function render() {
    const script = await servedScript();
    const grab = (name) => {
      const start = script.indexOf(`function ${name}(`);
      return script.slice(start, script.indexOf('\n}\n', start) + 2);
    };
    const esc = grab('escHtml');
    return new Function(`${esc}${grab('rptSafeUrl')}${grab('rptInline')}${grab('rptMarkdown')}; return rptMarkdown;`)();
  }

  it('formats headings, emphasis, lists, checklists, code, and links', async () => {
    const md = await render();
    const html = md('# Internet\n**Spectrum** business, *static* IP `203.0.113.10`\n\n- [x] Modem in rack\n- [ ] Label the router\n\n1. One\n2. Two\n\nSee [portal](https://example.com/a?b=1&c=2) or https://example.org.');
    expect(html).toContain('<h3>Internet</h3>');
    expect(html).toContain('<strong>Spectrum</strong>');
    expect(html).toContain('<em>static</em>');
    expect(html).toContain('<code>203.0.113.10</code>');
    expect(html).toContain('<li class="rpt-task done">☑ Modem in rack</li>');
    expect(html).toContain('<li class="rpt-task">☐ Label the router</li>');
    expect(html).toContain('<ol><li>One</li><li>Two</li></ol>');
    expect(html).toContain('<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">portal</a>');
    expect(html).toContain('<a href="https://example.org" target="_blank"');
    expect(html).toMatch(/example\.org<\/a>\.<\/p>$/);
  });

  it('keeps HTML and script out of the page', async () => {
    const md = await render();
    const html = md('<img src=x onerror=alert(1)> [click](javascript:alert(1)) `<b>` **<script>**\n```\n<script>alert(1)</script>\n```');
    expect(html).not.toMatch(/<img|<script|<b>|href="javascript/i);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('[click](javascript:alert(1))');
    expect(html).toContain('<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>');
  });
});

describe('page addresses', () => {
  it('round-trips every admin page, detail page, and portal page', async () => {
    const adminPath = await servedFunction('adminPath');
    const portalPath = await servedFunction('portalPath');
    const parseRoute = await servedFunction('parseRoute');

    expect(adminPath('dashboard')).toBe('/admin');
    expect(adminPath('googleGroups')).toBe('/admin/google-groups');
    expect(adminPath('repeaters', 3, 'maintenance')).toBe('/admin/repeaters/3/maintenance');
    expect(portalPath('portal-home')).toBe('/portal');
    expect(portalPath('portal-history')).toBe('/portal/history');

    for (const page of ['dashboard', 'members', 'googleGroups', 'agendas']) {
      expect(parseRoute(adminPath(page))).toMatchObject({ shell: 'admin', page });
    }
    expect(parseRoute('/admin/members/42')).toMatchObject({ page: 'members', id: '42' });
    expect(parseRoute('/admin/repeaters/site/photos')).toMatchObject({ page: 'repeaters', id: 'site', tab: 'photos' });
    for (const page of ['portal-home', 'portal-profile', 'portal-donate']) {
      expect(parseRoute(portalPath(page))).toEqual({ shell: 'portal', page });
    }
  });

  it('leaves other addresses to the default landing page', async () => {
    const parseRoute = await servedFunction('parseRoute');
    expect(parseRoute('/')).toBeNull();
    expect(parseRoute('/i/12')).toBeNull();
    expect(parseRoute('/reset-password')).toBeNull();
  });

  it('says in plain words what a merge will do', async () => {
    const mergeSummary = await servedFunction('mergeSummary');
    const person = (callsign) => ({ callsign, first_name: 'Pat', last_name: 'Ham' });
    const counts = { notes: 0, donations: 2, attendance: 1, officers: 0, inventory: 0, reminders: 0, covers: 0 };

    expect(mergeSummary({
      from: person('KO4OLD'), into: person('W4NEW'),
      fill: { phone: '423-555-0100', is_active: 1 },
      dues: {
        move: [2024, 2025],
        conflicts: [{
          year: 2026, keep: 'into',
          kept: { status: 'active', amount_paid: 20, payment_method: 'stripe' },
          dropped: { status: 'pending', amount_paid: null },
        }],
      },
      counts,
      login: { email: 'pat@example.com', action: 'move' },
    })).toEqual([
      'W4NEW Pat Ham gains: phone (423-555-0100), active status',
      'Dues records move: 2024, 2025',
      '2026: both records have dues. Keeping the one from W4NEW Pat Ham ($20.00 paid by stripe); the other (pending, nothing paid) is dropped',
      'Also moves: 2 donations, 1 meeting attended',
      'The portal sign-in (pat@example.com) moves to the kept record',
    ]);

    expect(mergeSummary({
      from: person('KO4OLD'), into: person('W4NEW'), fill: {}, dues: { move: [], conflicts: [] },
      counts: { ...counts, donations: 0, attendance: 0 }, login: null,
    })).toEqual(['Nothing is attached to KO4OLD Pat Ham, so nothing moves']);
  });

  it('gives every sidebar link the address its page answers to', async () => {
    const html = await serveUI(new Request('https://members.w4trc.org/'), {}).text();
    const adminPath = await servedFunction('adminPath');
    const portalPath = await servedFunction('portalPath');
    const links = [...html.matchAll(/<a class="nav-item[^>]*href="([^"]+)" data-(p?)page="([^"]+)"/g)];
    expect(links.length).toBe(21);
    for (const [, href, portal, page] of links) {
      expect(href).toBe(portal ? portalPath(page) : adminPath(page));
    }
  });
});
