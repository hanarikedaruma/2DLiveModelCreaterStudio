import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEPTH,
  PARAMETER_GROUPS,
  PARALLAX_RATIO,
  STANDARD_DRAW_ORDER,
  STANDARD_PARAMETERS,
  STANDARD_PARAMETER_PHASES,
  STANDARD_PART_NAMES,
  STANDARD_PART_TYPES,
  depthParallaxOffset,
  standardParametersFor,
} from './rules';

// 設計書の表（id, group, min, max, default, フェーズ）
const TABLE: [string, string, number, number, number, string][] = [
  ['FaceAngleX', 'face', -30, 30, 0, 'mvp'],
  ['FaceAngleY', 'face', -30, 30, 0, 'mvp'],
  ['FaceAngleZ', 'face', -30, 30, 0, 'mvp'],
  ['EyeOpenL', 'eye', 0, 1, 1, 'mvp'],
  ['EyeOpenR', 'eye', 0, 1, 1, 'mvp'],
  ['EyeBallX', 'eye', -1, 1, 0, 'mvp'],
  ['EyeBallY', 'eye', -1, 1, 0, 'mvp'],
  ['MouthOpen', 'mouth', 0, 1, 0, 'mvp'],
  ['EyeSmileL', 'eye', 0, 1, 0, 'step1'],
  ['EyeSmileR', 'eye', 0, 1, 0, 'step1'],
  ['BrowYL', 'brow', -1, 1, 0, 'step1'],
  ['BrowYR', 'brow', -1, 1, 0, 'step1'],
  ['BrowFormL', 'brow', -1, 1, 0, 'step1'],
  ['BrowFormR', 'brow', -1, 1, 0, 'step1'],
  ['MouthForm', 'mouth', -1, 1, 0, 'step1'],
  ['MouthWidth', 'mouth', -1, 1, 0, 'step1'],
  ['Cheek', 'cheek', 0, 1, 0, 'step1'],
  ['BodyAngleX', 'body', -10, 10, 0, 'step1'],
  ['BodyAngleY', 'body', -10, 10, 0, 'step1'],
  ['BodyAngleZ', 'body', -10, 10, 0, 'step1'],
  ['Breath', 'body', 0, 1, 0, 'step2'],
  ['ArmL', 'armL', -1, 1, 0, 'step2'],
  ['ArmR', 'armR', -1, 1, 0, 'step2'],
  ['HairFront', 'sway', -1, 1, 0, 'step2'],
  ['HairSide', 'sway', -1, 1, 0, 'step2'],
  ['HairBack', 'sway', -1, 1, 0, 'step2'],
];

describe('STANDARD_PARAMETERS', () => {
  it('表と一致する（id・範囲・デフォルト値・グループ）', () => {
    expect(STANDARD_PARAMETERS.map((p) => [p.id, p.groupId, p.min, p.max, p.default])).toEqual(
      TABLE.map(([id, group, min, max, def]) => [id, group, min, max, def]),
    );
    expect(STANDARD_PARAMETERS.every((p) => p.standard && p.name.length > 0)).toBe(true);
  });

  it('フェーズが表と一致する', () => {
    expect(TABLE.map(([id]) => STANDARD_PARAMETER_PHASES[id])).toEqual(TABLE.map((row) => row[5]));
    expect(standardParametersFor('mvp')).toHaveLength(8);
    expect(standardParametersFor('step1')).toHaveLength(20);
    expect(standardParametersFor('step2')).toHaveLength(26);
  });

  it('表に余計な項目を持たない（phase を含めない）', () => {
    for (const p of STANDARD_PARAMETERS) {
      expect(Object.keys(p).sort()).toEqual(['default', 'groupId', 'id', 'max', 'min', 'name', 'standard']);
    }
  });
});

describe('PARAMETER_GROUPS', () => {
  it('10 グループ（表示名つき）', () => {
    expect(PARAMETER_GROUPS.map((g) => `${g.id}:${g.name}`)).toEqual([
      'face:顔',
      'eye:目',
      'brow:眉',
      'mouth:口',
      'cheek:頬',
      'body:体',
      'armL:左腕',
      'armR:右腕',
      'sway:揺れもの',
      'other:その他',
    ]);
  });
});

describe('標準パーツ', () => {
  it('表示名の例: eyeWhiteL → 白目 L', () => {
    expect(STANDARD_PART_NAMES.eyeWhiteL).toBe('白目 L');
    expect(STANDARD_PART_TYPES).toHaveLength(41);
  });

  it('描画順は変形グループ以外の標準パーツをちょうど1回ずつ含む', () => {
    const groups = [
      'bodyRoot',
      'armRootL',
      'armRootR',
      'neckRoot',
      'headRoot',
      'faceGroup',
      'eyeGroupL',
      'eyeGroupR',
      'mouthGroup',
    ];
    expect(new Set(STANDARD_DRAW_ORDER).size).toBe(STANDARD_DRAW_ORDER.length);
    expect([...STANDARD_DRAW_ORDER].sort()).toEqual(STANDARD_PART_TYPES.filter((t) => !groups.includes(t)).sort());
    expect(STANDARD_DRAW_ORDER[0]).toBe('backHair');
    expect(STANDARD_DRAW_ORDER.at(-1)).toBe('frontHair');
  });

  it('既定の奥行き', () => {
    expect(DEFAULT_DEPTH).toMatchObject({
      frontHair: 1,
      browL: 0.6,
      irisR: 0.5,
      teeth: 0.5,
      sideHairL: 0.4,
      cheek: 0.4,
      face: 0.2,
      earL: -0.5,
      backHair: -1,
    });
    expect(DEFAULT_DEPTH.torso).toBeUndefined();
  });
});

describe('depthParallaxOffset', () => {
  it('奥行きが正で値が正のとき、x は正・y は負', () => {
    expect(depthParallaxOffset(1, 30, 400, 'x')).toBeGreaterThan(0);
    expect(depthParallaxOffset(1, 30, 400, 'y')).toBeLessThan(0);
  });

  it('量は depth × (value / 30) × faceWidth × PARALLAX_RATIO', () => {
    expect(depthParallaxOffset(0.5, 15, 400, 'x')).toBeCloseTo(0.5 * 0.5 * 400 * PARALLAX_RATIO);
    expect(depthParallaxOffset(-1, 30, 400, 'x')).toBeCloseTo(-32);
    expect(depthParallaxOffset(-1, 30, 400, 'y')).toBeCloseTo(32);
    expect(depthParallaxOffset(0, 30, 400, 'x')).toBe(0);
  });
});
