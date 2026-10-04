import { describe, expect, it } from 'vitest';
import { createEmptyScene } from '@app/schema';
import {
  BACKGROUND_PRESETS as HOTKEY_BACKGROUND_PRESETS,
  backgroundFromTargetId,
  backgroundTargetId,
} from '../../../hotkeys/targets';
import { BACKGROUND_PRESETS, backgroundImagePaths, backgroundLabel, findBackgroundPreset } from './presets';

describe('背景プリセット', () => {
  it('透明・緑・青・白・黒', () => {
    expect(BACKGROUND_PRESETS.map((p) => p.label)).toEqual(['透明', '緑', '青', '白', '黒']);
    expect(BACKGROUND_PRESETS.map((p) => p.background)).toEqual([
      { type: 'transparent' },
      { type: 'color', color: '#00ff00' },
      { type: 'color', color: '#0000ff' },
      { type: 'color', color: '#ffffff' },
      { type: 'color', color: '#000000' },
    ]);
  });

  it('ホットキー（カード40）の背景の対象と同じ値で、targetId を行き来できる', () => {
    expect(BACKGROUND_PRESETS.map(({ label, background }) => ({ label, background }))).toEqual(
      HOTKEY_BACKGROUND_PRESETS,
    );
    const image = { type: 'image', path: 'backgrounds/01ABC.png' } as const;
    for (const bg of [...BACKGROUND_PRESETS.map((p) => p.background), image]) {
      expect(backgroundFromTargetId(backgroundTargetId(bg))).toEqual(bg);
    }
  });

  it('大文字の色も同じプリセットとみなす。表示名', () => {
    expect(findBackgroundPreset({ type: 'color', color: '#00FF00' })?.label).toBe('緑');
    expect(findBackgroundPreset({ type: 'color', color: '#123456' })).toBeNull();
    expect(backgroundLabel({ type: 'transparent' })).toBe('透明');
    expect(backgroundLabel({ type: 'color', color: '#000000' })).toBe('黒');
    expect(backgroundLabel({ type: 'color', color: '#123456' })).toBe('色（#123456）');
    expect(backgroundLabel({ type: 'image', path: 'backgrounds/room.png' })).toBe('画像（room.png）');
  });

  it('画像のプリセットは backgrounds/ の画像とシーンで使っている画像（重なりを除いて名前の順）', () => {
    const s1 = { ...createEmptyScene('a'), background: { type: 'image', path: 'backgrounds/b.png' } } as const;
    const s2 = { ...createEmptyScene('b'), background: { type: 'color', color: '#00ff00' } } as const;
    const s3 = { ...createEmptyScene('c'), background: { type: 'image', path: 'backgrounds/z.png' } } as const;
    expect(backgroundImagePaths(['backgrounds/c.png', 'backgrounds/b.png'], [s1, s2, s3])).toEqual([
      'backgrounds/b.png',
      'backgrounds/c.png',
      'backgrounds/z.png',
    ]);
  });
});
