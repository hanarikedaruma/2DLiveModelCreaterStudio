import type { BlendMode } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { applyBlend } from './blend';

// 呼ばれた命令を記録する WebGL2 の代わり
function fakeGl() {
  const calls: unknown[][] = [];
  const gl = {
    BLEND: 'BLEND',
    FUNC_ADD: 'FUNC_ADD',
    ONE: 'ONE',
    DST_COLOR: 'DST_COLOR',
    ONE_MINUS_SRC_ALPHA: 'ONE_MINUS_SRC_ALPHA',
    ONE_MINUS_SRC_COLOR: 'ONE_MINUS_SRC_COLOR',
    enable: (...a: unknown[]) => calls.push(['enable', ...a]),
    blendEquation: (...a: unknown[]) => calls.push(['blendEquation', ...a]),
    blendFunc: (...a: unknown[]) => calls.push(['blendFunc', ...a]),
  };
  return { gl: gl as unknown as WebGL2RenderingContext, calls };
}

describe('applyBlend', () => {
  it('normal は乗算済みアルファの (ONE, ONE_MINUS_SRC_ALPHA)', () => {
    const { gl, calls } = fakeGl();
    applyBlend(gl, 'normal');
    expect(calls).toEqual([
      ['enable', 'BLEND'],
      ['blendEquation', 'FUNC_ADD'],
      ['blendFunc', 'ONE', 'ONE_MINUS_SRC_ALPHA'],
    ]);
  });

  it('加算・乗算・スクリーンの係数', () => {
    const expected: Record<Exclude<BlendMode, 'normal'>, string[]> = {
      add: ['ONE', 'ONE'],
      multiply: ['DST_COLOR', 'ONE_MINUS_SRC_ALPHA'],
      screen: ['ONE', 'ONE_MINUS_SRC_COLOR'],
    };
    for (const [mode, factors] of Object.entries(expected)) {
      const { gl, calls } = fakeGl();
      applyBlend(gl, mode as BlendMode);
      expect(calls).toEqual([
        ['enable', 'BLEND'],
        ['blendEquation', 'FUNC_ADD'],
        ['blendFunc', ...factors],
      ]);
    }
  });

  it('知らない値は normal で描く（古いデータなど）', () => {
    const { gl, calls } = fakeGl();
    applyBlend(gl, 'overlay' as BlendMode);
    expect(calls.at(-1)).toEqual(['blendFunc', 'ONE', 'ONE_MINUS_SRC_ALPHA']);
  });
});
