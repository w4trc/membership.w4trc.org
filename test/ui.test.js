import { describe, expect, it } from 'vitest';
import { serveUI } from '../src/ui.js';

// The app's script as the browser gets it, after the page template has run
async function servedScript() {
  const html = await serveUI(new Request('https://members.w4trc.org/'), {}).text();
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}

// Pull one top-level function out of the served script and make it callable
async function servedFunction(name) {
  const script = await servedScript();
  const start = script.indexOf(`function ${name}(`);
  const end = script.indexOf('\n}\n', start);
  return new Function(`${script.slice(start, end + 2)}; return ${name};`)();
}

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
