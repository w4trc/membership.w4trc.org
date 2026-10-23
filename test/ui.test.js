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
