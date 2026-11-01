// AT-10 の独立確認（CL、2026-11-01）。モデリングの腕の設定のコマンドを、COの試験とは別に組んだモデルで確かめる。
// 関節の配置（付け替えで見た目が変わらない）、素材不足・競合、Undo/Redo、顔より前、解除、自動セットアップの再実行、保存と再読込
import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  validateProject,
  type ArmHandAttachment,
  type ArmRig,
  type ArmSide,
  type HandShape,
  type Part,
  type Project,
  type Vec2,
} from '@app/schema';
import { createDeformPipeline } from '../../deform';
import { createBindingEvaluator } from '../../eval';
import { forwardArmInModel } from '../../joint/math';
import { createProjectStore } from '../../store';
import { runAutoSetup } from '../autoSetup';
import { armInFront, planArmSetup, releaseArmRig, type ArmSetupInput } from './commands';

function part(id: string, kind: Part['kind'], parentId: string | null, patch: Partial<Part> = {}): Part {
  return {
    id,
    kind,
    parentId,
    name: id,
    standardType: null,
    assetId: kind === 'image' ? 'asset' : null,
    meshId: kind === 'image' ? id : null,
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    pivot: { x: 0, y: 0 },
    opacity: 1,
    blendMode: 'normal',
    depth: 0,
    mask: null,
    physicsId: null,
    visible: true,
    locked: false,
    ...patch,
  };
}
const band = (a: Vec2, b: Vec2, w = 6): Vec2[] => {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = { x: (-(b.y - a.y) / d) * w, y: ((b.x - a.x) / d) * w };
  return [
    { x: a.x - n.x, y: a.y - n.y },
    { x: a.x + n.x, y: a.y + n.y },
    { x: b.x + n.x, y: b.y + n.y },
    { x: b.x - n.x, y: b.y - n.y },
  ];
};

// 左腕：肩(380,200)→肘(420,300)→手首(400,390)（肘で内側へ曲がる）。右腕：肩(220,200)→肘(200,305)→手首(215,395)。
// 体（body）は回転・等倍率・移動を持つ。素材はどれも体の子で、変換は恒等
const JOINTS: Record<ArmSide, ArmRig['joints']> = {
  L: { shoulder: { x: 380, y: 200 }, elbow: { x: 420, y: 300 }, wrist: { x: 400, y: 390 } },
  R: { shoulder: { x: 220, y: 200 }, elbow: { x: 200, y: 305 }, wrist: { x: 215, y: 395 } },
};
function project(
  body: Partial<Part> = {
    rotation: 8,
    scale: { x: 0.9, y: 0.9 },
    position: { x: 10, y: -5 },
    pivot: { x: 300, y: 300 },
  },
): Project {
  const p = createEmptyProject('AT-10 独立確認');
  p.model.parts.push(part('body', 'group', null, body));
  const image = (id: string, vertices: Vec2[], patch: Partial<Part> = {}) => {
    p.model.parts.push(part(id, 'image', 'body', patch));
    p.model.meshes.push({
      id,
      vertices,
      uvs: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      triangles: [
        [0, 1, 2],
        [0, 2, 3],
      ],
      density: 'custom',
      edited: false,
    });
    p.model.drawOrder.push(id);
  };
  image('face', band({ x: 300, y: 80 }, { x: 300, y: 190 }, 45), { standardType: 'face' });
  for (const side of ['L', 'R'] as const) {
    const j = JOINTS[side];
    image(`upper-${side}`, band(j.shoulder, j.elbow));
    image(`forearm-${side}`, band(j.elbow, j.wrist));
    image(`open-${side}`, band(j.wrist, { x: j.wrist.x, y: j.wrist.y + 30 }, 9));
    image(`fist-${side}`, band(j.wrist, { x: j.wrist.x, y: j.wrist.y + 20 }, 9));
  }
  return p;
}
// 指の向きは前腕の向き（素材は前腕の延長に描いてある、という指定。基準の手首の角度は0になるので、
// この指定なら基準の姿勢で手の見た目が変わらない）
const forearmDirection = (side: ArmSide): Vec2 => {
  const { elbow: e, wrist: w } = JOINTS[side];
  const d = Math.hypot(w.x - e.x, w.y - e.y);
  return { x: (w.x - e.x) / d, y: (w.y - e.y) / d };
};
const hand = (side: ArmSide, shape: HandShape): ArmHandAttachment => ({
  partIds: [`${shape}-${side}`],
  wrist: { ...JOINTS[side].wrist },
  fingerDirection: forearmDirection(side),
});
const input = (side: ArmSide, patch: Partial<ArmSetupInput> = {}): ArmSetupInput => ({
  side,
  parentPartId: 'body',
  upperPartIds: [`upper-${side}`],
  forearmPartIds: [`forearm-${side}`],
  joints: structuredClone(JOINTS[side]),
  hands: { open: hand(side, 'open'), fist: hand(side, 'fist') },
  ...patch,
});
function setup(p: Project, side: ArmSide, patch: Partial<ArmSetupInput> = {}): Project {
  const plan = planArmSetup(p, input(side, patch));
  expect(plan.errors).toEqual([]);
  return plan.command!.apply(p);
}

const evaluator = createBindingEvaluator();
const pipeline = createDeformPipeline();
const positions = (p: Project, values: Record<string, number> = {}) => {
  const out = pipeline.deform(p.model, evaluator.evaluate(p.model, values));
  return Object.fromEntries(Object.entries(out.byPartId).map(([id, item]) => [id, [...item.positions]]));
};
// その側を基準の姿勢（素材を描いた姿勢）にする値
const referenceValues = (rig: ArmRig) => ({
  [rig.parameters.shoulder]: rig.referencePose.shoulder,
  [rig.parameters.elbow]: rig.referencePose.elbow,
  [rig.parameters.wrist]: rig.referencePose.wrist,
  [rig.parameters.shapes.open]: 1,
});
const close = (a: number[], b: number[], tol = 1e-3) =>
  a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) <= tol);

describe('AT-10 独立確認: 関節の配置', () => {
  for (const side of ['L', 'R'] as const)
    it(`${side}：描いた関節から骨長・基準姿勢・曲がる側を作り、順運動学で同じ関節へ戻る`, () => {
      const p = setup(project(), side);
      const rig = p.model.armRigs!.find((r) => r.side === side)!;
      const j = JOINTS[side];
      expect(rig.lengths.upper).toBeCloseTo(Math.hypot(j.elbow.x - j.shoulder.x, j.elbow.y - j.shoulder.y), 9);
      expect(rig.lengths.lower).toBeCloseTo(Math.hypot(j.wrist.x - j.elbow.x, j.wrist.y - j.elbow.y), 9);
      const fk = forwardArmInModel(rig, rig.referencePose);
      for (const k of ['shoulder', 'elbow', 'wrist'] as const) {
        expect(fk[k].x).toBeCloseTo(j[k].x, 6);
        expect(fk[k].y).toBeCloseTo(j[k].y, 6);
      }
      expect(rig.referencePose.elbow).toBeGreaterThanOrEqual(0);
    });

  it('付け替えても、基準の姿勢では素材の見た目が1pxも変わらない（体の回転・倍率・移動の下でも）', () => {
    const before = project();
    let p = setup(before, 'L');
    p = setup(p, 'R');
    const values = Object.assign({}, ...p.model.armRigs!.map(referenceValues));
    const was = positions(before);
    const now = positions(p, values);
    for (const id of ['upper-L', 'forearm-L', 'open-L', 'upper-R', 'forearm-R', 'open-R', 'face'])
      expect(close(now[id]!, was[id]!), id).toBe(true);
  });

  it('関節の設定はプロジェクトの値だけを変え、素材の頂点・UVを書き換えない', () => {
    const before = project();
    const p = setup(before, 'L');
    expect(p.model.meshes).toEqual(before.model.meshes);
    expect(p.assets).toEqual(before.assets);
  });
});

describe('AT-10 独立確認: 素材不足・競合', () => {
  it('上腕・前腕・パーの不足、同じ素材の二重割当、見つからない素材は設定しない', () => {
    const p = project();
    const errorsOf = (patch: Partial<ArmSetupInput>) => planArmSetup(p, input('L', patch));
    expect(errorsOf({ forearmPartIds: [] }).command).toBeNull();
    expect(errorsOf({ hands: { fist: hand('L', 'fist') } }).command).toBeNull();
    expect(errorsOf({ forearmPartIds: ['upper-L'] }).command).toBeNull();
    expect(errorsOf({ upperPartIds: ['nothing'] }).command).toBeNull();
    expect(errorsOf({ parentPartId: 'upper-L' }).command).toBeNull();
  });

  it('ロックされた素材・キーのある素材は設定せず、キーを消さない', () => {
    const locked = project();
    locked.model.parts.find((x) => x.id === 'forearm-L')!.locked = true;
    expect(planArmSetup(locked, input('L')).command).toBeNull();
    const keyed = project();
    keyed.model.bindings.push({
      id: 'k1',
      target: { type: 'part', id: 'upper-L' },
      channel: 'transform',
      parameterIds: ['FaceAngleX'],
      keyValues: [[-30, 0, 30]],
      keys: [],
      generation: 'linear',
      divisions: null,
    });
    const plan = planArmSetup(keyed, input('L'));
    expect(plan.command).toBeNull();
    expect(plan.errors.join()).toMatch(/キー/);
    expect(keyed.model.bindings.map((b) => b.id)).toEqual(['k1']);
  });

  it('同じ側の二重設定・別の腕の素材は設定しない', () => {
    const p = setup(project(), 'L');
    expect(planArmSetup(p, input('L')).command).toBeNull();
    expect(planArmSetup(p, input('R', { upperPartIds: ['upper-L'] })).command).toBeNull();
  });

  it('旧ArmL のグループからの付け替えは確認が要り、確認すれば元のグループとキーを残して設定する', () => {
    const p = project();
    p.model.parts.push(part('legacy-armL', 'group', 'body'));
    for (const id of ['upper-L', 'forearm-L', 'open-L', 'fist-L'])
      p.model.parts.find((x) => x.id === id)!.parentId = 'legacy-armL';
    p.model.bindings.push({
      id: 'legacy',
      target: { type: 'part', id: 'legacy-armL' },
      channel: 'transform',
      parameterIds: ['ArmL'],
      keyValues: [[-30, 0, 30]],
      keys: [],
      generation: 'linear',
      divisions: null,
    });
    const plan = planArmSetup(p, input('L'));
    expect(plan.command).toBeNull();
    expect(plan.warnings.length).toBeGreaterThan(0);
    const ok = planArmSetup(p, input('L', { acknowledgeLegacy: true }));
    expect(ok.errors).toEqual([]);
    const next = ok.command!.apply(p);
    expect(next.model.parts.some((x) => x.id === 'legacy-armL')).toBe(true);
    expect(next.model.bindings.some((b) => b.id === 'legacy')).toBe(true);
  });
});

describe('AT-10 独立確認: Undo/Redo・顔より前・解除', () => {
  it('設定・顔より前・解除のそれぞれを1回のUndoで戻し、Redoで同じ結果に戻る', () => {
    const start = project();
    const store = createProjectStore(start);
    const plan = planArmSetup(store.get(), input('L'));
    store.dispatch(plan.command!);
    const afterSetup = store.get();
    const rig = afterSetup.model.armRigs![0]!;
    store.dispatch(armInFront(rig.id));
    const afterFront = store.get();
    store.dispatch(releaseArmRig(rig.id));
    store.undo();
    expect(store.get()).toEqual(afterFront);
    store.undo();
    expect(store.get()).toEqual(afterSetup);
    store.undo();
    expect(store.get()).toEqual(start);
    store.redo();
    expect(store.get()).toEqual(afterSetup);
  });

  it('顔より前：前腕と手だけを最前面へ移し、他の並びは保ち、2回目は変えない', () => {
    const p = setup(project(), 'L');
    const rig = p.model.armRigs![0]!;
    const front = armInFront(rig.id).apply(p);
    const order = front.model.drawOrder;
    const tail = order.slice(-3);
    expect(new Set(tail)).toEqual(new Set(['forearm-L', 'open-L', 'fist-L']));
    expect(order.filter((id) => !tail.includes(id))).toEqual(p.model.drawOrder.filter((id) => !tail.includes(id)));
    expect(order.indexOf('face')).toBeLessThan(order.indexOf('forearm-L'));
    expect(armInFront(rig.id).apply(front).model.drawOrder).toEqual(order);
  });

  it('解除：関節のグループと設定を消し、素材・パラメータ・キーは残し、休止形だけ表示して見た目を元に戻す', () => {
    const before = project();
    const p = setup(before, 'L');
    const rig = p.model.armRigs![0]!;
    p.armTracking = {
      mode: 'normal',
      sides: {
        L: { enabled: true, gain: 1, smoothing: 0.5, handMode: 'auto', restHand: 'open' },
        R: { enabled: true, gain: 1, smoothing: 0.5, handMode: 'auto', restHand: 'open' },
      },
    };
    const released = releaseArmRig(rig.id).apply(p);
    expect(released.model.armRigs).toEqual([]);
    for (const g of Object.values(rig.groups)) expect(released.model.parts.some((x) => x.id === g)).toBe(false);
    expect(released.model.parameters.map((x) => x.id)).toEqual(p.model.parameters.map((x) => x.id));
    expect(released.armTracking!.sides.L.enabled).toBe(false);
    expect(released.armTracking!.sides.R.enabled).toBe(true);
    expect(released.model.parts.find((x) => x.id === 'open-L')!.visible).toBe(true);
    expect(released.model.parts.find((x) => x.id === 'fist-L')!.visible).toBe(false);
    const was = positions(before);
    const now = positions(released);
    for (const id of ['upper-L', 'forearm-L', 'open-L']) expect(close(now[id]!, was[id]!), id).toBe(true);
  });
});

describe('AT-10 独立確認: 再セットアップと保存', () => {
  it('自動セットアップを再実行しても、腕の設定・関節の親・素材・顔より前の並びを保つ', () => {
    let p = setup(project(), 'L');
    const rig = p.model.armRigs![0]!;
    p = armInFront(rig.id).apply(p);
    let n = 0;
    const again = runAutoSetup(p, () => `auto-${n++}`);
    expect(again.model.armRigs).toEqual(p.model.armRigs);
    for (const id of ['upper-L', 'forearm-L', 'open-L', 'fist-L', ...Object.values(rig.groups)])
      expect(again.model.parts.find((x) => x.id === id)).toEqual(p.model.parts.find((x) => x.id === id));
    const order = again.model.drawOrder;
    expect(order.indexOf('forearm-L')).toBeGreaterThan(order.indexOf('face'));
  });

  it('腕を設定した後に足した標準の素材（後ろ髪）も、自動セットアップで標準の描画順（最背面）に入る', () => {
    // 対照：腕の設定が無ければ、後ろ髪は最背面に入る
    const plain = project();
    plain.model.parts.push(part('back-hair', 'image', 'body', { standardType: 'backHair' }));
    plain.model.meshes.push({ ...structuredClone(plain.model.meshes[0]!), id: 'back-hair' });
    let m = 0;
    expect(runAutoSetup(plain, () => `plain-${m++}`).model.drawOrder.indexOf('back-hair')).toBe(0);
    let p = setup(project(), 'L');
    p = armInFront(p.model.armRigs![0]!.id).apply(p);
    p.model.parts.push(part('back-hair', 'image', 'body', { standardType: 'backHair' }));
    p.model.meshes.push({ ...structuredClone(p.model.meshes[0]!), id: 'back-hair' });
    let n = 0;
    const again = runAutoSetup(p, () => `auto-${n++}`);
    expect(again.model.drawOrder.indexOf('back-hair')).toBe(0);
  });

  it('保存の形（JSON）で書いて読み直しても、腕の設定と見た目が同じ', () => {
    let p = setup(project(), 'L');
    p = setup(p, 'R');
    const reloaded = validateProject(JSON.parse(JSON.stringify(p)));
    expect(reloaded.model.armRigs).toEqual(p.model.armRigs);
    const values = Object.assign({}, ...p.model.armRigs!.map(referenceValues), { ArmShoulderL: 70, ArmElbowL: 40 });
    const a = positions(p, values);
    const b = positions(reloaded, values);
    for (const id of Object.keys(a)) expect(close(a[id]!, b[id]!, 1e-6), id).toBe(true);
  });
});

// AT-10 CO v2 の再確認（CL、2026-11-01）。修正した2件の周りと、追加された基準画像の手首の角度
describe('AT-10 再確認（CO v2）', () => {
  it('腕があっても、腕以外の標準の素材は自動セットアップで標準の順に並べ直し、顔より前の腕は前に残す', () => {
    const p = project();
    // 後ろ髪を顔より前に置いた（標準の順ではない）状態から始める
    p.model.parts.push(part('back-hair', 'image', 'body', { standardType: 'backHair' }));
    p.model.meshes.push({ ...structuredClone(p.model.meshes[0]!), id: 'back-hair' });
    p.model.drawOrder.push('back-hair');
    let q = setup(p, 'L');
    q = armInFront(q.model.armRigs![0]!.id).apply(q);
    let n = 0;
    const order = runAutoSetup(q, () => `auto-${n++}`).model.drawOrder;
    expect(order.indexOf('back-hair')).toBeLessThan(order.indexOf('face'));
    for (const id of ['forearm-L', 'open-L', 'fist-L'])
      expect(order.indexOf(id), id).toBeGreaterThan(order.indexOf('face'));
    // 腕の素材どうしの並びは変えない
    const arms = order.filter((id) => /-L$/.test(id));
    expect(arms).toEqual(q.model.drawOrder.filter((id) => /-L$/.test(id)));
  });

  it('基準画像の手首の角度を指定すると、曲げて描いた手も基準の姿勢で見た目が変わらない', () => {
    const bent = 30;
    const before = project();
    const { elbow: e, wrist: w } = JOINTS.L;
    const f = Math.atan2(w.x - e.x, w.y - e.y); // L は外向き +x。下向き0
    const dir = { x: Math.sin(f + (bent * Math.PI) / 180), y: Math.cos(f + (bent * Math.PI) / 180) };
    before.model.meshes.find((m) => m.id === 'open-L')!.vertices = band(
      w,
      { x: w.x + dir.x * 30, y: w.y + dir.y * 30 },
      9,
    );
    const hands = { open: { partIds: ['open-L'], wrist: { ...w }, fingerDirection: dir }, fist: hand('L', 'fist') };
    const p = setup(before, 'L', { hands, referenceWristAngle: bent });
    const rig = p.model.armRigs![0]!;
    expect(rig.referencePose.wrist).toBeCloseTo(bent, 9);
    const was = positions(before);
    expect(close(positions(p, referenceValues(rig))['open-L']!, was['open-L']!)).toBe(true);
    // 指定しなければ（0°）、手は前腕の延長へ回る
    const straight = setup(before, 'L', { hands });
    const r0 = straight.model.armRigs![0]!;
    expect(close(positions(straight, referenceValues(r0))['open-L']!, was['open-L']!)).toBe(false);
  });

  it('可動域の外の基準の手首の角度では作成しない', () => {
    expect(planArmSetup(project(), input('L', { referenceWristAngle: 90 })).command).toBeNull();
    expect(planArmSetup(project(), input('L', { referenceWristAngle: Number.NaN })).command).toBeNull();
  });
});
