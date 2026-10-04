import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  ensureStandardParameters,
  standardParametersFor,
  type BlendOp,
  type Expression,
  type Parameter,
  type Project,
} from '@app/schema';
import { FakeExpressions, type ExpressionController, type Layer, type ParamValues } from '@app/contracts';
import { createParameterMixer } from '../mix';
import {
  buildExpressionEntries,
  createExpressionController,
  EXPRESSION_FADE_DEFAULT,
  expressionBlendFor,
  expressionEase,
  expressionEntryValue,
  expressionGroupModesOf,
  expressionRuleBlend,
  expressionStateOf,
  expressionStateValue,
} from './expression';

const mixer = createParameterMixer();

// STEP1 の標準パラメータを持つプロジェクト
function project(expressions: Expression[]): Project {
  const p = createEmptyProject('テスト');
  return { ...p, model: ensureStandardParameters(p.model, 'step1'), expressions };
}

function expression(
  id: string,
  entries: [parameterId: string, value: number, blend: BlendOp][],
  fade: { fadeIn?: number; fadeOut?: number } = {},
): Expression {
  return {
    id,
    name: id,
    entries: entries.map(([parameterId, value, blend]) => ({ parameterId, value, blend })),
    fadeIn: fade.fadeIn ?? EXPRESSION_FADE_DEFAULT,
    fadeOut: fade.fadeOut ?? EXPRESSION_FADE_DEFAULT,
  };
}

const flags = { lipSyncWeight: 1, physicsActive: true };

// トラッキングのレイヤー（tracking の値）の上に表情のレイヤーを合成する
function frame(controller: ExpressionController, p: Project, now: number, tracking: ParamValues = {}) {
  const trackingLayer: Layer = { id: 'tracking', weight: 1, values: tracking };
  const mixedSoFar = mixer.mix(p.model.parameters, [trackingLayer]);
  // produce は配列も返せる（カード45）。本物は表情ごとのレイヤーを適用した順に返す（カード52）
  const produced = controller.produce({ now, dt: 16, project: p, mixedSoFar, flags });
  const layers = produced === null ? [] : Array.isArray(produced) ? produced : [produced];
  const out = mixer.mix(p.model.parameters, [trackingLayer, ...layers]);
  return { layers, out };
}

// 表情の項目そのままの値・blend で、重み weight のレイヤー
function layerOf(e: Expression, weight: number): Layer {
  return {
    id: 'expression',
    weight,
    values: Object.fromEntries(e.entries.map((x) => [x.parameterId, x.value])),
    blend: Object.fromEntries(e.entries.map((x) => [x.parameterId, x.blend])),
  };
}

// 表情ごとに別のレイヤー（重みつき）を順に重ねた場合の合成結果
function twoLayers(p: Project, tracking: ParamValues, parts: [Expression, number][]): ParamValues {
  const layers: Layer[] = [{ id: 'tracking', weight: 1, values: tracking }];
  for (const [e, weight] of parts) layers.push(layerOf(e, weight));
  return mixer.mix(p.model.parameters, layers);
}

function expectClose(actual: ParamValues, expected: ParamValues) {
  for (const [id, v] of Object.entries(expected)) expect(actual[id], id).toBeCloseTo(v, 9);
}

describe('expressionEase', () => {
  it('ease-in-out（0 → 0、0.25 → 0.15625、0.5 → 0.5、1 → 1。範囲の外は丸める）', () => {
    expect(expressionEase(0)).toBe(0);
    expect(expressionEase(0.25)).toBeCloseTo(0.15625, 12);
    expect(expressionEase(0.5)).toBe(0.5);
    expect(expressionEase(1)).toBe(1);
    expect(expressionEase(-1)).toBe(0);
    expect(expressionEase(2)).toBe(1);
  });
});

describe('createExpressionController: 適用と解除', () => {
  const tracking = { FaceAngleX: 20, EyeOpenL: 0.8, MouthForm: 0.2 };
  const smile = expression('smile', [
    ['FaceAngleX', 10, 'add'],
    ['EyeOpenL', 0.6, 'multiply'],
    ['MouthForm', 0.8, 'override'],
  ]);

  it('id は expression。何も適用していなければ何も出さない', () => {
    const c = createExpressionController();
    expect(c.id).toBe('expression');
    expect(c.active()).toBeNull();
    expect(c.produce({ now: 0, dt: 16, project: project([smile]), mixedSoFar: {}, flags })).toBeNull();
  });

  it('フェードイン: 0・半分・終わりの時点の値（fadeIn 0.2 秒）', () => {
    const c = createExpressionController();
    const p = project([smile]);
    c.apply('smile', 1000);
    expect(c.active()).toBe('smile');
    // 0 の時点はトラッキングのまま
    const start = frame(c, p, 1000, tracking);
    expect(start.layers).toEqual([]);
    expectClose(start.out, { FaceAngleX: 20, EyeOpenL: 0.8, MouthForm: 0.2 });
    // 4分の1（ease で 0.15625）
    expectClose(frame(c, p, 1050, tracking).out, { FaceAngleX: 20 + 10 * 0.15625 });
    // 半分（ease で 0.5）: add は +5、multiply は ×0.8、override は間。レイヤーの weight がフェードの重み
    const half = frame(c, p, 1100, tracking);
    expectClose(half.out, { FaceAngleX: 25, EyeOpenL: 0.64, MouthForm: 0.5 });
    expect(half.layers).toEqual([layerOf(smile, 0.5)]);
    // 終わり: 表情の値そのもの
    const end = frame(c, p, 1200, tracking);
    expectClose(end.out, { FaceAngleX: 30, EyeOpenL: 0.48, MouthForm: 0.8 });
    expect(end.layers).toEqual([
      {
        id: 'expression',
        weight: 1,
        values: { FaceAngleX: 10, EyeOpenL: 0.6, MouthForm: 0.8 },
        blend: { FaceAngleX: 'add', EyeOpenL: 'multiply', MouthForm: 'override' },
      },
    ]);
    expect(frame(c, p, 5000, tracking).layers).toEqual(end.layers);
  });

  it('フェードし終わったら、仮実装（FakeExpressions）と同じレイヤーを出す', () => {
    const c = createExpressionController();
    const fake = new FakeExpressions();
    const p = project([smile]);
    c.apply('smile', 0);
    fake.apply('smile', 0);
    const ctx = { now: 1000, dt: 16, project: p, mixedSoFar: {}, flags };
    c.produce({ ...ctx, now: 0 });
    expect(c.produce(ctx)).toEqual([fake.produce(ctx)]);
  });

  it('解除（null）: 0・半分・終わりの時点の値（fadeOut 0.4 秒）。消え終わったら何も出さない', () => {
    const c = createExpressionController();
    const p = project([{ ...smile, fadeOut: 0.4 }]);
    c.apply('smile', 0);
    frame(c, p, 0, tracking);
    expectClose(frame(c, p, 1000, tracking).out, { FaceAngleX: 30, EyeOpenL: 0.48, MouthForm: 0.8 });
    // eslint-disable-next-line prefer-spread -- ExpressionController.apply は Function.prototype.apply ではない
    c.apply(null, 2000);
    expect(c.active()).toBeNull();
    expectClose(frame(c, p, 2000, tracking).out, { FaceAngleX: 30, EyeOpenL: 0.48, MouthForm: 0.8 });
    expectClose(frame(c, p, 2200, tracking).out, { FaceAngleX: 25, EyeOpenL: 0.64, MouthForm: 0.5 });
    const end = frame(c, p, 2400, tracking);
    expect(end.layers).toEqual([]);
    expectClose(end.out, { FaceAngleX: 20, EyeOpenL: 0.8, MouthForm: 0.2 });
  });

  it('同じ表情をもう一度適用しても最初からやり直さない', () => {
    const c = createExpressionController();
    const p = project([smile]);
    c.apply('smile', 0);
    frame(c, p, 0, tracking);
    c.apply('smile', 100);
    expectClose(frame(c, p, 100, tracking).out, { FaceAngleX: 25 });
    expectClose(frame(c, p, 200, tracking).out, { FaceAngleX: 30 });
  });

  it('fadeIn・fadeOut が 0 ならすぐに切り替わる', () => {
    const c = createExpressionController();
    const p = project([{ ...smile, fadeIn: 0, fadeOut: 0 }]);
    c.apply('smile', 0);
    expectClose(frame(c, p, 0, tracking).out, { FaceAngleX: 30, MouthForm: 0.8 });
    // eslint-disable-next-line prefer-spread -- ExpressionController.apply は Function.prototype.apply ではない
    c.apply(null, 10);
    expect(frame(c, p, 10, tracking).layers).toEqual([]);
  });

  it('切り替えは次の produce で行う。その前に何度切り替えても最後に適用したものになる', () => {
    const c = createExpressionController();
    const angry = expression('angry', [['BrowFormL', 1, 'add']], { fadeIn: 0, fadeOut: 0 });
    const p = project([{ ...smile, fadeIn: 0, fadeOut: 0 }, angry]);
    c.apply('smile', 0);
    c.apply('angry', 0);
    // eslint-disable-next-line prefer-spread -- ExpressionController.apply は Function.prototype.apply ではない
    c.apply(null, 0);
    c.apply('angry', 0);
    expect(c.active()).toBe('angry');
    expect(c.actives()).toEqual(['angry']);
    expect(frame(c, p, 0).layers).toEqual([
      {
        id: 'expression',
        weight: 1,
        values: { BrowFormL: 1 },
        blend: { BrowFormL: 'add' },
      },
    ]);
  });
});

describe('createExpressionController: 表情から表情への切り替え', () => {
  const tracking = { FaceAngleX: 20, EyeOpenL: 0.8 };
  // A だけに Cheek、B だけに MouthOpen、両方に FaceAngleX
  const a = expression(
    'a',
    [
      ['FaceAngleX', 10, 'add'],
      ['Cheek', 1, 'override'],
    ],
    { fadeOut: 0.2 },
  );
  const b = expression(
    'b',
    [
      ['FaceAngleX', -10, 'add'],
      ['MouthOpen', 0.5, 'add'],
    ],
    { fadeIn: 0.4 },
  );

  function switched(first: Expression, second: Expression) {
    const c = createExpressionController();
    const p = project([first, second]);
    c.apply(first.id, 0);
    frame(c, p, 0, tracking);
    frame(c, p, 1000, tracking);
    c.apply(second.id, 1000);
    return { c, p };
  }

  it('前の表情は fadeOut、新しい表情は fadeIn の秒数で重みを変え、前の表情から順にレイヤーを返す', () => {
    const { c, p } = switched(a, b);
    expect(c.actives()).toEqual(['b']);
    // 切り替えた時点は前の表情のまま
    expectClose(frame(c, p, 1000, tracking).out, { FaceAngleX: 30, Cheek: 1, MouthOpen: 0 });
    // A は fadeOut 0.2 秒の半分（重み 0.5）、B は fadeIn 0.4 秒の4分の1（重み 0.15625）
    const mid = frame(c, p, 1100, tracking);
    expectClose(mid.out, { FaceAngleX: 20 + 5 - 1.5625, Cheek: 0.5, MouthOpen: 0.078125 });
    expect(mid.layers).toEqual([layerOf(a, 0.5), layerOf(b, 0.15625)]);
    // A が消え終わった（B は半分）
    const later = frame(c, p, 1200, tracking);
    expectClose(later.out, { FaceAngleX: 15, Cheek: 0, MouthOpen: 0.25 });
    expect(later.layers).toEqual([layerOf(b, 0.5)]);
    // B の終わり
    const end = frame(c, p, 1400, tracking);
    expect(end.layers).toEqual([
      {
        id: 'expression',
        weight: 1,
        values: { FaceAngleX: -10, MouthOpen: 0.5 },
        blend: { FaceAngleX: 'add', MouthOpen: 'add' },
      },
    ]);
  });

  it('前と新しい表情で合成方法が違うときは、それぞれのレイヤーがその表情の合成方法を持つ', () => {
    // A は目と顔を固定（override）、B はルールどおり（add・multiply）
    const fixed = expression(
      'fixed',
      [
        ['FaceAngleX', 10, 'override'],
        ['EyeOpenL', 0.2, 'override'],
      ],
      { fadeOut: 0.2 },
    );
    const rule = expression(
      'rule',
      [
        ['FaceAngleX', 5, 'add'],
        ['EyeOpenL', 0.5, 'multiply'],
      ],
      { fadeIn: 0.4 },
    );
    const { c, p } = switched(fixed, rule);
    const mid = frame(c, p, 1100, tracking);
    expect(mid.layers.map((l) => l.blend)).toEqual([
      { FaceAngleX: 'override', EyeOpenL: 'override' },
      { FaceAngleX: 'add', EyeOpenL: 'multiply' },
    ]);
    // 固定の重み 0.5 で 20 → 15、そこへ 5 × 0.15625 を足す。目は 0.8 → 0.5、そこへ ×(1 − 0.5 × 0.15625)
    expectClose(mid.out, { FaceAngleX: 15 + 5 * 0.15625, EyeOpenL: 0.5 * (1 - 0.5 * 0.15625) });
    expectClose(
      mid.out,
      twoLayers(p, tracking, [
        [fixed, 0.5],
        [rule, 0.15625],
      ]),
    );
    // 逆向き（ルールどおり → 固定）
    const back = switched(rule, fixed);
    frame(back.c, back.p, 1000, tracking);
    const mid2 = frame(back.c, back.p, 1100, tracking);
    expect(mid2.layers.map((l) => l.blend)).toEqual([
      { FaceAngleX: 'add', EyeOpenL: 'multiply' },
      { FaceAngleX: 'override', EyeOpenL: 'override' },
    ]);
    // rule の fadeOut 0.2 秒の半分、fixed の fadeIn 0.2 秒の半分
    expectClose(
      mid2.out,
      twoLayers(back.p, tracking, [
        [rule, 0.5],
        [fixed, 0.5],
      ]),
    );
  });

  it('フェードの途中で切り替えても値が飛ばない（消えかけの表情に戻るときは、その重みから戻る）', () => {
    const c = createExpressionController();
    const p = project([a, b]);
    c.apply('a', 0);
    frame(c, p, 0, tracking);
    const before = frame(c, p, 50, tracking).out; // A は 0.15625
    c.apply('b', 50);
    expectClose(frame(c, p, 50, tracking).out, before);
    const midway = frame(c, p, 100, tracking).out;
    c.apply('a', 100); // A に戻す
    expectClose(frame(c, p, 100, tracking).out, midway);
    // いずれ A だけになる
    expect(frame(c, p, 2000, tracking).layers).toEqual([
      {
        id: 'expression',
        weight: 1,
        values: { FaceAngleX: 10, Cheek: 1 },
        blend: { FaceAngleX: 'add', Cheek: 'override' },
      },
    ]);
  });
});

describe('createExpressionController: 例外的な入力', () => {
  it('プロジェクトに無い表情・パラメータ、数でない値は出さない', () => {
    const c = createExpressionController();
    const odd = expression(
      'odd',
      [
        ['Unknown', 1, 'add'],
        ['MouthOpen', Number.NaN, 'add'],
        ['Cheek', 0.5, 'override'],
      ],
      { fadeIn: 0 },
    );
    const p = project([odd]);
    c.apply('gone', 0);
    expect(frame(c, p, 0).layers).toEqual([]);
    c.apply('odd', 10);
    expect(frame(c, p, 10).layers).toEqual([
      {
        id: 'expression',
        weight: 1,
        values: { Cheek: 0.5 },
        blend: { Cheek: 'override' },
      },
    ]);
  });

  it('適用中の表情がプロジェクトから消えたら何も出さない（戻れば出す）', () => {
    const c = createExpressionController();
    const smile = expression('smile', [['Cheek', 1, 'override']], { fadeIn: 0 });
    c.apply('smile', 0);
    expect(frame(c, project([smile]), 0).layers).toHaveLength(1);
    expect(frame(c, project([]), 16).layers).toEqual([]);
    expect(c.active()).toBe('smile');
    expect(frame(c, project([smile]), 32).layers[0]?.values).toEqual({ Cheek: 1 });
  });

  it('適用の時刻より前の produce（時刻が戻った）は、その時刻から数え直す', () => {
    const c = createExpressionController();
    const p = project([expression('smile', [['FaceAngleX', 10, 'add']])]);
    c.apply('smile', 1_000_000);
    expectClose(frame(c, p, 500).out, { FaceAngleX: 0 });
    expectClose(frame(c, p, 600).out, { FaceAngleX: 5 });
    expectClose(frame(c, p, 700).out, { FaceAngleX: 10 });
  });

  it('時刻が数でなければ、次の produce の時刻から数える', () => {
    const c = createExpressionController();
    const p = project([expression('smile', [['FaceAngleX', 10, 'add']])]);
    c.apply('smile', Number.NaN);
    expectClose(frame(c, p, 300).out, { FaceAngleX: 0 });
    expectClose(frame(c, p, 400).out, { FaceAngleX: 5 });
  });

  it('入力を書き換えない', () => {
    const c = createExpressionController();
    const p = project([expression('smile', [['FaceAngleX', 10, 'add']])]);
    const mixedSoFar = { FaceAngleX: 3 };
    const before = structuredClone({ p, mixedSoFar });
    c.apply('smile', 0);
    c.produce({ now: 100, dt: 16, project: p, mixedSoFar, flags });
    expect({ p, mixedSoFar }).toEqual(before);
  });
});

describe('合成方法の決め方（標準の合成ルール）', () => {
  function userParam(id: string, groupId: Parameter['groupId'], def = 0): Parameter {
    return { id, name: id, groupId, min: -10, max: 10, default: def, standard: false };
  }

  it('標準パラメータはルールの表どおり（表に無い瞳は override）', () => {
    const rules = Object.fromEntries(standardParametersFor('step1').map((p) => [p.id, expressionRuleBlend(p)]));
    expect(rules).toEqual({
      FaceAngleX: 'add',
      FaceAngleY: 'add',
      FaceAngleZ: 'add',
      EyeOpenL: 'multiply',
      EyeOpenR: 'multiply',
      EyeBallX: 'override',
      EyeBallY: 'override',
      MouthOpen: 'add',
      EyeSmileL: 'override',
      EyeSmileR: 'override',
      BrowYL: 'add',
      BrowYR: 'add',
      BrowFormL: 'add',
      BrowFormR: 'add',
      MouthForm: 'override',
      MouthWidth: 'override',
      Cheek: 'override',
      BodyAngleX: 'add',
      BodyAngleY: 'add',
      BodyAngleZ: 'add',
    });
  });

  it('ユーザー定義のパラメータはグループで決める（顔・体・眉は add、ほかは override）', () => {
    const groups: Parameter['groupId'][] = ['face', 'eye', 'brow', 'mouth', 'cheek', 'body', 'armL', 'sway', 'other'];
    expect(groups.map((g) => expressionRuleBlend(userParam(`P_${g}`, g)))).toEqual([
      'add',
      'override',
      'add',
      'override',
      'override',
      'add',
      'override',
      'override',
      'override',
    ]);
    // 'toString' などの名前でも表を取り違えない
    expect(expressionRuleBlend(userParam('toString', 'other'))).toBe('override');
  });

  it('2択: トラッキングに重ねる（rule）はルールどおり、固定する（fixed）は override', () => {
    for (const p of standardParametersFor('step1')) {
      expect(expressionBlendFor(p)).toBe(expressionRuleBlend(p));
      expect(expressionBlendFor(p, 'rule')).toBe(expressionRuleBlend(p));
      expect(expressionBlendFor(p, 'fixed')).toBe('override');
    }
  });

  it('作った状態から項目を作る。動かしたパラメータだけを、グループの2択どおりの blend で入れる', () => {
    const parameters = standardParametersFor('step1');
    const state = { MouthForm: 0.7, BrowYL: 0.5, EyeOpenL: 0.6, FaceAngleX: 10, EyeBallX: 0, Cheek: 1 };
    expect(buildExpressionEntries(parameters, state)).toEqual([
      { parameterId: 'FaceAngleX', value: 10, blend: 'add' },
      { parameterId: 'EyeOpenL', value: 0.6, blend: 'multiply' },
      { parameterId: 'BrowYL', value: 0.5, blend: 'add' },
      { parameterId: 'MouthForm', value: 0.7, blend: 'override' },
      { parameterId: 'Cheek', value: 1, blend: 'override' },
    ]);
    expect(buildExpressionEntries(parameters, state, { eye: 'fixed', brow: 'fixed', face: 'rule' })).toEqual([
      { parameterId: 'FaceAngleX', value: 10, blend: 'add' },
      { parameterId: 'EyeOpenL', value: 0.6, blend: 'override' },
      { parameterId: 'BrowYL', value: 0.5, blend: 'override' },
      { parameterId: 'MouthForm', value: 0.7, blend: 'override' },
      { parameterId: 'Cheek', value: 1, blend: 'override' },
    ]);
    // 範囲の外は丸め、デフォルト値（目の開閉 1）・数でない値は入れない
    expect(buildExpressionEntries(parameters, { FaceAngleX: 99, EyeOpenR: 1, MouthOpen: Number.NaN })).toEqual([
      { parameterId: 'FaceAngleX', value: 30, blend: 'add' },
    ]);
  });

  it('2択の結果をスタジオで合成すると、重ねる（rule）はトラッキングに足し、固定する（fixed）は置き換える', () => {
    const p = project([]);
    const state = { FaceAngleX: 10, EyeOpenL: 0.5 };
    const tracking: Layer = { id: 'tracking', weight: 1, values: { FaceAngleX: 20, EyeOpenL: 0.8 } };
    const layerOf = (entries: Expression['entries']): Layer => ({
      id: 'expression',
      weight: 1,
      values: Object.fromEntries(entries.map((e) => [e.parameterId, e.value])),
      blend: Object.fromEntries(entries.map((e) => [e.parameterId, e.blend])),
    });
    const rule = mixer.mix(p.model.parameters, [tracking, layerOf(buildExpressionEntries(p.model.parameters, state))]);
    expect(rule.FaceAngleX).toBe(30);
    expect(rule.EyeOpenL).toBeCloseTo(0.4, 12);
    const fixed = mixer.mix(p.model.parameters, [
      tracking,
      layerOf(buildExpressionEntries(p.model.parameters, state, { face: 'fixed', eye: 'fixed' })),
    ]);
    expect(fixed.FaceAngleX).toBeCloseTo(10, 12);
    expect(fixed.EyeOpenL).toBeCloseTo(0.5, 12);
  });

  it('項目から作った状態とグループの2択に戻せる', () => {
    const parameters = standardParametersFor('step1');
    const state = { FaceAngleX: 10, EyeOpenL: 0.6, BrowYL: 0.5, MouthForm: 0.7 };
    const modes = { eye: 'fixed', mouth: 'fixed' } as const;
    const entries = buildExpressionEntries(parameters, state, modes);
    expect(expressionStateOf(parameters, { entries })).toEqual(state);
    // 口の形はルールでも override なので、固定したかどうかは分からない（ルールどおりとして読む）
    expect(expressionGroupModesOf(parameters, { entries })).toEqual({ eye: 'fixed' });
    // プロジェクトに無いパラメータは除く
    expect(expressionStateOf(parameters, { entries: [{ parameterId: 'Gone', value: 1, blend: 'add' }] })).toEqual({});
  });

  it('add はデフォルト値からの差、multiply はデフォルト値に対する倍率にする（デフォルト値が 0 でないとき）', () => {
    const p = userParam('P', 'other', 2);
    expect(expressionEntryValue(p, 'add', 5)).toBe(3);
    expect(expressionStateValue(p, 'add', 3)).toBe(5);
    expect(expressionEntryValue(p, 'multiply', 1)).toBe(0.5);
    expect(expressionStateValue(p, 'multiply', 0.5)).toBe(1);
    expect(expressionEntryValue(p, 'override', 4)).toBe(4);
    expect(expressionStateValue(p, 'max', 4)).toBe(4);
    const zero = userParam('Z', 'other', 0);
    expect(expressionEntryValue(zero, 'multiply', 0.5)).toBe(0.5);
    expect(expressionStateValue(zero, 'multiply', 0.5)).toBe(0.5);
  });
});
