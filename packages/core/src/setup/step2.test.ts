import reference from '@app/fixtures/reference-model/project.json';
import sample from '@app/fixtures/sample-model/project.json';
import {
  ensureStandardParameters,
  loadProjectJson,
  type Binding,
  type Mesh,
  type ParameterKey,
  type Project,
  type StandardPartType,
  type TransformDelta,
  type Vec2,
} from '@app/schema';
import { describe, expect, it } from 'vitest';
import { createDeformPipeline } from '../deform';
import { createBindingEvaluator } from '../eval';
import { createProjectStore } from '../store';
import { createAutoSetup, runAutoSetup } from './autoSetup';
import { STEP2_MOTION } from './step2';

// プロジェクトを開いたときにアプリ（step2Params）が足すのと同じく、STEP2 の標準パラメータを足す
const withStep2 = (p: Project): Project => ({ ...p, model: ensureStandardParameters(p.model, 'step2') });
const sampleModel = (): Project => loadProjectJson(JSON.stringify(sample));
// fixtures の reference-model（本物のメッシュがあり、胴体の子にボタンなど。MVP のかんたんセットアップ済み）
const referenceModel = (): Project => loadProjectJson(JSON.stringify(reference));

// 画像パーツに 3×3 の格子のメッシュを付ける（変形した位置を手で確かめやすい）
function withGridMeshes(start: Project): Project {
  const p = structuredClone(start);
  p.model.meshes = p.model.parts.map((q): Mesh => {
    const a = p.assets.find((x) => x.id === q.assetId)!;
    q.meshId = `mesh-${q.id}`;
    const uvs = [0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => ({ x, y })));
    return {
      id: q.meshId,
      vertices: uvs.map((v) => ({ x: a.offset.x + a.width * v.x, y: a.offset.y + a.height * v.y })),
      uvs,
      triangles: [
        [0, 1, 3],
        [1, 4, 3],
        [1, 2, 4],
        [2, 5, 4],
        [3, 4, 6],
        [4, 7, 6],
        [4, 5, 7],
        [5, 8, 7],
      ],
      density: 'custom',
      edited: false,
    };
  });
  return p;
}

const run = (p: Project) => createAutoSetup().plan(p).command.apply(p);
const part = (p: Project, type: StandardPartType) => p.model.parts.find((q) => q.standardType === type)!;
const asset = (p: Project, type: StandardPartType) => p.assets.find((a) => a.id === part(p, type).assetId)!;
const ZERO: TransformDelta = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: 1 };
const STEP2_IDS = ['Breath', 'ArmL', 'ArmR'];
const SWAY_IDS = ['HairFront', 'HairSide', 'HairBack'];

const binding = (p: Project, type: StandardPartType, parameterId: string): Binding | undefined =>
  p.model.bindings.find(
    (b) =>
      b.channel === 'transform' &&
      b.target.id === part(p, type).id &&
      b.parameterIds.length === 1 &&
      b.parameterIds[0] === parameterId,
  );
const keyAt = (b: Binding | undefined, coord: number) => b?.keys.find((k) => k.coords[0] === coord);
const deltaAt = (b: Binding | undefined, coord: number) => keyAt(b, coord)!.delta as TransformDelta;
const step2Bindings = (p: Project) =>
  p.model.bindings.filter((b) => b.parameterIds.some((id) => STEP2_IDS.includes(id)));
function replaceBinding(p: Project, b: Binding): Project {
  return { ...p, model: { ...p.model, bindings: p.model.bindings.map((q) => (q.id === b.id ? b : q)) } };
}

// パラメータの値（指定の無いものはデフォルト値）で変形した、パーツの頂点
function deformAt(p: Project, values: Record<string, number> = {}) {
  const params: Record<string, number> = {};
  for (const q of p.model.parameters) params[q.id] = q.default;
  Object.assign(params, values);
  const deformed = createDeformPipeline().deform(p.model, createBindingEvaluator().evaluate(p.model, params));
  return (partId: string): Vec2[] => {
    const positions = deformed.byPartId[partId]!.positions;
    const out: Vec2[] = [];
    for (let i = 0; i < positions.length; i += 2) out.push({ x: positions[i]!, y: positions[i + 1]! });
    return out;
  };
}
const center = (points: Vec2[]): Vec2 => ({
  x: points.reduce((s, q) => s + q.x, 0) / points.length,
  y: points.reduce((s, q) => s + q.y, 0) / points.length,
});

describe('呼吸・腕のキー（fixtures の sample-model）', () => {
  it('キーの向きと値が表のとおり（source auto・未ロック・linear）', () => {
    const p = run(withStep2(sampleModel()));
    // 胴体 200〜800 × 840〜1500（高さ 660）。ピボットはカード11の規則のまま中心
    const torso = asset(p, 'torso');
    expect(torso.height).toBe(660);
    expect(part(p, 'torso').pivot).toEqual({ x: 500, y: 1170 });
    expect(STEP2_MOTION).toEqual({ breathTorso: 1.015, breathNeckRise: 0.006, armRaise: 30 });

    // 呼吸 1: 胴体の縦 1.015 倍。下端中央を中心にするため、伸びた分（330 × 0.015）だけ上へ戻す
    const breath = binding(p, 'torso', 'Breath');
    expect(breath?.keyValues).toEqual([[0, 1]]);
    expect(deltaAt(breath, 0)).toEqual(ZERO);
    expect(deltaAt(breath, 1)).toEqual({
      ...ZERO,
      position: { x: 0, y: expect.closeTo(-330 * 0.015, 9) },
      scale: { x: 1, y: 1.015 },
    });
    // 呼吸 1: 首から上（neckRoot）が胴体の高さ 660 × 0.006 上がる
    const neck = binding(p, 'neckRoot', 'Breath');
    expect(neck?.keyValues).toEqual([[0, 1]]);
    expect(deltaAt(neck, 0)).toEqual(ZERO);
    expect(deltaAt(neck, 1)).toEqual({ ...ZERO, position: { x: 0, y: expect.closeTo(-3.96, 9) } });

    // 腕: L は値 1 で −30 度、R は +30 度（腕を上げる向き）。−1 で逆
    const armL = binding(p, 'armRootL', 'ArmL');
    const armR = binding(p, 'armRootR', 'ArmR');
    expect(armL?.keyValues).toEqual([[-1, 0, 1]]);
    expect(armR?.keyValues).toEqual([[-1, 0, 1]]);
    expect([-1, 0, 1].map((c) => deltaAt(armL, c))).toEqual([
      { ...ZERO, rotation: 30 },
      ZERO,
      { ...ZERO, rotation: -30 },
    ]);
    expect([-1, 0, 1].map((c) => deltaAt(armR, c))).toEqual([
      { ...ZERO, rotation: -30 },
      ZERO,
      { ...ZERO, rotation: 30 },
    ]);
    // 腕の変形グループのピボットは腕の上端中央（肩）
    expect(part(p, 'armRootL').pivot).toEqual({ x: 782.5, y: 890 });

    // 作るのはこの4つだけ。ほかのパーツ（腕の画像・首の画像・bodyRoot）には付けない
    const made = step2Bindings(p);
    expect(made).toHaveLength(4);
    for (const b of made) {
      expect(b.channel).toBe('transform');
      expect(b.target.type).toBe('part');
      expect(b.generation).toBe('linear');
      expect(b.keys.every((k) => k.source === 'auto' && !k.locked)).toBe(true);
    }
    expect(binding(p, 'armL', 'ArmL')).toBeUndefined();
    expect(binding(p, 'neck', 'Breath')).toBeUndefined();
    expect(binding(p, 'bodyRoot', 'Breath')).toBeUndefined();
    // 揺れものの標準パラメータは、物理の設定で使われるまでバインディングを作らない
    expect(p.model.parameters.map((q) => q.id)).toEqual(expect.arrayContaining(SWAY_IDS));
    expect(p.model.bindings.some((b) => b.parameterIds.some((id) => SWAY_IDS.includes(id)))).toBe(false);
  });

  it('変形した見た目の向き: 呼吸で胴体は下端を残して上へ伸び、首から上が上がる。腕は肩を中心に外へ上がる', () => {
    const p = run(withGridMeshes(withStep2(sampleModel())));
    const base = deformAt(p);
    // 呼吸 1: 胴体の頂点は y が下端 1500 からの距離 × 0.015 だけ上へ（上端 840 → 830.1、下端は動かない）。x は動かない
    const breathed = deformAt(p, { Breath: 1 });
    breathed('part-torso').forEach((v, i) => {
      const b = base('part-torso')[i]!;
      expect(v.x).toBeCloseTo(b.x, 3);
      expect(v.y).toBeCloseTo(b.y + 0.015 * (b.y - 1500), 3);
    });
    expect(Math.min(...breathed('part-torso').map((v) => v.y))).toBeCloseTo(830.1, 3);
    expect(Math.max(...breathed('part-torso').map((v) => v.y))).toBeCloseTo(1500, 3);
    // 首・顔・前髪は 3.96 上がる。腕は動かない
    for (const id of ['part-neck', 'part-face', 'part-frontHair']) {
      expect(center(breathed(id)).y - center(base(id)).y).toBeCloseTo(-3.96, 3);
      expect(center(breathed(id)).x).toBeCloseTo(center(base(id)).x, 3);
    }
    expect(breathed('part-armL')).toEqual(base('part-armL'));
    // 呼吸 0.5 は半分
    expect(Math.min(...deformAt(p, { Breath: 0.5 })('part-torso').map((v) => v.y))).toBeCloseTo(840 - 4.95, 3);

    // 腕 L 1: 腕 L（画面の右）の先（下端中央 782.5, 1370）が肩（782.5, 890）を中心に反時計回りに 30 度 → 右上へ
    const sin = Math.sin(Math.PI / 6);
    const cos = Math.cos(Math.PI / 6);
    const raisedL = deformAt(p, { ArmL: 1 })('part-armL');
    expect(raisedL[1]!.x).toBeCloseTo(782.5, 3); // 肩は動かない
    expect(raisedL[1]!.y).toBeCloseTo(890, 3);
    expect(raisedL[7]!.x).toBeCloseTo(782.5 + 480 * sin, 3);
    expect(raisedL[7]!.y).toBeCloseTo(890 + 480 * cos, 3);
    // 腕 R 1: 腕 R（画面の左）の先は左上へ
    const raisedR = deformAt(p, { ArmR: 1 })('part-armR');
    expect(raisedR[7]!.x).toBeCloseTo(217.5 - 480 * sin, 3);
    expect(raisedR[7]!.y).toBeCloseTo(890 + 480 * cos, 3);
    // −1 は逆（腕 L の先は左へ）。反対の腕と胴体は動かない
    const lowered = deformAt(p, { ArmL: -1 });
    expect(lowered('part-armL')[7]!.x).toBeCloseTo(782.5 - 480 * sin, 3);
    expect(lowered('part-armR')).toEqual(base('part-armR'));
    expect(lowered('part-torso')).toEqual(base('part-torso'));
  });

  it('reference-model（本物のメッシュ）でも表のとおりで、胴体の子（ボタンなど）も胴体と一緒に伸びる', () => {
    const ref = withStep2(referenceModel());
    const p = run(ref);
    // 胴体 1680〜3000（高さ 1320）
    expect(deltaAt(binding(p, 'torso', 'Breath'), 1)).toEqual({
      ...ZERO,
      position: { x: 0, y: expect.closeTo(-660 * 0.015, 9) },
      scale: { x: 1, y: 1.015 },
    });
    expect(deltaAt(binding(p, 'neckRoot', 'Breath'), 1).position.y).toBeCloseTo(-1320 * 0.006, 9);
    expect(deltaAt(binding(p, 'armRootL', 'ArmL'), 1)).toEqual({ ...ZERO, rotation: -30 });
    expect(deltaAt(binding(p, 'armRootR', 'ArmR'), 1)).toEqual({ ...ZERO, rotation: 30 });
    // MVP のバインディングは変わらず、新しいものは後ろに足される
    expect(p.model.bindings.slice(0, ref.model.bindings.length)).toEqual(ref.model.bindings);
    expect(step2Bindings(p)).toHaveLength(4);

    const base = deformAt(p);
    const breathed = deformAt(p, { Breath: 1 });
    for (const id of ['part-torso', 'part-button1', 'part-collarL']) {
      breathed(id).forEach((v, i) => {
        const b = base(id)[i]!;
        expect(v.x).toBeCloseTo(b.x, 3);
        expect(v.y).toBeCloseTo(b.y + 0.015 * (b.y - 3000), 3);
      });
    }
    expect(center(breathed('part-face')).y - center(base('part-face')).y).toBeCloseTo(-7.92, 3);
    // 腕の子（袖口）も腕と一緒に回る
    const cuff = center(deformAt(p, { ArmL: 1 })('part-cuffL'));
    expect(cuff.x).toBeGreaterThan(center(base('part-cuffL')).x + 100);
    expect(run(p)).toBe(p);
  });
});

describe('作らないとき', () => {
  it('STEP2 の標準パラメータが無ければ呼吸・腕の動きを作らず、ほかの結果は同じ', () => {
    // 変形グループとワープの id が同じになるよう、どちらも id1 から順に使う
    const counter = () => {
      let n = 0;
      return () => `id${++n}`;
    };
    const without = runAutoSetup(sampleModel(), counter());
    const withParams = runAutoSetup(withStep2(sampleModel()), counter());
    expect(without.model.parameters.some((q) => q.id === 'Breath')).toBe(false);
    expect(step2Bindings(without)).toEqual([]);
    expect(step2Bindings(withParams)).toHaveLength(4);
    // id を除けば、STEP2 の4つのほかは同じバインディングが同じ順に並ぶ
    const strip = (b: Binding) => ({ ...b, id: '' });
    expect(withParams.model.bindings.filter((b) => !step2Bindings(withParams).includes(b)).map(strip)).toEqual(
      without.model.bindings.map(strip),
    );
    // パラメータは足さない（すでにあるもののまま）
    expect(withParams.model.parameters).toEqual(withStep2(sampleModel()).model.parameters);
  });

  it('胴体が無ければ呼吸を、腕 L が無ければ腕 L を作らない（ほかはそのまま）', () => {
    const p = withStep2(sampleModel());
    const drop = (q: Project, type: StandardPartType): Project => {
      const parts = q.model.parts.filter((x) => x.standardType !== type);
      const ids = new Set(parts.map((x) => x.id));
      return { ...q, model: { ...q.model, parts, drawOrder: q.model.drawOrder.filter((id) => ids.has(id)) } };
    };
    const noTorso = run(drop(p, 'torso'));
    expect(noTorso.model.bindings.some((b) => b.parameterIds[0] === 'Breath')).toBe(false);
    expect(binding(noTorso, 'armRootL', 'ArmL')).toBeDefined();
    const noArmL = run(drop(p, 'armL'));
    expect(noArmL.model.parts.some((q) => q.standardType === 'armRootL')).toBe(false);
    expect(noArmL.model.bindings.some((b) => b.parameterIds[0] === 'ArmL')).toBe(false);
    expect(binding(noArmL, 'armRootR', 'ArmR')).toBeDefined();
    expect(binding(noArmL, 'torso', 'Breath')).toBeDefined();
  });

  it('物理の設定で作った揺れもののバインディングは、再実行で変えず消さない', () => {
    const first = run(withStep2(sampleModel()));
    const sway: Binding = {
      id: 'sway-front',
      target: { type: 'part', id: part(first, 'frontHair').id },
      channel: 'transform',
      parameterIds: ['HairFront'],
      keyValues: [[-1, 0, 1]],
      keys: [-1, 0, 1].map((c) => ({
        coords: [c],
        delta: { ...ZERO, rotation: c * 5 },
        source: 'auto',
        locked: false,
      })),
      generation: 'linear',
      divisions: null,
    };
    const withSway = { ...first, model: { ...first.model, bindings: [...first.model.bindings, sway] } };
    const out = run(withSway);
    expect(out).toBe(withSway);
    expect(out.model.bindings).toContain(sway);
  });
});

describe('再実行', () => {
  it('manual と locked のキーは残り、ほかの自動のキーは作り直す（id も同じ。Undo は1回）', () => {
    const first = run(withStep2(sampleModel()));
    const marks: ParameterKey[] = [];
    const mark = (p: Project, b: Binding | undefined, coord: number, how: 'manual' | 'locked'): Project => {
      const keys = b!.keys.map((k) => {
        if (k.coords[0] !== coord) return k;
        const delta = { ...(k.delta as TransformDelta), position: { x: 7, y: -7 } };
        const next: ParameterKey = how === 'manual' ? { ...k, delta, source: 'manual' } : { ...k, delta, locked: true };
        marks.push(next);
        return next;
      });
      return replaceBinding(p, { ...b!, keys });
    };
    let edited = mark(first, binding(first, 'torso', 'Breath'), 1, 'manual');
    edited = mark(edited, binding(edited, 'neckRoot', 'Breath'), 1, 'locked');
    edited = mark(edited, binding(edited, 'armRootL', 'ArmL'), -1, 'manual');
    edited = mark(edited, binding(edited, 'armRootR', 'ArmR'), 1, 'locked');
    // 自動のキーを壊し、胴体の高さも変える（自動のキーは新しい高さで作り直され、残すキーはそのまま）
    const armL = binding(edited, 'armRootL', 'ArmL')!;
    edited = replaceBinding(edited, {
      ...armL,
      keys: armL.keys.map((k) => (k.coords[0] === 1 ? { ...k, delta: { ...ZERO, rotation: 99 } } : k)),
    });
    const torsoAsset = asset(edited, 'torso');
    edited = { ...edited, assets: edited.assets.map((a) => (a === torsoAsset ? { ...a, height: 700 } : a)) };

    const store = createProjectStore(edited);
    store.dispatch(createAutoSetup().plan(edited).command);
    const out = store.get();
    for (const key of marks) expect(out.model.bindings.some((b) => b.keys.includes(key))).toBe(true);
    expect(out.model.bindings.map((b) => b.id)).toEqual(first.model.bindings.map((b) => b.id));
    expect(deltaAt(binding(out, 'armRootL', 'ArmL'), 1)).toEqual({ ...ZERO, rotation: -30 });
    expect(deltaAt(binding(out, 'armRootR', 'ArmR'), -1)).toEqual({ ...ZERO, rotation: -30 });
    expect(binding(out, 'torso', 'Breath')!.keys.map((k) => k.source)).toEqual(['auto', 'manual']);
    expect(binding(out, 'neckRoot', 'Breath')!.keys.map((k) => k.locked)).toEqual([false, true]);
    expect(run(out)).toBe(out);
    store.undo();
    expect(store.get()).toBe(edited);
    expect(store.canUndo()).toBe(false);
  });

  it('手で直したキーの無い呼吸・腕のバインディングは、対象が無くなれば消える。直したキーがあれば残す', () => {
    const first = run(withStep2(sampleModel()));
    const noTorso = (q: Project): Project => {
      const parts = q.model.parts.filter((x) => x.standardType !== 'torso');
      const ids = new Set(parts.map((x) => x.id));
      return {
        ...q,
        model: {
          ...q.model,
          parts,
          drawOrder: q.model.drawOrder.filter((id) => ids.has(id)),
          bindings: q.model.bindings.filter((b) => b.target.type !== 'part' || ids.has(b.target.id)),
        },
      };
    };
    const out = run(noTorso(first));
    expect(binding(out, 'neckRoot', 'Breath')).toBeUndefined();
    // neckRoot の呼吸のキーを手で直していれば残す
    const neck = binding(first, 'neckRoot', 'Breath')!;
    const kept = replaceBinding(first, { ...neck, keys: [neck.keys[0]!, { ...neck.keys[1]!, source: 'manual' }] });
    expect(binding(run(noTorso(kept)), 'neckRoot', 'Breath')?.keys).toEqual(binding(kept, 'neckRoot', 'Breath')!.keys);
  });
});
