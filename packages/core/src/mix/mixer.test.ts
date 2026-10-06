import { LAYER_ORDER, type Layer, type LayerId } from '@app/contracts';
import type { BlendOp, Parameter } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { blendValue, createParameterMixer } from './mixer';

function param(id: string, min: number, max: number, def: number): Parameter {
  return { id, name: id, groupId: 'other', min, max, default: def, standard: false };
}

function layer(id: LayerId, weight: number, values: Record<string, number>, blend?: Record<string, BlendOp>): Layer {
  return blend ? { id, weight, values, blend } : { id, weight, values };
}

const mixer = createParameterMixer();

describe('createParameterMixer: 合成方法', () => {
  it('パラメータ別の重みは共通の重みと独立し、後段の表情を妨げない', () => {
    const ps = [param('FaceAngleX', -30, 30, 0), param('EyeOpenL', 0, 1, 1)];
    const tracking: Layer = {
      id: 'tracking',
      weight: 0,
      values: { FaceAngleX: 20, EyeOpenL: 0.25 },
      parameterWeights: { EyeOpenL: 1 },
    };
    expect(mixer.mix(ps, [tracking])).toEqual({ FaceAngleX: 0, EyeOpenL: 0.25 });
    expect(mixer.mix(ps, [tracking, layer('expression', 1, { EyeOpenL: 0 })]).EyeOpenL).toBe(0);
    expect(mixer.mix(ps, [{ ...tracking, parameterWeights: { EyeOpenL: Number.NaN } }]).EyeOpenL).toBe(1);
    expect(mixer.mix(ps, [{ ...tracking, parameterWeights: { EyeOpenL: 2 } }]).EyeOpenL).toBe(0.25);
    expect(mixer.mix(ps, [{ ...tracking, parameterWeights: { EyeOpenL: -1 } }]).EyeOpenL).toBe(1);
  });
  // v はデフォルト値から始まる。範囲は広くとって丸めの影響を外す
  const cases: { op: BlendOp; v: number; t: number; expected: [number, number, number] }[] = [
    // override: v + (t − v)·w
    { op: 'override', v: 0.2, t: 1, expected: [0.2, 0.6, 1] },
    // add: v + t·w
    { op: 'add', v: 0.2, t: 0.4, expected: [0.2, 0.4, 0.6] },
    // multiply: v·(1 + (t − 1)·w)
    { op: 'multiply', v: 0.8, t: 0.5, expected: [0.8, 0.6, 0.4] },
    // max: v + (max(v, t) − v)·w
    { op: 'max', v: 0.2, t: 0.6, expected: [0.2, 0.4, 0.6] },
    { op: 'max', v: 0.6, t: 0.2, expected: [0.6, 0.6, 0.6] },
  ];

  for (const { op, v, t, expected } of cases) {
    it(`${op}（v=${v}, t=${t}）の重み 0・0.5・1`, () => {
      [0, 0.5, 1].forEach((w, k) => {
        const out = mixer.mix([param('P', -10, 10, v)], [layer('expression', w, { P: t }, { P: op })]);
        expect(out.P).toBeCloseTo(expected[k]!, 10);
        expect(blendValue(op, v, t, w)).toBeCloseTo(expected[k]!, 10);
      });
    });
  }

  it('blend が無いか、そのパラメータの指定が無ければ override', () => {
    const ps = [param('P', -10, 10, 0), param('Q', -10, 10, 0)];
    const out = mixer.mix(ps, [layer('tracking', 0.5, { P: 4, Q: 4 }, { P: 'add' }), layer('animation', 1, { P: 1 })]);
    expect(out.P).toBe(1);
    expect(out.Q).toBe(2);
  });

  it('重みは 0..1 に丸める（NaN は 0）', () => {
    const ps = [param('P', -10, 10, 0)];
    expect(mixer.mix(ps, [layer('tracking', 2, { P: 4 }, { P: 'add' })]).P).toBe(4);
    expect(mixer.mix(ps, [layer('tracking', -1, { P: 4 })]).P).toBe(0);
    expect(mixer.mix(ps, [layer('tracking', Number.NaN, { P: 4 })]).P).toBe(0);
  });
});

describe('createParameterMixer: 順序', () => {
  it('引数の順に関係なく LAYER_ORDER の順で合成する', () => {
    const ps = [param('P', -100, 100, 1)];
    // tracking で 3 に上書き → expression で 2 倍 → lipSync で +1 → physics で 10 と比べて大きい方
    const layers = [
      layer('physics', 1, { P: 10 }, { P: 'max' }),
      layer('lipSync', 1, { P: 1 }, { P: 'add' }),
      layer('expression', 1, { P: 2 }, { P: 'multiply' }),
      layer('tracking', 1, { P: 3 }),
    ];
    expect(mixer.mix(ps, layers).P).toBe(10);
    const withoutPhysics = layers.slice(1);
    expect(mixer.mix(ps, withoutPhysics).P).toBe(7);
    expect(mixer.mix(ps, [...withoutPhysics].reverse()).P).toBe(7);
    // 順に並べた場合と同じ
    const sorted = [...layers].sort((a, b) => LAYER_ORDER.indexOf(a.id) - LAYER_ORDER.indexOf(b.id));
    expect(mixer.mix(ps, sorted).P).toBe(10);
  });

  it('すべての LAYER_ORDER を逆順に渡しても、後のレイヤーほど後に効く', () => {
    const ps = [param('P', -100, 100, 0)];
    const layers = LAYER_ORDER.map((id, i) => layer(id, 1, { P: i }));
    expect(mixer.mix(ps, [...layers].reverse()).P).toBe(LAYER_ORDER.length - 1);
  });

  it('同じ id のレイヤーが複数あれば、その中では配列の順', () => {
    const ps = [param('P', -100, 100, 0)];
    const out = mixer.mix(ps, [
      layer('expression', 1, { P: 5 }),
      layer('tracking', 1, { P: 100 }),
      layer('expression', 1, { P: 2 }, { P: 'multiply' }),
    ]);
    expect(out.P).toBe(10);
    const swapped = mixer.mix(ps, [
      layer('expression', 1, { P: 2 }, { P: 'multiply' }),
      layer('tracking', 1, { P: 100 }),
      layer('expression', 1, { P: 5 }),
    ]);
    expect(swapped.P).toBe(5);
  });
});

describe('createParameterMixer: 範囲と知らない id', () => {
  it('全パラメータをデフォルト値から始め、最後に min..max に丸める', () => {
    const ps = [param('EyeOpenL', 0, 1, 1), param('MouthOpen', 0, 1, 0), param('FaceAngleX', -30, 30, 0)];
    const out = mixer.mix(ps, [
      layer('tracking', 1, { FaceAngleX: 50, MouthOpen: 0.8 }),
      layer('lipSync', 1, { MouthOpen: 0.5 }, { MouthOpen: 'add' }),
    ]);
    expect(out).toEqual({ EyeOpenL: 1, MouthOpen: 1, FaceAngleX: 30 });
  });

  it('丸めは最後だけ（途中で範囲を出ても、後のレイヤーで戻れば丸めない）', () => {
    const ps = [param('P', 0, 1, 0)];
    const out = mixer.mix(ps, [layer('tracking', 1, { P: 3 }), layer('expression', 1, { P: -2.5 }, { P: 'add' })]);
    expect(out.P).toBeCloseTo(0.5, 10);
  });

  it('知らない id と数でない値は無視する', () => {
    const ps = [param('P', -10, 10, 1)];
    const out = mixer.mix(ps, [layer('tracking', 1, { Unknown: 5, toString: 3, P: Number.NaN })]);
    expect(out).toEqual({ P: 1 });
  });

  it('入力を書き換えない', () => {
    const ps = [param('P', 0, 1, 0)];
    const layers = [layer('tracking', 0.5, { P: 4 }, { P: 'add' })];
    const before = structuredClone({ ps, layers });
    mixer.mix(ps, layers);
    expect({ ps, layers }).toEqual(before);
  });
});

describe('createParameterMixer: 層の順（STEP3 のカード65・CC-010）', () => {
  it('順は tracking → auto → bodyFollow → expression → hotkey → animation → lipSync → periodic → physics', () => {
    expect(LAYER_ORDER).toEqual([
      'tracking',
      'auto',
      'bodyFollow',
      'expression',
      'hotkey',
      'animation',
      'lipSync',
      'periodic',
      'physics',
    ]);
  });

  it('auto はトラッキングの後・表情の前、hotkey は表情の後・アニメーションの前に効く（配列の順に関係なく）', () => {
    const ps = [param('EyeOpenL', 0, 1, 1), param('Tail', -1, 1, 0)];
    const layers = [
      layer('expression', 1, { EyeOpenL: 0.5 }, { EyeOpenL: 'multiply' }),
      layer('auto', 1, { EyeOpenL: 0.2 }),
      layer('tracking', 1, { EyeOpenL: 0.9 }),
      layer('animation', 1, { Tail: 0.3 }),
      layer('hotkey', 1, { Tail: 1 }),
    ];
    const out = mixer.mix(ps, layers);
    // tracking 0.9 を auto 0.2 が上書きし、表情が 0.5 倍する
    expect(out.EyeOpenL).toBeCloseTo(0.1);
    // hotkey の 1 をアニメーションの 0.3 が上書きする
    expect(out.Tail).toBeCloseTo(0.3);
  });
});
