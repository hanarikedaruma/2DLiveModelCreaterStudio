import { describe, expect, it } from 'vitest';
import { createDefaultEnvironment, createEmptyProject } from './defaults';
import type { Binding, Project } from './types';
import { ProjectValidationError, formatPath, validateEnvironment, validateProject } from './validate';

// すべての種類の項目を1つずつ持つプロジェクト
function fullProject(): Project {
  const p = createEmptyProject('全部入り');
  return {
    ...p,
    assets: [
      {
        id: 'a1',
        path: 'assets/a1.png',
        hash: 'ab'.repeat(32),
        width: 100,
        height: 50,
        offset: { x: 10, y: 20 },
        canvasSize: { width: 1000, height: 1500 },
        source: { kind: 'psd', file: 'model.psd', layerName: '顔', layerPath: ['頭', '顔'], hidden: false },
        sourceBlendMode: 'normal',
        sourceOpacity: 1,
      },
    ],
    model: {
      ...p.model,
      parts: [
        {
          id: 'g1',
          name: '頭',
          kind: 'group',
          standardType: 'headRoot',
          assetId: null,
          meshId: null,
          parentId: null,
          position: { x: 0, y: 0 },
          rotation: 0,
          scale: { x: 1, y: 1 },
          pivot: { x: 500, y: 600 },
          opacity: 1,
          blendMode: 'normal',
          depth: 0,
          mask: null,
          physicsId: null,
          visible: true,
          locked: false,
        },
        {
          id: 'p1',
          name: '顔',
          kind: 'image',
          standardType: 'face',
          assetId: 'a1',
          meshId: 'm1',
          parentId: 'g1',
          position: { x: 0, y: 0 },
          rotation: 0,
          scale: { x: 1, y: 1 },
          pivot: { x: 60, y: 45 },
          opacity: 1,
          blendMode: 'multiply',
          depth: 0.2,
          mask: { sourcePartIds: ['g1'], inverted: true },
          physicsId: 'ph1',
          visible: true,
          locked: false,
        },
      ],
      meshes: [
        {
          id: 'm1',
          vertices: [
            { x: 10, y: 20 },
            { x: 110, y: 20 },
            { x: 10, y: 70 },
          ],
          uvs: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
          ],
          triangles: [[0, 1, 2]],
          density: 'standard',
          edited: false,
        },
      ],
      warps: [
        {
          id: 'w1',
          partId: 'g1',
          columns: 1,
          rows: 1,
          bounds: { x: 0, y: 0, width: 10, height: 10 },
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 0, y: 10 },
            { x: 10, y: 10 },
          ],
        },
      ],
      drawOrder: ['p1'],
      bindings: [
        {
          id: 'b1',
          target: { type: 'part', id: 'p1' },
          channel: 'transform',
          parameterIds: ['FaceAngleX'],
          keyValues: [[-30, 0, 30]],
          keys: [
            {
              coords: [30],
              delta: { position: { x: 5, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: 1 },
              source: 'manual',
              locked: false,
            },
          ],
          generation: 'linear',
          divisions: null,
        },
        {
          id: 'b2',
          target: { type: 'mesh', id: 'm1' },
          channel: 'vertices',
          parameterIds: ['EyeOpenL', 'EyeSmileL'],
          keyValues: [
            [0, 1],
            [0, 1],
          ],
          keys: [
            {
              coords: [0, 0],
              delta: [
                { x: 0, y: 1 },
                { x: 0, y: 1 },
                { x: 0, y: 0 },
              ],
              source: 'auto',
              locked: true,
            },
          ],
          generation: 'depth',
          divisions: 4,
        },
      ],
      lipSync: { mouthSource: 'micOnly', strength: 'high', vowels: [{ vowel: 'a', values: { MouthOpen: 1 } }] },
      setupHints: { closedLineL: [{ x: 1, y: 2 }], closedLineR: null },
    },
    expressions: [
      {
        id: 'e1',
        name: '笑顔',
        entries: [{ parameterId: 'MouthForm', value: 1, blend: 'add' }],
        fadeIn: 0.2,
        fadeOut: 0.3,
      },
    ],
    animations: [
      {
        id: 'an1',
        name: 'うなずき',
        duration: 2,
        speed: 1,
        loop: false,
        periodic: false,
        tracks: [{ parameterId: 'FaceAngleY', keyframes: [{ time: 0, value: 0, curve: 'smooth' }] }],
        affectedGroups: ['face'],
        restart: 'restart',
        transition: {
          preset: 'natural',
          blendIn: 0.3,
          blendOut: 0.3,
          curve: 'smooth',
          blendMode: 'addToTracking',
          keepLipSync: true,
          keepPhysics: true,
          returnToTracking: true,
        },
      },
    ],
    physics: [
      {
        id: 'ph1',
        partId: 'p1',
        preset: 'hair',
        strength: 0.5,
        direction: 'both',
        length: 120,
        spring: 0.5,
        damping: 0.3,
        gravity: 1,
        inertia: 0.5,
        range: 30,
        inputs: [{ parameterId: 'FaceAngleX', weight: 1 }],
        outputParameterId: 'HairFront',
      },
    ],
    trackingMappings: [
      {
        input: 'faceYaw',
        parameterId: 'FaceAngleX',
        inputRange: [-30, 30],
        outputRange: [-30, 30],
        invert: false,
        curve: 'linear',
        smoothing: 0.5,
        deadZone: 0.5,
        weight: 1,
      },
    ],
    trackingSetup: { mode: 'custom', combine: [{ parameterId: 'FaceAngleX', method: 'average' }] },
    studio: {
      scenes: [
        ...p.studio.scenes,
        {
          id: 's2',
          name: '画像',
          background: { type: 'image', path: 'backgrounds/room.png' },
          modelTransform: { position: { x: 10, y: -20 }, scale: 1.5 },
          expressionIds: ['e1'],
          periodicAnimationIds: [],
        },
        {
          id: 's3',
          name: '緑',
          background: { type: 'color', color: '#00ff00' },
          modelTransform: { position: { x: 0, y: 0 }, scale: 1 },
          expressionIds: [],
          periodicAnimationIds: ['an1'],
        },
      ],
      activeSceneId: 's2',
      hotkeys: [{ id: 'h1', keys: 'Ctrl+Shift+1', action: 'expression', targetId: 'e1', mode: 'toggle' }],
    },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function errorOf(fn: () => unknown): ProjectValidationError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ProjectValidationError) return e;
    throw e;
  }
  throw new Error('エラーにならなかった');
}

function paths(json: unknown): string[] {
  return errorOf(() => validateProject(json)).issues.map((i) => i.path);
}

describe('validateProject', () => {
  it('createEmptyProject の結果が通る', () => {
    const p = createEmptyProject('テスト');
    expect(validateProject(p)).toEqual(p);
  });

  it('すべての種類の項目を持つプロジェクトが通る', () => {
    const p = fullProject();
    expect(validateProject(clone(p))).toEqual(p);
  });

  it('型が違う項目でパス付きのエラーになる', () => {
    const broken = clone(fullProject()) as unknown as { model: { parts: { pivot: { x: unknown } }[] } };
    broken.model.parts[1]!.pivot.x = '60';
    const e = errorOf(() => validateProject(broken));
    expect(e.issues).toEqual([{ path: 'model.parts[1].pivot.x', message: '数値であるべきところが文字列' }]);
    expect(e.message).toContain('model.parts[1].pivot.x');
  });

  it('必須の項目が無い・列挙の外の値もパス付きで知らせる', () => {
    const broken = clone(fullProject()) as unknown as {
      model: { meshes: Record<string, unknown>[]; parts: Record<string, unknown>[] };
      studio: { scenes: Record<string, unknown>[] };
    };
    delete broken.model.meshes[0]!.edited;
    broken.model.parts[0]!.blendMode = 'overlay';
    broken.studio.scenes[1]!.background = { type: 'video' };
    expect(paths(broken)).toEqual(
      expect.arrayContaining([
        'model.parts[0].blendMode',
        'model.meshes[0].edited',
        'studio.scenes[1].background.type',
      ]),
    );
  });

  it('範囲外の値（opacity）でエラーになる', () => {
    const broken = clone(fullProject());
    broken.model.parts[1]!.opacity = 1.5;
    expect(paths(broken)).toEqual(['model.parts[1].opacity']);
  });

  it('メッシュの頂点数と UV・三角形の番号の食い違いを見つける', () => {
    const broken = clone(fullProject());
    broken.model.meshes[0]!.uvs.pop();
    broken.model.meshes[0]!.triangles.push([0, 1, 3]);
    expect(paths(broken)).toEqual(['model.meshes[0].uvs', 'model.meshes[0].triangles[1][2]']);
  });

  it('ワープの制御点の数を確かめる', () => {
    const broken = clone(fullProject());
    broken.model.warps[0]!.columns = 2;
    expect(paths(broken)).toEqual(['model.warps[0].points']);
  });

  it('バインディングの形の食い違いを見つける', () => {
    const broken = clone(fullProject());
    const [b1, b2] = broken.model.bindings as [Binding, Binding];
    b1.keyValues = [[0, -30, 30]]; // 昇順でない
    b1.keys[0]!.coords = [1, 2];
    b2.target.type = 'part'; // vertices の対象は mesh
    b2.keys[0]!.delta = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: 1 };
    expect(paths(broken)).toEqual([
      'model.bindings[0].keyValues[0][1]',
      'model.bindings[0].keys[0].coords',
      'model.bindings[1].target.type',
      'model.bindings[1].keys[0].delta',
    ]);
  });

  it('パラメータの範囲（min < max、default は範囲内）', () => {
    const broken = clone(fullProject());
    broken.model.parameters[0]!.default = 99;
    broken.model.parameters[1]!.max = -30;
    expect(paths(broken)).toEqual([
      'model.parameters[0].default',
      'model.parameters[1].max',
      'model.parameters[1].default',
    ]);
  });

  it('トラッキングの割り当ての重みは 0 以上、合わせ方の同じパラメータは1つだけ（I-042）', () => {
    const p = fullProject();
    const negative = { ...p, trackingMappings: [{ ...p.trackingMappings[0]!, weight: -1 }] };
    expect(() => validateProject(negative)).toThrow(/trackingMappings\[0\]\.weight/);
    const twice = {
      ...p,
      trackingSetup: {
        mode: 'custom' as const,
        combine: [
          { parameterId: 'FaceAngleX', method: 'add' as const },
          { parameterId: 'FaceAngleX', method: 'priority' as const },
        ],
      },
    };
    expect(() => validateProject(twice)).toThrow(/同じパラメータが2回ある/);
  });

  it('id の重複を見つける', () => {
    const broken = clone(fullProject());
    broken.model.parts[1]!.id = 'g1';
    expect(paths(broken)).toEqual(['model.parts[1].id']);
  });

  it('オブジェクトでないものはエラー', () => {
    expect(paths(null)).toEqual(['']);
    expect(() => validateProject([])).toThrow(ProjectValidationError);
  });

  it('知らない項目は落とす', () => {
    const p = { ...createEmptyProject('x'), extra: 1 };
    expect(validateProject(p)).not.toHaveProperty('extra');
  });
});

describe('formatPath', () => {
  it('配列の番号は []、名前は . でつなぐ', () => {
    expect(formatPath(['model', 'parts', 3, 'pivot', 'x'])).toBe('model.parts[3].pivot.x');
    expect(formatPath(['model', 'lipSync', 'vowels', 0, 'values', 'my param'])).toBe(
      'model.lipSync.vowels[0].values["my param"]',
    );
    expect(formatPath([])).toBe('');
  });
});

describe('validateEnvironment', () => {
  it('既定値が通り、形が違うとパス付きのエラー', () => {
    const env = createDefaultEnvironment();
    expect(validateEnvironment(env)).toEqual(env);
    const e = errorOf(() => validateEnvironment({ ...env, uiLevel: { ...env.uiLevel, studio: 'expert' } }));
    expect(e.issues.map((i) => i.path)).toEqual(['uiLevel.studio']);
  });
});
