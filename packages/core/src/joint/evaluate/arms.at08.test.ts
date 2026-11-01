// AT-08 の独立確認（CL、2026-11-01）。COの技術見本（testing.ts）は使わず、別に組んだモデルを
// 製品の BindingEvaluator → DeformPipeline に通し、関節の接続・親の変換・手形の表示・旧ArmL/R・合成後の制約を確かめる。
import { describe, expect, it } from 'vitest';
import type { Layer } from '@app/contracts';
import {
  armParameterIds,
  armParameters,
  armPoseAllowed,
  createEmptyProject,
  defaultArmLimits,
  partAffine,
  transformVec,
  type ArmPose,
  type ArmRig,
  type ArmSide,
  type HandShape,
  type Model,
  type Part,
  type Vec2,
} from '@app/schema';
import { createDeformPipeline } from '../../deform';
import { createBindingEvaluator } from '../../eval';
import { createParameterMixer } from '../../mix';

const RAD = Math.PI / 180;
const SHOULDER: Record<ArmSide, Vec2> = { L: { x: 380, y: 200 }, R: { x: 220, y: 200 } };
const LENGTH = { upper: 110, lower: 95 };

// 独立に書いた順運動学（モデル座標。L は +x、R は −x へ外向き）
function joints(side: ArmSide, p: ArmPose): { shoulder: Vec2; elbow: Vec2; wrist: Vec2; hand: Vec2 } {
  const out = side === 'L' ? 1 : -1;
  const s = SHOULDER[side];
  const a = p.shoulder * RAD;
  const f = (p.shoulder + p.elbow) * RAD;
  const h = (p.shoulder + p.elbow + p.wrist) * RAD;
  const elbow = { x: s.x + out * LENGTH.upper * Math.sin(a), y: s.y + LENGTH.upper * Math.cos(a) };
  const wrist = { x: elbow.x + out * LENGTH.lower * Math.sin(f), y: elbow.y + LENGTH.lower * Math.cos(f) };
  return { shoulder: s, elbow, wrist, hand: { x: out * Math.sin(h), y: Math.cos(h) } };
}

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

// 線分 a→b の細い四角。頂点0・1の中点が a、2・3の中点が b
function band(a: Vec2, b: Vec2, w = 6): Vec2[] {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = { x: (-(b.y - a.y) / d) * w, y: ((b.x - a.x) / d) * w };
  return [
    { x: a.x - n.x, y: a.y - n.y },
    { x: a.x + n.x, y: a.y + n.y },
    { x: b.x + n.x, y: b.y + n.y },
    { x: b.x - n.x, y: b.y - n.y },
  ];
}

interface Options {
  reference?: ArmPose;
  root?: Partial<Part>;
  hands?: HandShape[];
  restHand?: HandShape;
}
// 体（root）→ 肩 → 肘 → 手首 の専用グループ、上腕・前腕・手の画像、顔。手の画像は手首から離れた所に、
// 横向き（+x）に描いておき、接続で手首へ運ばれることを確かめる
function buildModel(options: Options = {}): Model {
  const reference = options.reference ?? { shoulder: 0, elbow: 0, wrist: 0 };
  const model = createEmptyProject('AT-08 独立確認').model;
  model.parts.push(part('body', 'group', null, options.root));
  const image = (id: string, parent: string, vertices: Vec2[], patch: Partial<Part> = {}) => {
    model.parts.push(part(id, 'image', parent, patch));
    model.meshes.push({
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
    model.drawOrder.push(id);
  };
  image('face', 'body', band({ x: 300, y: 80 }, { x: 300, y: 180 }, 40));
  model.armRigs = [];
  for (const side of ['L', 'R'] as ArmSide[]) {
    const j = joints(side, reference);
    const g = { shoulder: `sh-${side}`, elbow: `el-${side}`, wrist: `wr-${side}` };
    model.parts.push(
      part(g.shoulder, 'group', 'body'),
      part(g.elbow, 'group', g.shoulder),
      part(g.wrist, 'group', g.elbow),
    );
    image(`up-${side}`, g.shoulder, band(j.shoulder, j.elbow));
    image(`lo-${side}`, g.elbow, band(j.elbow, j.wrist));
    const rig: ArmRig = {
      id: `rig-${side}`,
      side,
      enabled: true,
      parentPartId: 'body',
      groups: g,
      joints: { shoulder: j.shoulder, elbow: j.elbow, wrist: j.wrist },
      lengths: { ...LENGTH },
      bendSign: 1,
      referencePose: { ...reference },
      restPose: { shoulder: 8, elbow: 12, wrist: 0 },
      limits: defaultArmLimits(),
      hands: {},
      restHand: options.restHand ?? 'open',
      parameters: armParameterIds(side),
    };
    for (const [i, shape] of (options.hands ?? (['open', 'fist', 'point', 'peace'] as HandShape[])).entries()) {
      const at = { x: 500 + i * 40, y: 40 }; // 手首から離れた所に、+x 向きに描いた手
      image(`${shape}-${side}`, g.wrist, band(at, { x: at.x + 30, y: at.y }, 8));
      rig.hands[shape] = { partIds: [`${shape}-${side}`], wrist: at, fingerDirection: { x: 1, y: 0 } };
    }
    model.parameters.push(...armParameters(rig));
    model.armRigs.push(rig);
  }
  return model;
}

const evaluator = createBindingEvaluator();
const pipeline = createDeformPipeline();
const params = (side: ArmSide, p: ArmPose, extra: Record<string, number> = {}) => ({
  [`ArmShoulder${side}`]: p.shoulder,
  [`ArmElbow${side}`]: p.elbow,
  [`HandAngle${side}`]: p.wrist,
  ...extra,
});
const render = (model: Model, values: Record<string, number>) =>
  pipeline.deform(model, evaluator.evaluate(model, values));
const mid = (positions: Float32Array, a: number, b: number): Vec2 => ({
  x: (positions[a * 2]! + positions[b * 2]!) / 2,
  y: (positions[a * 2 + 1]! + positions[b * 2 + 1]!) / 2,
});
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (v: Vec2) => {
  const d = Math.hypot(v.x, v.y);
  return { x: v.x / d, y: v.y / d };
};
const opacityOf = (out: ReturnType<typeof render>, id: string) => out.byPartId[id]?.opacity ?? 0;

// 描かれた腕が、期待する関節（体の変換 root を掛けた後）へつながっているか
function expectConnected(model: Model, out: ReturnType<typeof render>, side: ArmSide, pose: ArmPose, hand: HandShape) {
  const body = model.parts.find((p) => p.id === 'body')!;
  const m = partAffine(body, undefined);
  const j = joints(side, pose);
  const to = (p: Vec2) => transformVec(m, p);
  const up = out.byPartId[`up-${side}`]!.positions;
  const lo = out.byPartId[`lo-${side}`]!.positions;
  const h = out.byPartId[`${hand}-${side}`]!.positions;
  expect(dist(mid(up, 0, 1), to(j.shoulder)), `${side} 肩`).toBeLessThan(0.01);
  expect(dist(mid(up, 2, 3), to(j.elbow)), `${side} 肘（上腕）`).toBeLessThan(0.01);
  expect(dist(mid(lo, 0, 1), to(j.elbow)), `${side} 肘（前腕）`).toBeLessThan(0.01);
  expect(dist(mid(lo, 2, 3), to(j.wrist)), `${side} 手首（前腕）`).toBeLessThan(0.01);
  expect(dist(mid(h, 0, 1), to(j.wrist)), `${side} 手首（手）`).toBeLessThan(0.01);
  // 手の向き（手首→指先）が、肩＋肘＋手首の角度（体の回転を足したもの）
  const dir = unit({ x: mid(h, 2, 3).x - mid(h, 0, 1).x, y: mid(h, 2, 3).y - mid(h, 0, 1).y });
  const want = unit({ x: m.a * j.hand.x + m.c * j.hand.y, y: m.b * j.hand.x + m.d * j.hand.y });
  expect(dist(dir, want), `${side} 手の向き`).toBeLessThan(1e-4);
}

const POSES: ArmPose[] = [
  { shoulder: 8, elbow: 12, wrist: 0 },
  { shoulder: 90, elbow: 0, wrist: 0 },
  { shoulder: 110, elbow: 130, wrist: -30 },
  { shoulder: 65, elbow: 100, wrist: 25 },
  { shoulder: -25, elbow: 0, wrist: -20 },
];

describe('AT-08 独立確認: 関節の接続', () => {
  for (const reference of [
    { shoulder: 0, elbow: 0, wrist: 0 },
    { shoulder: 25, elbow: 65, wrist: 10 },
  ])
    it(`基準画像の姿勢（肩${reference.shoulder}・肘${reference.elbow}・手首${reference.wrist}）に関係なく、肩・肘・手首・手がつながる`, () => {
      const model = buildModel({ reference });
      for (const pose of POSES)
        for (const side of ['L', 'R'] as const) {
          const out = render(model, { ...params('L', pose), ...params('R', pose) });
          expectConnected(model, out, side, pose, 'open');
        }
    });

  it('体の回転12°・等倍率0.85・呼吸の移動を掛けても、つながったまま一緒に動く', () => {
    for (const root of [
      { rotation: 12, scale: { x: 0.85, y: 0.85 }, pivot: { x: 300, y: 300 } },
      { position: { x: 0, y: 6 } },
      { rotation: -20, position: { x: 15, y: -4 }, pivot: { x: 300, y: 200 } },
    ]) {
      const model = buildModel({ root });
      for (const pose of POSES) {
        const out = render(model, { ...params('L', pose), ...params('R', pose) });
        expectConnected(model, out, 'L', pose, 'open');
        expectConnected(model, out, 'R', pose, 'open');
      }
    }
  });

  it('手は剛体のまま運ぶ（大きさ・向きの左右を変えない、反転しない）', () => {
    const model = buildModel();
    const out = render(model, params('R', { shoulder: 110, elbow: 130, wrist: -30 }));
    const before = model.meshes.find((m) => m.id === 'open-R')!.vertices;
    const after = out.byPartId['open-R']!.positions;
    const p = (i: number) => ({ x: after[i * 2]!, y: after[i * 2 + 1]! });
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [0, 2],
    ] as const)
      expect(dist(p(a), p(b))).toBeCloseTo(dist(before[a]!, before[b]!), 3); // 頂点は Float32
    const signed = (q: Vec2[]) => (q[1]!.x - q[0]!.x) * (q[2]!.y - q[0]!.y) - (q[1]!.y - q[0]!.y) * (q[2]!.x - q[0]!.x);
    expect(Math.sign(signed([p(0), p(1), p(2)]))).toBe(Math.sign(signed(before)));
    expect([...out.byPartId['open-R']!.uvs]).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
  });

  it('同じ値の評価は何度・どの順で行っても同じ（前の結果へ回転を積み重ねない）', () => {
    const model = buildModel({ reference: { shoulder: 25, elbow: 65, wrist: 10 } });
    const a = params('L', POSES[2]!);
    const first = render(model, a).byPartId['lo-L']!.positions.slice();
    for (const pose of POSES) render(model, params('L', pose));
    expect([...render(model, a).byPartId['lo-L']!.positions]).toEqual([...first]);
    expect([...render(model, a).byPartId['lo-L']!.positions]).toEqual([...first]);
  });
});

describe('AT-08 独立確認: 合成後の制約', () => {
  it('可動域・前腕／手の合成角を外れた値や非有限の値でも、制約の中の姿勢でつながる', () => {
    const model = buildModel();
    const rig = model.armRigs![0]!;
    for (const values of [
      params('L', { shoulder: 300, elbow: -50, wrist: 90 }),
      params('L', { shoulder: 160, elbow: 145, wrist: 40 }), // 前腕305°・手345°（合成角の外）
      params('L', { shoulder: Number.NaN, elbow: 20, wrist: Infinity }),
    ]) {
      const targets = evaluator.evaluate(model, values);
      const pose = targets.arms!.poses.L!;
      expect(armPoseAllowed(rig, pose)).toBe(true);
      expectConnected(model, pipeline.deform(model, targets), 'L', pose, 'open');
    }
  });

  it('アニメーションが上書きした値（合成の後）にも制約を掛ける', () => {
    const model = buildModel();
    const mixer = createParameterMixer();
    const tracking: Layer = { id: 'tracking', weight: 1, values: params('L', { shoulder: 40, elbow: 30, wrist: 0 }) };
    const animation: Layer = {
      id: 'animation',
      weight: 1,
      values: params('L', { shoulder: 160, elbow: 145, wrist: 40 }),
    };
    const mixed = mixer.mix(model.parameters, [tracking, animation]);
    const targets = evaluator.evaluate(model, mixed);
    expect(armPoseAllowed(model.armRigs![0]!, targets.arms!.poses.L!)).toBe(true);
    expect(targets.arms!.poses.L!.shoulder + targets.arms!.poses.L!.elbow).toBeLessThanOrEqual(300 + 1e-9);
  });
});

describe('AT-08 独立確認: 手形の表示', () => {
  const visibleHands = (out: ReturnType<typeof render>, side: ArmSide) =>
    (['open', 'fist', 'point', 'peace'] as const).filter((s) => opacityOf(out, `${s}-${side}`) > 0);

  it('重み最大の登録済みの形を1つだけ出し、同点は パー→グー→指さし→ピース、全て0・非有限は休止形', () => {
    const model = buildModel({ restHand: 'point' });
    const ids = armParameterIds('L').shapes;
    const show = (w: Partial<Record<HandShape, number>>) =>
      visibleHands(render(model, Object.fromEntries(Object.entries(w).map(([k, v]) => [ids[k as HandShape], v]))), 'L');
    expect(show({ peace: 1 })).toEqual(['peace']);
    expect(show({ fist: 0.4, peace: 0.6 })).toEqual(['peace']);
    expect(show({ peace: 0.5, fist: 0.5 })).toEqual(['fist']);
    expect(show({ open: 0.5, peace: 0.5 })).toEqual(['open']);
    expect(show({})).toEqual(['point']);
    expect(show({ open: Number.NaN })).toEqual(['point']);
    expect(show({ open: 0, fist: 0 })).toEqual(['point']);
  });

  it('登録の無い形の重みは使わず休止形にする。休止形の絵が無いリグは不正としてその側を出さない', () => {
    const model = buildModel({ hands: ['open', 'fist'], restHand: 'fist' });
    const ids = armParameterIds('L').shapes;
    expect(visibleHands(render(model, { [ids.peace]: 1 }), 'L')).toEqual(['fist']);
    // AT-03：休止形の欠損はエラー。その側の腕全体を出さず、反対側は続く
    const broken = buildModel({ hands: ['open', 'fist'], restHand: 'peace' });
    const targets = evaluator.evaluate(broken, {});
    expect(targets.arms!.issues.some((i) => i.side === 'L' && i.severity === 'error')).toBe(true);
    const out = pipeline.deform(broken, targets);
    expect(opacityOf(out, 'up-L')).toBe(0);
    expect(visibleHands(out, 'L')).toEqual([]);
  });

  it('表示ゲートは既存の不透明度・非表示と掛け合わせ、保存した値を書き換えない', () => {
    const model = buildModel();
    model.parts.find((p) => p.id === 'fist-L')!.opacity = 0.5;
    model.parts.find((p) => p.id === 'peace-L')!.visible = false;
    const before = structuredClone(model);
    const ids = armParameterIds('L').shapes;
    expect(opacityOf(render(model, { [ids.fist]: 1 }), 'fist-L')).toBeCloseTo(0.5, 6);
    expect(opacityOf(render(model, { [ids.peace]: 1 }), 'peace-L')).toBe(0);
    expect(model).toEqual(before);
    expect(model.drawOrder).toEqual(before.drawOrder); // 描画順も変えない
  });
});

describe('AT-08 独立確認: 壊れた腕・旧ArmL/R・リグ無し', () => {
  it('片側の手の参照が切れたら、その側の腕を出さず（ゲート0）、反対側と顔は続く', () => {
    const model = buildModel();
    model.armRigs![0]!.hands.open!.partIds = ['missing-part'];
    const pose = POSES[2]!;
    const out = render(model, { ...params('L', pose), ...params('R', pose) });
    for (const id of ['up-L', 'lo-L', 'fist-L']) expect(opacityOf(out, id), id).toBe(0);
    expectConnected(model, out, 'R', pose, 'open');
    expect(opacityOf(out, 'face')).toBe(1);
  });

  it('旧ArmL の変形が腕の関節に掛かっていたら診断し、二重に回して出さない', () => {
    const model = buildModel();
    model.parameters.push({
      id: 'ArmL',
      name: '腕L',
      groupId: 'armL' as Model['parameters'][number]['groupId'],
      min: -30,
      max: 30,
      default: 0,
      standard: true,
    });
    model.bindings.push({
      id: 'legacy',
      target: { type: 'part', id: 'up-L' },
      channel: 'transform',
      parameterIds: ['ArmL'],
      keyValues: [[-30, 0, 30]],
      keys: [-30, 0, 30].map((v) => ({
        coords: [v],
        delta: { position: { x: 0, y: 0 }, rotation: v, scale: { x: 1, y: 1 }, opacity: 1 },
        source: 'manual' as const,
        locked: false,
      })),
      generation: 'linear',
      divisions: null,
    });
    const pose = POSES[1]!;
    const targets = evaluator.evaluate(model, { ...params('L', pose), ...params('R', pose), ArmL: 30 });
    expect(targets.arms!.issues.some((i) => i.side === 'L' && i.code === 'ownership')).toBe(true);
    const out = pipeline.deform(model, targets);
    // 出すなら関節どおり（旧ArmLの30°を足さない）。出さないならゲート0
    if (opacityOf(out, 'up-L') > 0) expectConnected(model, out, 'L', pose, 'open');
    expectConnected(model, out, 'R', pose, 'open');
  });

  it('腕の保存項目が無いモデルには腕の差分を作らない', () => {
    const model = createEmptyProject('リグ無し').model;
    expect(evaluator.evaluate(model, {}).arms).toBeUndefined();
  });
});
