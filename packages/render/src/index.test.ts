import { describe, expect, it } from 'vitest';
import * as mod from './index';

describe('@app/render', () => {
  it('createWebGLRenderer と applyBlend を公開する', () => {
    expect(mod.createWebGLRenderer).toBeTypeOf('function');
    expect(mod.applyBlend).toBeTypeOf('function');
  });

  it('作るだけなら GL を使わない（init で canvas を受け取る）', () => {
    const r = mod.createWebGLRenderer();
    expect(() =>
      r.render({ items: [], byPartId: {} }, { scale: 1, offset: { x: 0, y: 0 } }, { type: 'transparent' }),
    ).toThrow('init の前に render を呼んだ');
    r.dispose();
  });
});
