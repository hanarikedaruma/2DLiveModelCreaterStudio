import { describe, expect, it } from 'vitest';
import { loadProjectJson, SCHEMA_VERSION } from './migrate';
import { validateProject } from './validate';
import { createEmptyProject } from './defaults';
import type { Animation } from './types';
const project = () => ({
  ...createEmptyProject('I-060'),
  animations: [
    {
      id: 'a',
      name: 'motion',
      duration: 1,
      speed: 1,
      loop: false,
      periodic: false,
      restart: 'restart',
      affectedGroups: [],
      tracks: [],
      transition: {
        preset: 'auto',
        blendIn: 0.35,
        blendOut: 0.4,
        curve: 'smooth',
        blendMode: 'override',
        keepLipSync: true,
        keepPhysics: true,
        returnToTracking: true,
      },
    } as Animation,
  ],
});
describe('現在の姿勢からの実験設定の保存（I-060）', () => {
  it('9→10は従来の遷移とキーを変えず、省略をOFFとして保つ', () => {
    const p = project();
    p.schemaVersion = 9;
    const out = loadProjectJson(JSON.stringify(p));
    expect(out.schemaVersion).toBe(SCHEMA_VERSION);
    expect(out.animations).toEqual(p.animations);
    expect(out.animations[0]!.transition.startFromCurrent).toBeUndefined();
  });
  it('ON/OFFを保存して読み直せる', () => {
    for (const value of [true, false]) {
      const p = project();
      p.animations[0]!.transition.startFromCurrent = value;
      expect(loadProjectJson(JSON.stringify(p)).animations[0]!.transition.startFromCurrent).toBe(value);
    }
  });
  it('数値や文字列を実験のONとして受け入れない', () => {
    const p = project();
    Object.assign(p.animations[0]!.transition, { startFromCurrent: 'true' });
    expect(() => validateProject(p)).toThrow();
  });
});
