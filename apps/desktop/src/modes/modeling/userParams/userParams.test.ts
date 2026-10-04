import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  validateProject,
  type Binding,
  type Parameter,
  type Physics,
  type Project,
} from '@app/schema';
import { createProjectStore } from '@app/core';
import { deepFreeze, delta } from '../../../services/keyEditor/testing';
import {
  addParameterCommand,
  checkForm,
  deleteMessage,
  formOf,
  keyRange,
  NEW_PARAM_FORM,
  parameterUsage,
  removeParameterCommand,
  updateParameterCommand,
  userParameters,
  type ParamForm,
} from './userParams';

const tail: Parameter = { id: 'tail', name: 'しっぽ', groupId: 'other', min: -1, max: 1, default: 0, standard: false };
const tears: Parameter = { id: 'tears', name: '涙', groupId: 'eye', min: 0, max: 1, default: 0, standard: false };

function binding(id: string, parameterIds: string[], coords: number[][]): Binding {
  return {
    id,
    target: { type: 'part', id: 'p1' },
    channel: 'transform',
    parameterIds,
    keyValues: parameterIds.map((_, i) => [...new Set(coords.map((c) => c[i]!))].sort((a, b) => a - b)),
    keys: coords.map((c) => ({ coords: c, delta: delta(), source: 'manual', locked: false })),
    generation: 'linear',
    divisions: null,
  };
}

const physics = (id: string, inputs: string[]): Physics => ({
  id,
  partId: 'p1',
  preset: 'hair',
  strength: 0.5,
  direction: 'horizontal',
  length: 100,
  spring: 0.5,
  damping: 0.5,
  gravity: 0.5,
  inertia: 0.5,
  range: 0.5,
  inputs: inputs.map((parameterId) => ({ parameterId, weight: 1 })),
  outputParameterId: 'FaceAngleX',
});

// しっぽ（tail）をあちこちで使っているプロジェクト
function project(): Project {
  const p = createEmptyProject('ユーザー定義のテスト');
  return {
    ...p,
    model: {
      ...p.model,
      parameters: [...p.model.parameters, tail, tears],
      parameterGroups: p.model.parameterGroups.filter((g) => g.id !== 'body'),
      bindings: [
        binding('b-tail', ['tail'], [[-1], [0], [0.5]]),
        binding(
          'b-pair',
          ['FaceAngleX', 'tail'],
          [
            [0, 0],
            [30, 0.5],
          ],
        ),
        binding('b-face', ['FaceAngleX'], [[0], [30]]),
      ],
      lipSync: { ...p.model.lipSync, vowels: [{ vowel: 'a', values: { tail: 0.5, MouthOpen: 1 } }] },
    },
    trackingMappings: [
      {
        input: 'faceYaw',
        parameterId: 'tail',
        inputRange: [-30, 30],
        outputRange: [-1, 1],
        invert: false,
        curve: 'linear',
        smoothing: 0.5,
        deadZone: 0,
      },
      {
        input: 'faceYaw',
        parameterId: 'FaceAngleX',
        inputRange: [-30, 30],
        outputRange: [-30, 30],
        invert: false,
        curve: 'linear',
        smoothing: 0.5,
        deadZone: 0,
      },
    ],
    expressions: [
      {
        id: 'e1',
        name: '喜び',
        entries: [
          { parameterId: 'tail', value: 1, blend: 'override' },
          { parameterId: 'MouthOpen', value: 1, blend: 'override' },
        ],
        fadeIn: 0.2,
        fadeOut: 0.2,
      },
      {
        id: 'e2',
        name: 'ふつう',
        entries: [{ parameterId: 'MouthOpen', value: 0, blend: 'add' }],
        fadeIn: 0,
        fadeOut: 0,
      },
    ],
    animations: [
      {
        id: 'a1',
        name: 'ふる',
        duration: 1,
        speed: 1,
        loop: true,
        periodic: true,
        tracks: [
          { parameterId: 'tail', keyframes: [{ time: 0, value: 0, curve: 'linear' }] },
          { parameterId: 'FaceAngleX', keyframes: [{ time: 0, value: 0, curve: 'linear' }] },
        ],
        affectedGroups: [],
        restart: 'restart',
        transition: {
          preset: 'auto',
          blendIn: 0.2,
          blendOut: 0.2,
          curve: 'smooth',
          blendMode: 'override',
          keepLipSync: true,
          keepPhysics: true,
          returnToTracking: true,
        },
      },
    ],
    physics: [physics('ph1', ['tail', 'FaceAngleX'])],
    studio: {
      ...p.studio,
      hotkeys: [
        { id: 'h1', keys: 'Alt+T', action: 'parameter', targetId: 'tail', mode: 'toggle' },
        { id: 'h2', keys: 'Alt+R', action: 'parameter', targetId: 'tears', mode: 'hold' },
        { id: 'h3', keys: 'Alt+S', action: 'scene', targetId: 'tail', mode: 'toggle' },
      ],
    },
  };
}

const form = (patch: Partial<ParamForm> = {}): ParamForm => ({ ...NEW_PARAM_FORM, name: '耳', ...patch });

describe('入力の確認', () => {
  it('正しい入力は数にして返す（名前の前後の空白は取る）', () => {
    expect(
      checkForm(project().model, form({ name: '  耳 ', min: '-2', max: ' 2', defaultValue: '0.5' }), null),
    ).toEqual({
      ok: true,
      fields: { name: '耳', groupId: 'other', min: -2, max: 2, default: 0.5 },
    });
  });

  it('名前・数・範囲・デフォルト値を確かめる', () => {
    const m = project().model;
    const message = (f: ParamForm, id: string | null = null) => {
      const r = checkForm(m, f, id);
      return r.ok ? null : r.message;
    };
    expect(message(form({ name: ' ' }))).toBe('名前を入れる');
    expect(message(form({ name: 'しっぽ' }))).toBe('同じ名前のパラメータがある');
    expect(message(form({ name: '顔 左右' }))).toBe('同じ名前のパラメータがある');
    expect(message(form({ min: 'a' }))).toBe('最小・最大・デフォルト値は数で入れる');
    expect(message(form({ max: '' }))).toBe('最小・最大・デフォルト値は数で入れる');
    expect(message(form({ min: '1', max: '1', defaultValue: '1' }))).toBe('最大は最小より大きくする');
    expect(message(form({ min: '0', max: '1', defaultValue: '2' }))).toBe('デフォルト値は最小〜最大の間にする');
    // 編集では自分の名前はそのままでよい
    expect(message(formOf(tail), 'tail')).toBeNull();
  });

  it('キーのあるパラメータは、デフォルト値を変えられず、範囲はキーのある値を含む', () => {
    const m = project().model;
    expect(keyRange(m, 'tail')).toEqual({ min: -1, max: 0.5 });
    expect(keyRange(m, 'tears')).toBeNull();
    const message = (f: ParamForm, id: string) => {
      const r = checkForm(m, f, id);
      return r.ok ? null : r.message;
    };
    expect(message({ ...formOf(tail), defaultValue: '0.2' }, 'tail')).toBe(
      'キーがあるので、デフォルト値は変えられない',
    );
    expect(message({ ...formOf(tail), min: '-0.5' }, 'tail')).toBe('キーのある値（-1〜0.5）が入る範囲にする');
    expect(message({ ...formOf(tail), min: '-2', max: '0.5' }, 'tail')).toBeNull();
    // キーが無ければデフォルト値も変えられる
    expect(message({ ...formOf(tears), defaultValue: '1' }, 'tears')).toBeNull();
  });
});

describe('追加・編集', () => {
  it('追加は standard: false で末尾に足し、グループが無ければ足す。1回の Undo で戻る', () => {
    const initial = deepFreeze(project());
    const store = createProjectStore(initial);
    const fields = { name: '耳', groupId: 'body' as const, min: -1, max: 1, default: 0 };
    store.dispatch(addParameterCommand('ear', fields));
    const m = store.get().model;
    expect(m.parameters.at(-1)).toEqual({ id: 'ear', ...fields, standard: false });
    expect(m.parameterGroups.at(-1)).toEqual({ id: 'body', name: '体' });
    expect(userParameters(m).map((p) => p.id)).toEqual(['tail', 'tears', 'ear']);
    expect(() => validateProject(store.get())).not.toThrow();
    // 同じ id は二重に足さない
    const after = store.get();
    expect(addParameterCommand('ear', fields).apply(after)).toBe(after);
    store.undo();
    expect(store.get()).toBe(initial);
  });

  it('編集は名前・グループ・範囲・デフォルト値を変える。同じ値なら何もしない。標準パラメータは変えない', () => {
    const p = deepFreeze(project());
    const next = updateParameterCommand('tail', { name: '尾', groupId: 'sway', min: -2, max: 2, default: 0 }).apply(p);
    expect(next.model.parameters.find((x) => x.id === 'tail')).toEqual({
      id: 'tail',
      name: '尾',
      groupId: 'sway',
      min: -2,
      max: 2,
      default: 0,
      standard: false,
    });
    expect(updateParameterCommand('tail', { ...tail }).apply(p)).toBe(p);
    expect(
      updateParameterCommand('FaceAngleX', { name: 'x', groupId: 'face', min: -1, max: 1, default: 0 }).apply(p),
    ).toBe(p);
  });
});

describe('削除', () => {
  it('使っているものを数え、確認の文にする', () => {
    const p = project();
    const usage = parameterUsage(p, 'tail');
    expect(usage).toEqual({
      bindings: 2,
      trackingMappings: 1,
      expressionEntries: 1,
      hotkeys: 1,
      animationTracks: 1,
      physicsInputs: 1,
    });
    expect(deleteMessage(tail, usage)).toBe(
      'パラメータ「しっぽ」を削除しますか？使っている バインディング（キー） 2 個・トラッキングのマッピング 1 個・' +
        '表情の項目 1 個・ホットキー 1 個・アニメーションのトラック 1 個・物理の入力 1 個 も消えます。',
    );
    expect(deleteMessage(tears, parameterUsage(p, 'tears'))).toBe(
      'パラメータ「涙」を削除しますか？使っている ホットキー 1 個 も消えます。',
    );
    const unused = { ...tears, id: 'none' };
    expect(deleteMessage(unused, parameterUsage(p, 'none'))).toBe('パラメータ「涙」を削除しますか？');
  });

  it('パラメータと、それを使うバインディング・マッピング・表情の項目などを消す（ほかは残す）', () => {
    const p = deepFreeze(project());
    const next = removeParameterCommand('tail').apply(p);
    expect(next.model.parameters.map((x) => x.id)).not.toContain('tail');
    expect(next.model.parameters.map((x) => x.id)).toContain('tears');
    expect(next.model.bindings.map((b) => b.id)).toEqual(['b-face']); // 2つの組のバインディングも消す
    expect(next.trackingMappings.map((m) => m.parameterId)).toEqual(['FaceAngleX']);
    expect(next.expressions[0]!.entries.map((e) => e.parameterId)).toEqual(['MouthOpen']);
    expect(next.expressions[1]).toBe(p.expressions[1]);
    expect(next.studio.hotkeys.map((h) => h.id)).toEqual(['h2', 'h3']);
    expect(next.animations[0]!.tracks.map((t) => t.parameterId)).toEqual(['FaceAngleX']);
    expect(next.physics[0]!.inputs.map((x) => x.parameterId)).toEqual(['FaceAngleX']);
    expect(next.model.lipSync.vowels[0]!.values).toEqual({ MouthOpen: 1 });
    expect(parameterUsage(next, 'tail')).toEqual({
      bindings: 0,
      trackingMappings: 0,
      expressionEntries: 0,
      hotkeys: 0,
      animationTracks: 0,
      physicsInputs: 0,
    });
    expect(() => validateProject(next)).not.toThrow();
  });

  it('1回の Undo で全部戻る。標準パラメータは消さない', () => {
    const initial = project();
    const store = createProjectStore(initial);
    store.dispatch(removeParameterCommand('tail'));
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.get()).toBe(initial);
    const p = store.get();
    expect(removeParameterCommand('FaceAngleX').apply(p)).toBe(p);
    expect(removeParameterCommand('missing').apply(p)).toBe(p);
  });
});
