import { describe, expect, it } from 'vitest';
import {
  base32Encode, base32Decode, generateSecret, totpCode, matchTotp, currentStep,
  otpauthUri, generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode,
} from '../src/lib/totp.js';

// The shared key from RFC 6238's test vectors: the ASCII text "12345678901234567890"
const RFC_SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'));

describe('base32', () => {
  it('matches the RFC 4648 examples', () => {
    const enc = (s) => base32Encode(new TextEncoder().encode(s));
    expect(enc('f')).toBe('MY');
    expect(enc('fo')).toBe('MZXQ');
    expect(enc('foobar')).toBe('MZXW6YTBOI');
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('decodes what it encodes, spaces and lower case included', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    const text = base32Encode(bytes);
    expect([...base32Decode(text)]).toEqual([...bytes]);
    expect([...base32Decode(text.toLowerCase().replace(/(.{4})/g, '$1 '))]).toEqual([...bytes]);
  });

  it('makes a 32-character key', () => {
    expect(generateSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
});

describe('codes', () => {
  it('match the RFC 6238 test vectors', async () => {
    // The last six digits of the RFC's 8-digit SHA-1 values
    const vectors = { 59: '287082', 1111111109: '081804', 1111111111: '050471', 1234567890: '005924', 2000000000: '279037' };
    for (const [secs, code] of Object.entries(vectors)) {
      expect(await totpCode(RFC_SECRET, Math.floor(secs / 30)), secs).toBe(code);
    }
  });

  it('accepts the code for now and one step either side, and nothing else', async () => {
    const now = 1111111111 * 1000;
    const step = currentStep(now);
    for (const s of [step - 1, step, step + 1]) {
      expect(await matchTotp(RFC_SECRET, await totpCode(RFC_SECRET, s), { now })).toBe(s);
    }
    expect(await matchTotp(RFC_SECRET, await totpCode(RFC_SECRET, step - 2), { now })).toBeNull();
    expect(await matchTotp(RFC_SECRET, await totpCode(RFC_SECRET, step + 2), { now })).toBeNull();
    expect(await matchTotp(RFC_SECRET, '12345', { now })).toBeNull();
    expect(await matchTotp(RFC_SECRET, 'abcdef', { now })).toBeNull();
    expect(await matchTotp(RFC_SECRET, ' 050 471 ', { now })).toBe(step);
  });

  it('does not accept a code at or before the last one used', async () => {
    const now = 1111111111 * 1000;
    const step = currentStep(now);
    const code = await totpCode(RFC_SECRET, step);
    expect(await matchTotp(RFC_SECRET, code, { now, after: step - 1 })).toBe(step);
    expect(await matchTotp(RFC_SECRET, code, { now, after: step })).toBeNull();
  });

  it('builds the address a QR code carries', () => {
    expect(otpauthUri('ABC', 'officer@example.com', 'W4TRC Members'))
      .toBe('otpauth://totp/W4TRC%20Members%3Aofficer%40example.com?secret=ABC&issuer=W4TRC%20Members&algorithm=SHA1&digits=6&period=30');
  });
});

describe('recovery codes', () => {
  it('makes eight different codes and stores only their hashes', async () => {
    const { codes, hashes } = await generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const code of codes) expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    expect(hashes).toEqual(await Promise.all(codes.map(hashRecoveryCode)));
    expect(hashes.join()).not.toContain(codes[0].replace('-', ''));
  });

  it('reads a code however it is typed', async () => {
    expect(await hashRecoveryCode('ABCDE fghjk')).toBe(await hashRecoveryCode('abcde-fghjk'));
    expect(looksLikeRecoveryCode('abcde-fghjk')).toBe(true);
    expect(looksLikeRecoveryCode('123456')).toBe(false);
  });
});
