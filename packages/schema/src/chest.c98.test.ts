import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './defaults';
import { loadProjectJson, SCHEMA_VERSION } from './migrate';
import { validateProject } from './validate';
import type { Physics } from './types';

const item = (): Physics => ({
  id: 'ph',
  partId: 'chest',
  preset: 'chest',
  deform: 'bounce',
  strength: 0.5,
  direction: 'both',
  length: 100,
  spring: 120,
  damping: 5,
  gravity: 0,
  inertia: 1.5,
  range: 1,
  inputs: [{ parameterId: 'BodyAngleZ', weight: 0.2, axis: 'horizontal' }],
  outputParameterId: 'BustX',
  verticalOutputParameterId: 'BustY',
  bounce: {
    gravityStrength: 0.3,
    referenceCenter: { x: 50, y: 100 },
    referenceBasis: [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
    amplitudes: { x: 4, y: 6 },
    meshId: 'm',
    meshSignature: 'saved',
    weights: [0, 1, 0],
    bindingIds: ['bx', 'by'],
    pinning: { topBand: 0.15, bottomBand: 0.2, freeWidth: 0.6 },
  },
});
describe('胸の先行契約', () => {
  it('5→6は旧モデル・物理・入力の意味を保ち、胸を追加しない', () => {
    const p = createEmptyProject('旧版');
    p.schemaVersion = 5;
    const ph = item();
    delete ph.bounce;
    delete ph.deform;
    delete ph.verticalOutputParameterId;
    ph.preset = 'hair';
    ph.inputs = [{ parameterId: 'FaceAngleX', weight: 1 }];
    p.physics = [ph];
    const result = loadProjectJson(JSON.stringify(p));
    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.model).toEqual(p.model);
    expect(result.physics).toEqual(p.physics);
    expect(result.model.parameters.some((p) => p.id === 'BustX' || p.id === 'BustY')).toBe(false);
  });
  it('2出力・固定範囲・基準姿勢を保存し、参照切れはIOの修復に渡す', () => {
    const p = createEmptyProject('胸');
    p.physics = [item()];
    expect(loadProjectJson(JSON.stringify(p))).toEqual(p);
    expect(JSON.stringify(p)).not.toMatch(/velocity|frameId|simulated/);
  });
  it.each([
    (p: Physics) => {
      p.verticalOutputParameterId = p.outputParameterId;
    },
    (p: Physics) => {
      delete p.bounce;
    },
    (p: Physics) => {
      p.bounce!.referenceBasis = [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ];
    },
    (p: Physics) => {
      p.bounce!.gravityStrength = 1.1;
    },
    (p: Physics) => {
      p.bounce!.amplitudes.x = 0;
    },
    (p: Physics) => {
      p.bounce!.weights = [-0.1];
    },
    (p: Physics) => {
      p.bounce!.bindingIds = ['same', 'same'];
    },
    (p: Physics) => {
      p.spring = 0;
    },
    (p: Physics) => {
      p.damping = -1;
    },
  ])('危険な数値・退化した基準・同一出力を拒否する (%#)', (mutate) => {
    const p = createEmptyProject('不正');
    p.physics = [item()];
    mutate(p.physics[0]!);
    expect(() => validateProject(p)).toThrow();
  });
  it('モデル座標の指定は頂点のキーだけに許す', () => {
    const p = createEmptyProject('不正');
    p.model.bindings = [
      {
        id: 'b',
        target: { type: 'part', id: 'p' },
        channel: 'transform',
        vertexSpace: 'model',
        parameterIds: ['FaceAngleX'],
        keyValues: [[-30, 0, 30]],
        keys: [],
        generation: 'linear',
        divisions: null,
      },
    ];
    expect(() => validateProject(p)).toThrow();
  });
});
