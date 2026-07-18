import { describe, it, expect } from 'vitest';
import {
  challengeChecksum,
  buildChallengeUrl,
  parseChallenge,
  verifyChallenge,
  sanitizeName,
  MAX_NAME_LENGTH,
} from '../src/ui/share';

const PUZZLE = 'pentopia/10/10/2s9ziar5gbi6z6hai9s4//p';

describe('challengeChecksum', () => {
  it('is deterministic and 8 lowercase hex chars', async () => {
    const a = await challengeChecksum(PUZZLE, 222_600, 'Dariusz');
    const b = await challengeChecksum(PUZZLE, 222_600, 'Dariusz');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it('changes when any input changes', async () => {
    const base = await challengeChecksum(PUZZLE, 222_600, 'Dariusz');
    expect(await challengeChecksum(PUZZLE, 222_601, 'Dariusz')).not.toBe(base);
    expect(await challengeChecksum(PUZZLE, 222_600, 'dariusz')).not.toBe(base);
    expect(await challengeChecksum(PUZZLE + 'x', 222_600, 'Dariusz')).not.toBe(base);
  });
});

describe('buildChallengeUrl / parseChallenge / verifyChallenge', () => {
  it('round-trips through a URL and verifies', async () => {
    const url = await buildChallengeUrl('https://example.com/pentopia/', PUZZLE, 222_600, 'Dariusz');
    expect(url.startsWith('https://example.com/pentopia/challenge.html?')).toBe(true);
    const search = new URL(url).search;
    expect(new URLSearchParams(search).get('p')).toBe(PUZZLE);
    const ch = parseChallenge(search);
    expect(ch).not.toBeNull();
    expect(ch!.timeMs).toBe(222_600);
    expect(ch!.name).toBe('Dariusz');
    expect(await verifyChallenge(PUZZLE, ch!)).toBe(true);
  });

  it('rejects a tampered time', async () => {
    const url = await buildChallengeUrl('https://example.com/pentopia/', PUZZLE, 222_600, 'Dariusz');
    const params = new URLSearchParams(new URL(url).search);
    params.set('t', '1000'); // "I solved it in one second"
    const ch = parseChallenge(`?${params.toString()}`);
    expect(ch).not.toBeNull();
    expect(await verifyChallenge(PUZZLE, ch!)).toBe(false);
  });

  it('rejects a challenge replayed against a different puzzle', async () => {
    const url = await buildChallengeUrl('https://example.com/pentopia/', PUZZLE, 222_600, 'Dariusz');
    const ch = parseChallenge(new URL(url).search)!;
    expect(await verifyChallenge('pentopia/6/6/abc//p', ch)).toBe(false);
  });

  it('parses names with URL-hostile characters intact', async () => {
    const name = 'Żółć & spaces';
    const url = await buildChallengeUrl('https://example.com/pentopia/', PUZZLE, 61_000, name);
    const ch = parseChallenge(new URL(url).search)!;
    expect(ch.name).toBe(name);
    expect(await verifyChallenge(PUZZLE, ch)).toBe(true);
  });

  it('returns null on missing or malformed params', () => {
    expect(parseChallenge('')).toBeNull();
    expect(parseChallenge('?t=1000&n=Bob')).toBeNull(); // no checksum
    expect(parseChallenge('?t=abc&n=Bob&c=aabbccdd')).toBeNull(); // non-numeric time
    expect(parseChallenge('?t=-5&n=Bob&c=aabbccdd')).toBeNull(); // negative time
    expect(parseChallenge('?t=1000&n=Bob&c=nothex!!')).toBeNull(); // bad checksum shape
    expect(parseChallenge('?t=1000&n=%20%20&c=aabbccdd')).toBeNull(); // whitespace-only name
  });
});

describe('sanitizeName', () => {
  it('trims and caps length', () => {
    expect(sanitizeName('  Bob  ')).toBe('Bob');
    expect(sanitizeName('x'.repeat(100))).toHaveLength(MAX_NAME_LENGTH);
  });
});
