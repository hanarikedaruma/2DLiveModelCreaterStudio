import { describe, expect, it } from 'vitest';
import { clickSelection, contextTargets, pruneSelection } from './selection';

describe('選択', () => {
  it('クリックはそれだけ、Ctrl・Shift は足す・外す', () => {
    expect(clickSelection(['a', 'b'], 'c', false)).toEqual(['c']);
    expect(clickSelection(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(clickSelection(['a', 'b'], 'a', true)).toEqual(['b']);
  });

  it('右クリックの対象', () => {
    expect(contextTargets(['a', 'b'], 'b')).toEqual(['a', 'b']);
    expect(contextTargets(['a', 'b'], 'c')).toEqual(['c']);
  });

  it('消えたパーツを外す', () => {
    const current = ['a', 'b'];
    expect(pruneSelection(current, new Set(['a', 'b', 'c']))).toBe(current);
    expect(pruneSelection(current, new Set(['b']))).toEqual(['b']);
  });
});
