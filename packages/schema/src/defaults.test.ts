import { describe, expect, it } from 'vitest';
import { createDefaultEnvironment, createEmptyProject, ensureStandardParameters } from './defaults';
import { PARAMETER_GROUPS, STANDARD_PARAMETERS } from './rules';
import type { Model, Parameter } from './types';

describe('createEmptyProject', () => {
  it('MVP の標準パラメータと全パラメータグループ入り', () => {
    const p = createEmptyProject('はじめて');
    expect(p.name).toBe('はじめて');
    expect(p.schemaVersion).toBe(4);
    expect(p.model.parameters.map((x) => x.id)).toEqual([
      'FaceAngleX',
      'FaceAngleY',
      'FaceAngleZ',
      'EyeOpenL',
      'EyeOpenR',
      'EyeBallX',
      'EyeBallY',
      'MouthOpen',
    ]);
    expect(p.model.parameterGroups).toEqual(PARAMETER_GROUPS);
  });

  it('lipSync・setupHints・studio の初期値', () => {
    const p = createEmptyProject('x');
    expect(p.model.lipSync).toEqual({ mouthSource: 'max', strength: 'standard', vowels: [] });
    expect(p.model.setupHints).toEqual({ closedLineL: null, closedLineR: null });
    expect(p.studio.scenes).toHaveLength(1);
    expect(p.studio.scenes[0]).toMatchObject({
      background: { type: 'transparent' },
      expressionIds: [],
      periodicAnimationIds: [],
    });
    expect(p.studio.activeSceneId).toBe(p.studio.scenes[0]!.id);
    expect(p.studio.hotkeys).toEqual([]);
  });

  it('作るたびに id が変わり、表の中身を共有しない', () => {
    const a = createEmptyProject('a');
    const b = createEmptyProject('b');
    expect(a.id).not.toBe(b.id);
    expect(a.model.parameters[0]).not.toBe(STANDARD_PARAMETERS[0]);
  });
});

describe('ensureStandardParameters', () => {
  const base = (): Model => createEmptyProject('x').model;

  it('足りないものだけを足す', () => {
    const model = base();
    const custom: Parameter = {
      id: 'MyParam',
      name: '自作',
      groupId: 'other',
      min: 0,
      max: 1,
      default: 0,
      standard: false,
    };
    const edited: Model = {
      ...model,
      parameters: [{ ...model.parameters[0]!, name: '名前を変えた' }, ...model.parameters.slice(2), custom],
    };
    const out = ensureStandardParameters(edited, 'step1');
    // 既存のものはそのまま、足りない FaceAngleY と STEP1 の分が表の順に末尾へ足される
    expect(out.parameters.slice(0, edited.parameters.length)).toEqual(edited.parameters);
    expect(out.parameters.slice(edited.parameters.length).map((p) => p.id)).toEqual([
      'FaceAngleY',
      'EyeSmileL',
      'EyeSmileR',
      'BrowYL',
      'BrowYR',
      'BrowFormL',
      'BrowFormR',
      'MouthForm',
      'MouthWidth',
      'Cheek',
      'BodyAngleX',
      'BodyAngleY',
      'BodyAngleZ',
    ]);
    expect(out.parameters[0]!.name).toBe('名前を変えた');
  });

  it('足りていれば何もせず同じ参照を返す', () => {
    const model = base();
    expect(ensureStandardParameters(model, 'mvp')).toBe(model);
    const step2 = ensureStandardParameters(model, 'step2');
    expect(step2.parameters).toHaveLength(26);
    expect(ensureStandardParameters(step2, 'step2')).toBe(step2);
    expect(ensureStandardParameters(step2, 'step1')).toBe(step2);
  });

  it('入力を書き換えない', () => {
    const model = base();
    const before = JSON.stringify(model);
    ensureStandardParameters(model, 'step2');
    expect(JSON.stringify(model)).toBe(before);
  });

  it('足したパラメータのグループが無ければ足す', () => {
    const model: Model = { ...base(), parameterGroups: [{ id: 'face', name: '顔' }] };
    const out = ensureStandardParameters(model, 'step2');
    expect(out.parameterGroups.map((g) => g.id)).toEqual([
      'face',
      'eye',
      'brow',
      'mouth',
      'cheek',
      'body',
      'armL',
      'armR',
      'sway',
    ]);
  });
});

describe('createDefaultEnvironment', () => {
  it('カード05の既定値', () => {
    expect(createDefaultEnvironment()).toEqual({
      cameraDeviceId: null,
      cameraCapture: { mode: 'auto', width: 640, height: 480, fps: 60 },
      mirror: true,
      calibration: null,
      microphoneDeviceId: null,
      silenceThreshold: -50,
      trackingPreset: 'standard',
      eyeTracking: true,
      autoBlink: true,
      trackingCustom: { minCutoff: 1, beta: 0.02, gain: 1, deadZone: 0.5 },
      bodyFollowStrength: 'standard',
      expressionMode: 'stack',
      output: { method: 'window', width: 1920, height: 1080, fps: 60, adapterId: null },
      uiLevel: { modeling: 'easy', animation: 'easy', studio: 'easy' },
      lastProjectDir: null,
    });
  });
});
