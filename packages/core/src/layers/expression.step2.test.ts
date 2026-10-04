import { describe, expect, it } from 'vitest';
import { createEmptyProject, ensureStandardParameters, type BlendOp, type Expression, type Project } from '@app/schema';
import { FakeExpressions, type ExpressionController, type Layer, type ParamValues } from '@app/contracts';
import { createParameterMixer } from '../mix';
import { createExpressionController } from './expression';

// 表情の同時適用（カード52）。toggle で重ね、produce は表情ごとのレイヤーを適用した順に返す

const mixer = createParameterMixer();
const flags = { lipSyncWeight: 1, physicsActive: true };

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
    fadeIn: fade.fadeIn ?? 0.2,
    fadeOut: fade.fadeOut ?? 0.2,
  };
}

function layerOf(e: Expression, weight: number): Layer {
  return {
    id: 'expression',
    weight,
    values: Object.fromEntries(e.entries.map((x) => [x.parameterId, x.value])),
    blend: Object.fromEntries(e.entries.map((x) => [x.parameterId, x.blend])),
  };
}

// トラッキングの上に表情のレイヤーを合成する
function frame(c: ExpressionController, p: Project, now: number, tracking: ParamValues = {}) {
  const trackingLayer: Layer = { id: 'tracking', weight: 1, values: tracking };
  const mixedSoFar = mixer.mix(p.model.parameters, [trackingLayer]);
  const produced = c.produce({ now, dt: 16, project: p, mixedSoFar, flags });
  const layers = produced === null ? [] : Array.isArray(produced) ? produced : [produced];
  return { layers, out: mixer.mix(p.model.parameters, [trackingLayer, ...layers]) };
}

function expectClose(actual: ParamValues, expected: ParamValues) {
  for (const [id, v] of Object.entries(expected)) expect(actual[id], id).toBeCloseTo(v, 9);
}

const tracking = { FaceAngleX: 10, EyeOpenL: 0.8, MouthForm: 0.2 };
// 笑顔と照れ。顔の角度（add）・目の開閉（multiply）・口の形（override）を取り合い、頬染めは照れだけ
const smile = expression(
  'smile',
  [
    ['FaceAngleX', 10, 'add'],
    ['EyeOpenL', 0.6, 'multiply'],
    ['MouthForm', 0.8, 'override'],
  ],
  { fadeIn: 0.2, fadeOut: 0.4 },
);
const blush = expression(
  'blush',
  [
    ['FaceAngleX', 5, 'add'],
    ['EyeOpenL', 0.5, 'multiply'],
    ['MouthForm', 0.3, 'override'],
    ['Cheek', 1, 'override'],
  ],
  { fadeIn: 0.2, fadeOut: 0.2 },
);
const angry = expression('angry', [['BrowFormL', 1, 'add']], { fadeIn: 0.2, fadeOut: 0.2 });

// 笑顔 → 照れの順に重ね、どちらもフェードし終わった状態（時刻 1000）
function stacked(first = smile, second = blush) {
  const c = createExpressionController();
  const p = project([smile, blush, angry]);
  c.toggle(first.id, 0);
  c.toggle(second.id, 0);
  frame(c, p, 0, tracking);
  frame(c, p, 1000, tracking);
  return { c, p };
}

describe('createExpressionController の toggle・actives（カード52）', () => {
  it('toggle は適用していなければ後ろに足し、適用していれば外す。actives は適用した順、active は最後のもの', () => {
    const c = createExpressionController();
    expect(c.actives()).toEqual([]);
    c.toggle('smile', 0);
    expect(c.actives()).toEqual(['smile']);
    expect(c.active()).toBe('smile');
    c.toggle('blush', 10);
    expect(c.actives()).toEqual(['smile', 'blush']);
    expect(c.active()).toBe('blush');
    c.toggle('smile', 20);
    expect(c.actives()).toEqual(['blush']);
    c.toggle('smile', 30);
    expect(c.actives()).toEqual(['blush', 'smile']);
    // 返した配列を書き換えても中は変わらない
    c.actives().push('angry');
    expect(c.actives()).toEqual(['blush', 'smile']);
    c.toggle('blush', 40);
    c.toggle('smile', 50);
    expect(c.actives()).toEqual([]);
    expect(c.active()).toBeNull();
  });

  it('適用中の一覧は仮実装（FakeExpressions）と同じ順になる', () => {
    const c = createExpressionController();
    const fake = new FakeExpressions();
    const steps: [op: 'toggle' | 'apply', id: string | null][] = [
      ['toggle', 'smile'],
      ['toggle', 'blush'],
      ['toggle', 'angry'],
      ['toggle', 'blush'],
      ['apply', 'smile'],
      ['toggle', 'angry'],
      ['toggle', 'smile'],
      ['apply', null],
      ['toggle', 'blush'],
    ];
    for (const [op, id] of steps) {
      for (const target of [c, fake]) {
        if (op === 'toggle') target.toggle(id!, 0);
        else target.apply(id, 0);
      }
      expect(c.actives(), `${op} ${id}`).toEqual(fake.actives());
      expect(c.active(), `${op} ${id}`).toBe(fake.active());
    }
  });
});

describe('2つの表情を重ねたときの値', () => {
  it('add は足し合わせ、multiply は掛け合わせ、override は後から適用した表情の値になる', () => {
    const { c, p } = stacked(smile, blush);
    const { layers, out } = frame(c, p, 1000, tracking);
    // 適用した順に1つずつ（weight はフェードの重み、blend は各項目の blend）
    expect(layers).toEqual([layerOf(smile, 1), layerOf(blush, 1)]);
    expectClose(out, { FaceAngleX: 25, EyeOpenL: 0.8 * 0.6 * 0.5, MouthForm: 0.3, Cheek: 1 });
    // 逆の順に重ねると、override の口の形だけが変わる
    const reversed = stacked(blush, smile);
    const r = frame(reversed.c, reversed.p, 1000, tracking);
    expect(r.layers).toEqual([layerOf(blush, 1), layerOf(smile, 1)]);
    expectClose(r.out, { FaceAngleX: 25, EyeOpenL: 0.8 * 0.6 * 0.5, MouthForm: 0.8, Cheek: 1 });
  });

  it('重ねた表情は、前の表情はそのままで fadeIn の秒数で現れる（0・半分・終わり）', () => {
    const c = createExpressionController();
    const p = project([smile, blush]);
    c.toggle('smile', 0);
    frame(c, p, 0, tracking);
    expectClose(frame(c, p, 1000, tracking).out, { FaceAngleX: 20, EyeOpenL: 0.48, MouthForm: 0.8, Cheek: 0 });
    c.toggle('blush', 1000);
    // 0 の時点は笑顔だけ
    const start = frame(c, p, 1000, tracking);
    expect(start.layers).toEqual([layerOf(smile, 1)]);
    expectClose(start.out, { FaceAngleX: 20, EyeOpenL: 0.48, MouthForm: 0.8, Cheek: 0 });
    // 半分（照れの重み 0.5）: add は +2.5、multiply は ×0.75、override は笑顔と照れの間
    const half = frame(c, p, 1100, tracking);
    expect(half.layers).toEqual([layerOf(smile, 1), layerOf(blush, 0.5)]);
    expectClose(half.out, { FaceAngleX: 22.5, EyeOpenL: 0.48 * 0.75, MouthForm: 0.55, Cheek: 0.5 });
    // 終わり
    const end = frame(c, p, 1200, tracking);
    expect(end.layers).toEqual([layerOf(smile, 1), layerOf(blush, 1)]);
    expectClose(end.out, { FaceAngleX: 25, EyeOpenL: 0.24, MouthForm: 0.3, Cheek: 1 });
  });

  it('同じ時刻に2つ足すと、両方が同時に現れる（toggle は次の produce でまとめて行う）', () => {
    const c = createExpressionController();
    const p = project([smile, blush]);
    c.toggle('smile', 0);
    c.toggle('blush', 0);
    const half = frame(c, p, 100, tracking);
    expect(half.layers).toEqual([layerOf(smile, 0.5), layerOf(blush, 0.5)]);
    // 顔の角度は 10 + 5 + 2.5、口の形は 0.2 → 0.5（笑顔の半分）→ 0.4（照れの半分）
    expectClose(half.out, { FaceAngleX: 17.5, EyeOpenL: 0.8 * 0.8 * 0.75, MouthForm: 0.4, Cheek: 0.5 });
  });
});

describe('片方だけ外したときのフェード', () => {
  it('先に適用した表情を外すと、その表情だけが fadeOut の秒数で消え、もう片方は変わらない', () => {
    const { c, p } = stacked(smile, blush);
    c.toggle('smile', 2000); // 笑顔の fadeOut は 0.4 秒
    expect(c.actives()).toEqual(['blush']);
    // 外した時点は重ねたまま
    const start = frame(c, p, 2000, tracking);
    expect(start.layers).toEqual([layerOf(smile, 1), layerOf(blush, 1)]);
    // 半分（笑顔の重み 0.5）。笑顔は元の位置（照れより前）に残る
    const half = frame(c, p, 2200, tracking);
    expect(half.layers).toEqual([layerOf(smile, 0.5), layerOf(blush, 1)]);
    expectClose(half.out, { FaceAngleX: 20, EyeOpenL: 0.8 * 0.8 * 0.5, MouthForm: 0.3, Cheek: 1 });
    // 消え終わったら照れだけ
    const end = frame(c, p, 2400, tracking);
    expect(end.layers).toEqual([layerOf(blush, 1)]);
    expectClose(end.out, { FaceAngleX: 15, EyeOpenL: 0.4, MouthForm: 0.3, Cheek: 1 });
  });

  it('後から適用した表情を外すと、override の値は前の表情の値へ fadeOut の秒数で戻る', () => {
    const { c, p } = stacked(smile, blush);
    c.toggle('blush', 2000); // 照れの fadeOut は 0.2 秒
    expect(c.actives()).toEqual(['smile']);
    const half = frame(c, p, 2100, tracking);
    expect(half.layers).toEqual([layerOf(smile, 1), layerOf(blush, 0.5)]);
    expectClose(half.out, { FaceAngleX: 22.5, EyeOpenL: 0.48 * 0.75, MouthForm: 0.55, Cheek: 0.5 });
    const end = frame(c, p, 2200, tracking);
    expect(end.layers).toEqual([layerOf(smile, 1)]);
    expectClose(end.out, { FaceAngleX: 20, EyeOpenL: 0.48, MouthForm: 0.8, Cheek: 0 });
  });

  it('現れている途中で外すと、その時点の重みから消える（値が飛ばない）', () => {
    const c = createExpressionController();
    const p = project([smile, blush]);
    c.toggle('smile', 0);
    c.toggle('blush', 0);
    const before = frame(c, p, 50, tracking); // どちらも重み 0.15625
    c.toggle('blush', 50);
    const after = frame(c, p, 50, tracking);
    expect(after.layers).toEqual(before.layers);
    expectClose(after.out, before.out);
    // 照れは 0.15625 から fadeOut 0.2 秒で消え、笑顔は現れ続ける
    const later = frame(c, p, 150, tracking);
    expect(later.layers[0]).toEqual(layerOf(smile, 0.84375));
    expect(later.layers[1]?.weight).toBeCloseTo(0.15625 * 0.5, 12);
    expect(frame(c, p, 250, tracking).layers).toEqual([layerOf(smile, 1)]);
  });

  it('消えている途中でもう一度足すと、その重みから現れ、後から適用したことになる', () => {
    const { c, p } = stacked(smile, blush);
    c.toggle('smile', 2000);
    const fading = frame(c, p, 2200, tracking); // 笑顔は 0.5
    c.toggle('smile', 2200);
    expect(c.actives()).toEqual(['blush', 'smile']);
    const back = frame(c, p, 2200, tracking);
    expect(back.layers).toEqual([layerOf(blush, 1), layerOf(smile, 0.5)]);
    // add・multiply は順番に依らないので値が飛ばない（override の口の形は、後になった笑顔へ寄る）
    expectClose(back.out, { FaceAngleX: fading.out.FaceAngleX!, EyeOpenL: fading.out.EyeOpenL! });
    expect(back.out.MouthForm).toBeCloseTo(0.55, 9);
    // 笑顔の fadeIn 0.2 秒で 0.5 から 1 へ
    expect(frame(c, p, 2300, tracking).layers).toEqual([layerOf(blush, 1), layerOf(smile, 0.75)]);
    const end = frame(c, p, 2400, tracking);
    expect(end.layers).toEqual([layerOf(blush, 1), layerOf(smile, 1)]);
    expectClose(end.out, { FaceAngleX: 25, MouthForm: 0.8 });
  });
});

describe('apply は STEP1 と同じ動き（ほかを全部外して1つにする）', () => {
  it('重ねていても、apply した表情だけにし、ほかは fadeOut の秒数で消える', () => {
    const { c, p } = stacked(smile, blush);
    c.apply('angry', 2000);
    expect(c.actives()).toEqual(['angry']);
    expect(c.active()).toBe('angry');
    const half = frame(c, p, 2100, tracking);
    // 笑顔（fadeOut 0.4 秒）は 0.84375、照れ（0.2 秒）は 0.5、怒りは 0.5
    expect(half.layers).toEqual([layerOf(smile, 0.84375), layerOf(blush, 0.5), layerOf(angry, 0.5)]);
    expect(frame(c, p, 2400, tracking).layers).toEqual([layerOf(angry, 1)]);
  });

  it('適用中の表情を apply すると、ほかだけを外し、その表情は最初からやり直さない', () => {
    const c = createExpressionController();
    const p = project([smile, blush]);
    c.toggle('smile', 0);
    frame(c, p, 0, tracking);
    c.toggle('blush', 100);
    frame(c, p, 100, tracking); // 笑顔は 0.5、照れは 0
    c.apply('smile', 150);
    expect(c.actives()).toEqual(['smile']);
    // 笑顔はそのまま現れ続け（200 で終わり）、照れは 150 の時点の重みから消える
    const t200 = frame(c, p, 200, tracking);
    expect(t200.layers[0]).toEqual(layerOf(smile, 1));
    expect(frame(c, p, 400, tracking).layers).toEqual([layerOf(smile, 1)]);
    // 1つだけ適用しているときに同じ表情を apply しても何もしない
    c.apply('smile', 500);
    expect(frame(c, p, 500, tracking).layers).toEqual([layerOf(smile, 1)]);
  });

  it('apply(null) で重ねた表情を全部外す（それぞれの fadeOut の秒数で消える）', () => {
    const { c, p } = stacked(smile, blush);
    // eslint-disable-next-line prefer-spread -- ExpressionController.apply は Function.prototype.apply ではない
    c.apply(null, 2000);
    expect(c.actives()).toEqual([]);
    expect(c.active()).toBeNull();
    expect(frame(c, p, 2100, tracking).layers).toEqual([layerOf(smile, 0.84375), layerOf(blush, 0.5)]);
    expect(frame(c, p, 2200, tracking).layers).toEqual([layerOf(smile, 0.5)]);
    const end = frame(c, p, 2400, tracking);
    expect(end.layers).toEqual([]);
    expectClose(end.out, tracking);
  });

  it('apply のあとに toggle で重ねられる', () => {
    const c = createExpressionController();
    const p = project([smile, blush]);
    c.apply('smile', 0);
    c.toggle('blush', 0);
    expect(c.actives()).toEqual(['smile', 'blush']);
    expect(frame(c, p, 1000, tracking).layers).toEqual([layerOf(smile, 1), layerOf(blush, 1)]);
  });
});
