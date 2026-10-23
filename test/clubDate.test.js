import { describe, expect, it } from 'vitest';
import { clubToday, clubYear } from '../src/lib/clubDate.js';

describe('clubToday', () => {
  it('is the Eastern date, not the UTC one', () => {
    // 9:30 PM Eastern on Oct 22 (EDT, UTC-4) is already Oct 23 in UTC
    expect(clubToday(new Date('2026-10-23T01:30:00Z'))).toBe('2026-10-22');
    // 7:30 PM Eastern on Dec 31 (EST, UTC-5)
    expect(clubToday(new Date('2027-01-01T00:30:00Z'))).toBe('2026-12-31');
    expect(clubYear(new Date('2027-01-01T00:30:00Z'))).toBe(2026);
  });

  it('turns over at midnight Eastern', () => {
    expect(clubToday(new Date('2027-01-01T04:59:00Z'))).toBe('2026-12-31');
    expect(clubToday(new Date('2027-01-01T05:00:00Z'))).toBe('2027-01-01');
    expect(clubYear(new Date('2027-01-01T05:00:00Z'))).toBe(2027);
  });

  it('matches UTC during the day', () => {
    expect(clubToday(new Date('2026-03-15T15:00:00Z'))).toBe('2026-03-15');
  });
});
