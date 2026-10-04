import { describe, expect, it } from 'vitest';
import { newId } from './ids';

describe('newId', () => {
  it('ULID の形（Crockford base32 の 26 文字）', () => {
    expect(newId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('続けて作っても重複せず、作った順に並ぶ', () => {
    const ids = Array.from({ length: 2000 }, () => newId());
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it('先頭 10 文字は時刻', () => {
    const before = Date.now();
    const id = newId();
    const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const time = [...id.slice(0, 10)].reduce((t, c) => t * 32 + ENCODING.indexOf(c), 0);
    expect(time).toBeGreaterThanOrEqual(before);
    expect(time).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
