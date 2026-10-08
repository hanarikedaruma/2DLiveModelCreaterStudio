import {
  CHEST_PARAMETERS,
  PARAMETER_GROUPS,
  type Binding,
  type Mesh,
  type Part,
  type Physics,
  type Project,
  type Vec2,
} from '@app/schema';
import type { ParamValues, TargetDeltas } from '@app/contracts';
import { createBindingEvaluator } from '../eval/evaluator';
import { createDeformPipeline } from '../deform/pipeline';
import { pointsToModelSpace } from '../deform/space';
import { curveMeshSignature } from '../deform/curveGuide';

export const CHEST_PRESET = { spring: 120, damping: 5, gravity: 0, inertia: 1.5, range: 1 };
export const CHEST_PINNING = { topBand: 0.15, bottomBand: 0.2, freeWidth: 0.6 };
const smooth = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};
const distance = (p: Vec2, a: Vec2, b: Vec2) => {
  const x = b.x - a.x,
    y = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * x + (p.y - a.y) * y) / (x * x + y * y || 1)));
  return Math.hypot(p.x - a.x - t * x, p.y - a.y - t * y);
};
const cross = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

// 島ごとの境界を実際の三角形から求める。穴は自由な下端として扱わない。
export function bounceWeights(mesh: Mesh, pinning = CHEST_PINNING): number[] {
  const parent = mesh.vertices.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i]!;
    return i;
  };
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (const t of mesh.triangles)
    for (let k = 0; k < 3; k++) {
      const a = t[k]!,
        b = t[(k + 1) % 3]!;
      if (!mesh.vertices[a] || !mesh.vertices[b]) throw new Error('メッシュの三角形が正しくありません。');
      parent[root(a)] = root(b);
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      const known = edges.get(key);
      if (known) known.count++;
      else edges.set(key, { a, b, count: 1 });
    }
  const components = new Map<number, number[]>();
  mesh.vertices.forEach((_, i) => {
    const r = root(i);
    const list = components.get(r) ?? [];
    list.push(i);
    components.set(r, list);
  });
  const weights = mesh.vertices.map(() => 0);
  for (const indices of components.values()) {
    const members = new Set(indices);
    const boundary = [...edges.values()].filter((e) => e.count === 1 && members.has(e.a));
    const adjacency = new Map<number, number[]>();
    for (const e of boundary)
      for (const [a, b] of [
        [e.a, e.b],
        [e.b, e.a],
      ]) {
        const list = adjacency.get(a!) ?? [];
        list.push(b!);
        adjacency.set(a!, list);
      }
    if ([...adjacency.values()].some((a) => a.length !== 2))
      throw new Error('胸の輪郭が分岐しています。メッシュを作り直してください。');
    const unseen = new Set(adjacency.keys()),
      loops: number[][] = [];
    while (unseen.size) {
      const start = unseen.values().next().value!;
      const loop: number[] = [];
      let cur = start,
        prev = -1;
      do {
        if (!unseen.delete(cur)) throw new Error('胸の輪郭が正しくありません。');
        loop.push(cur);
        const next = adjacency.get(cur)!.find((v) => v !== prev)!;
        prev = cur;
        cur = next;
      } while (cur !== start);
      loops.push(loop);
    }
    if (!loops.length) continue;
    const area = (l: number[]) =>
      Math.abs(
        l.reduce((a, v, i) => {
          const p = mesh.vertices[v]!,
            q = mesh.vertices[l[(i + 1) % l.length]!]!;
          return a + p.x * q.y - p.y * q.x;
        }, 0),
      );
    loops.sort((a, b) => area(b) - area(a));
    const holes = new Set(loops.slice(1).flat());
    const vs = indices.map((i) => mesh.vertices[i]!);
    const minX = Math.min(...vs.map((p) => p.x)),
      maxX = Math.max(...vs.map((p) => p.x));
    const minY = Math.min(...vs.map((p) => p.y)),
      maxY = Math.max(...vs.map((p) => p.y));
    const width = maxX - minX,
      height = maxY - minY;
    if (!(width > 0 && height > 0)) continue;
    const fixed = new Set(
      indices.filter((i) => {
        const p = mesh.vertices[i]!;
        const free =
          p.y >= maxY - height * pinning.bottomBand &&
          Math.abs(p.x - (minX + maxX) / 2) <= (width * pinning.freeWidth) / 2;
        return p.y <= minY + height * pinning.topBand || holes.has(i) || (adjacency.has(i) && !free);
      }),
    );
    const fixedEdges = boundary.filter((e) => fixed.has(e.a) && fixed.has(e.b));
    let peak = 0;
    for (const i of indices) {
      if (fixed.has(i)) continue;
      const p = mesh.vertices[i]!;
      const d = Math.min(
        ...[...fixed].map((j) => Math.hypot(p.x - mesh.vertices[j]!.x, p.y - mesh.vertices[j]!.y)),
        ...fixedEdges.map((e) => distance(p, mesh.vertices[e.a]!, mesh.vertices[e.b]!)),
      );
      weights[i] =
        smooth(d / (Math.min(width, height) * 0.2)) *
        smooth((p.y - minY - height * pinning.topBand) / (height * (1 - pinning.topBand) || 1));
      peak = Math.max(peak, weights[i]!);
    }
    if (peak > 0) for (const i of indices) weights[i]! /= peak;
  }
  return weights;
}

// 同じ重みを使う2方向の場。現姿勢の三角形を10%以上残す最大の倍率。
export function safeBounceScale(mesh: Mesh, positions: Float32Array, weights: number[], q: Vec2): number {
  let scale = 1;
  const p = (i: number): Vec2 => ({ x: positions[i * 2]!, y: positions[i * 2 + 1]! });
  for (const [a, b, c] of mesh.triangles) {
    const base = cross(p(a), p(b), p(c));
    if (!Number.isFinite(base) || Math.abs(base) < 1e-7) return 0;
    const moved = (i: number) => ({ x: p(i).x + weights[i]! * q.x, y: p(i).y + weights[i]! * q.y });
    const change = (cross(moved(a), moved(b), moved(c)) - base) * Math.sign(base);
    if (change < 0) scale = Math.min(scale, (Math.abs(base) * 0.9) / -change);
  }
  return Math.max(0, Math.min(1, scale));
}

export function bounceBinding(
  id: string,
  meshId: string,
  parameterId: string,
  weights: number[],
  amplitude: number,
  axis: 'x' | 'y',
): Binding {
  return {
    id,
    target: { type: 'mesh', id: meshId },
    channel: 'vertices',
    vertexSpace: 'model',
    parameterIds: [parameterId],
    keyValues: [[-1, 0, 1]],
    keys: [-1, 0, 1].map((v) => ({
      coords: [v],
      delta: weights.map((w) => ({ x: axis === 'x' ? w * amplitude * v : 0, y: axis === 'y' ? w * amplitude * v : 0 })),
      source: 'auto',
      locked: false,
    })),
    generation: 'linear',
    divisions: null,
  };
}

export interface BounceFrame {
  center: Vec2;
  basis: [Vec2, Vec2];
  positions: Float32Array;
  mesh: Mesh;
}
// 基準点を含む三角形で、頂点キーの場の勾配を求める。細い三角形を避けて数値誤差を抑える。
function vertexGradients(mesh: Mesh, index: number, field?: Float32Array): [Vec2, Vec2] | null {
  if (!field)
    return [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
  if (field.length !== mesh.vertices.length * 2) return null;
  const triangles = mesh.triangles.filter((t) => t.includes(index));
  triangles.sort(
    (a, b) =>
      Math.abs(cross(...(b.map((i) => mesh.vertices[i]!) as [Vec2, Vec2, Vec2]))) -
      Math.abs(cross(...(a.map((i) => mesh.vertices[i]!) as [Vec2, Vec2, Vec2]))),
  );
  const t = triangles[0];
  if (!t) return null;
  const [a, b, c] = t,
    u = { x: mesh.vertices[b]!.x - mesh.vertices[a]!.x, y: mesh.vertices[b]!.y - mesh.vertices[a]!.y },
    v = { x: mesh.vertices[c]!.x - mesh.vertices[a]!.x, y: mesh.vertices[c]!.y - mesh.vertices[a]!.y };
  const det = u.x * v.y - u.y * v.x;
  if (Math.abs(det) < 1e-8) return null;
  const du = { x: field[b * 2]! - field[a * 2]!, y: field[b * 2 + 1]! - field[a * 2 + 1]! },
    dv = { x: field[c * 2]! - field[a * 2]!, y: field[c * 2 + 1]! - field[a * 2 + 1]! };
  return [
    { x: (du.x * v.y - dv.x * u.y) / det, y: (du.y * v.y - dv.y * u.y) / det },
    { x: (dv.x * u.x - du.x * v.x) / det, y: (dv.y * u.x - du.y * v.x) / det },
  ];
}
export function chestDeformBindingIds(
  project: Project,
  items = project.physics.filter((p) => p.deform === 'bounce'),
): Set<string> {
  const ids = new Set(items.flatMap((p) => p.bounce?.bindingIds ?? []));
  for (const item of items)
    for (const binding of project.model.bindings) {
      if (
        binding.vertexSpace === 'model' &&
        binding.target.id === item.bounce?.meshId &&
        binding.parameterIds.some((id) => id === item.outputParameterId || id === item.verticalOutputParameterId)
      )
        ids.add(binding.id);
    }
  return ids;
}

// 手編集した場も含め、実際に評価する左右・上下の合成で反転を防ぐ。
// 二分探索の下側は常に検査済みなので、キーが非線形に合成されても返す形を保証できる。
export function limitChestOutput(
  project: Project,
  item: Physics,
  frame: BounceFrame,
  params: ParamValues,
  q: Vec2,
): Vec2 {
  const b = item.bounce!,
    ids = chestDeformBindingIds(project, [item]);
  const model = { ...project.model, bindings: project.model.bindings.filter((binding) => ids.has(binding.id)) };
  const evaluator = createBindingEvaluator();
  const safe = (scale: number) => {
    const values = {
      ...params,
      [item.outputParameterId]: (q.x / b.amplitudes.x) * scale,
      [item.verticalOutputParameterId!]: (q.y / b.amplitudes.y) * scale,
    };
    const delta = evaluator.evaluate(model, values).modelVertices?.[frame.mesh.id];
    if (!delta) return true;
    const at = (i: number, moved: boolean): Vec2 => ({
      x: frame.positions[i * 2]! + (moved ? delta[i * 2]! : 0),
      y: frame.positions[i * 2 + 1]! + (moved ? delta[i * 2 + 1]! : 0),
    });
    return frame.mesh.triangles.every(([a, c, d]) => {
      const base = cross(at(a, false), at(c, false), at(d, false)),
        next = cross(at(a, true), at(c, true), at(d, true));
      return Number.isFinite(next) && Math.abs(base) > 1e-7 && next * Math.sign(base) >= Math.abs(base) * 0.1 - 1e-5;
    });
  };
  if (safe(1)) return q;
  if (!safe(0)) return { x: 0, y: 0 };
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (safe(mid)) lo = mid;
    else hi = mid;
  }
  return { x: q.x * lo, y: q.y * lo };
}
export function bounceFrame(project: Project, item: Physics, deltas: TargetDeltas): BounceFrame | null {
  const b = item.bounce,
    part = project.model.parts.find((p) => p.id === item.partId);
  const mesh = project.model.meshes.find((m) => m.id === part?.meshId);
  if (
    !b ||
    !part ||
    !mesh ||
    mesh.id !== b.meshId ||
    curveMeshSignature(mesh) !== b.meshSignature ||
    mesh.vertices.length !== b.weights.length
  )
    return null;
  let centerIndex = 0,
    closest = Infinity;
  mesh.vertices.forEach((p, i) => {
    const d = Math.hypot(p.x - b.referenceCenter.x, p.y - b.referenceCenter.y);
    if (d < closest) {
      closest = d;
      centerIndex = i;
    }
  });
  const local = mesh.vertices[centerIndex]!;
  const own = deltas.vertices[mesh.id];
  const global = deltas.modelVertices?.[mesh.id];
  const localGradient = vertexGradients(mesh, centerIndex, own),
    modelGradient = vertexGradients(mesh, centerIndex, global);
  if (!localGradient || !modelGradient) return null;
  const p = { x: local.x + (own?.[centerIndex * 2] ?? 0), y: local.y + (own?.[centerIndex * 2 + 1] ?? 0) };
  const h = 0.01;
  const [center, dx, dy] = pointsToModelSpace(project.model, deltas, part.id, [
    p,
    { x: p.x + h * (1 + localGradient[0].x), y: p.y + h * localGradient[0].y },
    { x: p.x + h * localGradient[1].x, y: p.y + h * (1 + localGradient[1].y) },
  ]);
  const basis: [Vec2, Vec2] = [
    { x: (dx!.x - center!.x) / h + modelGradient[0].x, y: (dx!.y - center!.y) / h + modelGradient[0].y },
    { x: (dy!.x - center!.x) / h + modelGradient[1].x, y: (dy!.y - center!.y) / h + modelGradient[1].y },
  ];
  if (
    ![center!.x, center!.y, ...basis.flatMap((v) => [v.x, v.y])].every(Number.isFinite) ||
    Math.abs(basis[0].x * basis[1].y - basis[0].y * basis[1].x) < 1e-8
  )
    return null;
  const points = pointsToModelSpace(
    project.model,
    deltas,
    part.id,
    mesh.vertices.map((v, i) => ({ x: v.x + (own?.[i * 2] ?? 0), y: v.y + (own?.[i * 2 + 1] ?? 0) })),
  );
  const positions = Float32Array.from(
    points.flatMap((v, i) => [v.x + (global?.[i * 2] ?? 0), v.y + (global?.[i * 2 + 1] ?? 0)]),
  );
  return {
    center: { x: center!.x + (global?.[centerIndex * 2] ?? 0), y: center!.y + (global?.[centerIndex * 2 + 1] ?? 0) },
    basis,
    mesh,
    positions,
  };
}

export function bounceReason(project: Project, item: Physics): string | undefined {
  const b = item.bounce,
    part = project.model.parts.find((p) => p.id === item.partId),
    mesh = project.model.meshes.find((m) => m.id === part?.meshId);
  if (!b || !part || !mesh || mesh.id !== b.meshId) return '胸の対象メッシュがありません。';
  if (curveMeshSignature(mesh) !== b.meshSignature || b.weights.length !== mesh.vertices.length)
    return 'メッシュが変わりました。胸のキーを作り直してください。';
  if (!b.weights.some((w) => w > 0)) return '揺れる頂点がありません。メッシュをなめらかにしてください。';
  const outputs = [item.outputParameterId, item.verticalOutputParameterId];
  if (outputs.some((id) => !id || !project.model.parameters.some((p) => p.id === id)))
    return '胸の出力先がありません。キーを作り直してください。';
  if (
    project.physics.some(
      (other) =>
        other.id !== item.id &&
        [other.outputParameterId, other.verticalOutputParameterId].some((id) => id && outputs.includes(id)),
    )
  )
    return '胸の出力が他の揺れと共有されています。';
  for (let axis = 0; axis < 2; axis++) {
    const binding = project.model.bindings.find((v) => v.id === b.bindingIds[axis]);
    if (
      !binding ||
      binding.target.id !== mesh.id ||
      binding.vertexSpace !== 'model' ||
      binding.channel !== 'vertices' ||
      binding.parameterIds.length !== 1 ||
      binding.parameterIds[0] !== outputs[axis]
    )
      return '胸のキーか出力の対応がありません。キーを作り直してください。';
    for (const key of binding.keys) {
      if (!Array.isArray(key.delta) || key.delta.length !== b.weights.length) return '胸のキーの頂点数が一致しません。';
      if (key.delta.some((v, i) => b.weights[i] === 0 && (v.x !== 0 || v.y !== 0)))
        return '胸の固定点のキーが変更されています。';
    }
  }
  for (const binding of project.model.bindings.filter(
    (v) => v.vertexSpace === 'model' && v.target.id === mesh.id && v.parameterIds.some((id) => outputs.includes(id)),
  )) {
    if (
      binding.keys.some(
        (key) =>
          !Array.isArray(key.delta) ||
          key.delta.length !== b.weights.length ||
          key.delta.some((v, i) => b.weights[i] === 0 && (v.x !== 0 || v.y !== 0)),
      )
    )
      return '胸の固定点のキーが変更されています。';
  }
  const ancestors = new Set<string>();
  for (
    let id: string | null = part.id;
    id && !ancestors.has(id);
    id = project.model.parts.find((p) => p.id === id)?.parentId ?? null
  )
    ancestors.add(id);
  const allOutputs = new Set(
    project.physics
      .filter((p) => p.deform === 'bounce')
      .flatMap((p) => [p.outputParameterId, p.verticalOutputParameterId ?? '']),
  );
  if (item.inputs.some((i) => allOutputs.has(i.parameterId))) return '胸の出力を胸の入力には指定できません。';
  if (
    project.model.bindings.some(
      (v) =>
        v.parameterIds.some((id) => outputs.includes(id)) &&
        ((v.target.type === 'part' && ancestors.has(v.target.id)) ||
          (v.target.type === 'warp' &&
            project.model.warps.some((w) => w.id === v.target.id && ancestors.has(w.partId)))),
    )
  )
    return '胸の出力が体の姿勢へ戻る循環があります。';
  const torso = project.model.parts.find((p) => ancestors.has(p.id) && p.standardType === 'torso');
  if (torso?.meshId && project.model.bindings.some((v) => v.channel === 'vertices' && v.target.id === torso.meshId))
    return '胴体の頂点キーへの取付けは未対応です。';
  const owned = chestDeformBindingIds(project);
  const defaults = Object.fromEntries(project.model.parameters.map((p) => [p.id, p.default]));
  const reference = bounceFrame(
    project,
    item,
    createBindingEvaluator().evaluate(
      { ...project.model, bindings: project.model.bindings.filter((binding) => !owned.has(binding.id)) },
      defaults,
    ),
  );
  if (
    !reference ||
    reference.basis.some((v, i) =>
      (['x', 'y'] as const).some(
        (axis) =>
          Math.abs(v[axis] - b.referenceBasis[i]![axis]) >
          1e-5 * Math.max(1, Math.abs(v[axis]), Math.abs(b.referenceBasis[i]![axis])),
      ),
    )
  )
    return '胸の基準姿勢が変わりました。胸のキーを作り直してください。';
  return undefined;
}

export function chestSetupReason(project: Project, part: Part): string | undefined {
  if (part.kind !== 'image' || !part.meshId || !project.model.meshes.some((m) => m.id === part.meshId))
    return '胸の画像パーツにメッシュを作成してください。';
  const old = project.physics.find((p) => p.partId === part.id);
  const owned = old?.bounce?.bindingIds;
  if (
    old &&
    project.model.bindings.some(
      (b) =>
        (owned?.includes(b.id) ||
          (b.parameterIds.some((id) => id === old.outputParameterId || id === old.verticalOutputParameterId) &&
            ((b.target.type === 'part' && b.target.id === part.id) ||
              (b.target.type === 'mesh' && b.target.id === part.meshId)))) &&
        b.keys.some((k) => k.locked || (k.source !== 'auto' && k.source !== 'generated')),
    )
  )
    return '手で編集したキーやロックしたキーがあるため、方式を切り替えられません。';
  return undefined;
}

export interface ChestIds {
  physics: string;
  horizontal: string;
  vertical: string;
}
// 体への接続を含む純粋な設定。失敗はコマンドを部分適用する前に返す。
export function withChestPhysics(project: Project, partId: string, ids: ChestIds, pinning = CHEST_PINNING): Project {
  let part = project.model.parts.find((p) => p.id === partId);
  if (!part) throw new Error('パーツがありません。');
  const reason = chestSetupReason(project, part);
  if (reason) throw new Error(reason);
  const old = project.physics.find((p) => p.partId === partId);
  const mesh = project.model.meshes.find((m) => m.id === part!.meshId)!;
  const defaults = Object.fromEntries(project.model.parameters.map((p) => [p.id, p.default]));
  const evaluator = createBindingEvaluator(),
    pipeline = createDeformPipeline();
  const torsos = project.model.parts.filter((p) => p.kind === 'image' && p.standardType === 'torso' && p.id !== partId);
  if (torsos.length > 1 && !torsos.some((p) => p.id === part!.parentId))
    throw new Error('胸を接続先の胴体の子にしてください。');
  let model = project.model;
  if (torsos.length === 1 && part.parentId !== torsos[0]!.id) {
    const torso = torsos[0]!;
    const parent = project.model.parts.find((p) => p.id === part!.parentId);
    if (parent && parent.standardType !== 'bodyRoot')
      throw new Error('既存の親を保護しています。胸を接続先の胴体の子にしてください。');
    const before = pipeline.deform(model, evaluator.evaluate(model, defaults)).byPartId[partId]?.positions;
    const parts = model.parts.map((p) => (p.id === partId ? { ...p, parentId: torso.id } : p));
    const tentative = { ...model, parts };
    const after = pipeline.deform(tentative, evaluator.evaluate(tentative, defaults)).byPartId[partId]?.positions;
    if (!before || !after || before.some((v, i) => Math.abs(v - after[i]!) > 0.01))
      throw new Error('胴体の子にすると基準姿勢が変わります。先に接続位置を合わせてください。');
    model = tentative;
    part = parts.find((p) => p.id === partId)!;
  }
  if (!torsos.length && part.standardType === 'chest') throw new Error('接続先の胴体を割り当ててください。');
  const taken = new Set(
    project.physics.filter((p) => p !== old).flatMap((p) => [p.outputParameterId, p.verticalOutputParameterId ?? '']),
  );
  const outputs = CHEST_PARAMETERS.map((p, axis) => {
    const existing =
      old?.deform === 'bounce' ? (axis === 0 ? old.outputParameterId : old.verticalOutputParameterId) : null;
    if (existing) return existing;
    const parameter = model.parameters.find((v) => v.id === p.id);
    const referenced =
      model.bindings.some((v) => v.parameterIds.includes(p.id)) ||
      project.physics.some((v) => v !== old && v.inputs.some((i) => i.parameterId === p.id)) ||
      project.trackingMappings.some((v) => v.parameterId === p.id) ||
      project.expressions.some((v) => v.entries.some((e) => e.parameterId === p.id)) ||
      project.animations.some((v) => v.tracks.some((t) => t.parameterId === p.id)) ||
      project.studio.hotkeys.some((v) => v.action === 'parameter' && v.targetId === p.id) ||
      model.lipSync.vowels.some((v) => Object.hasOwn(v.values, p.id));
    if (part!.standardType === 'chest' && !taken.has(p.id) && (!parameter || parameter.standard) && !referenced)
      return p.id;
    const base = `Bust${axis === 0 ? 'X' : 'Y'}_${partId}`;
    let id = base,
      n = 2;
    while (model.parameters.some((p) => p.id === id) || taken.has(id)) id = `${base}_${n++}`;
    return id;
  });
  const removeIds = new Set(old?.bounce?.bindingIds ?? []);
  const bindings = model.bindings.filter(
    (b) =>
      !removeIds.has(b.id) &&
      !(
        old?.deform !== 'bounce' &&
        old &&
        b.parameterIds.includes(old.outputParameterId) &&
        ((b.target.type === 'part' && b.target.id === partId) ||
          (b.target.type === 'mesh' && b.target.id === mesh.id)) &&
        b.keys.every((k) => !k.locked && (k.source === 'auto' || k.source === 'generated'))
      ),
  );
  model = {
    ...model,
    bindings,
    parameters: [
      ...model.parameters,
      ...outputs.flatMap((id, axis) =>
        model.parameters.some((p) => p.id === id)
          ? []
          : [
              {
                ...CHEST_PARAMETERS[axis]!,
                id,
                name:
                  id === CHEST_PARAMETERS[axis]!.id
                    ? CHEST_PARAMETERS[axis]!.name
                    : `胸 ${part!.name} ${axis === 0 ? '左右' : '上下'}`,
                standard: id === CHEST_PARAMETERS[axis]!.id,
              },
            ],
      ),
    ],
    parameterGroups: model.parameterGroups.some((g) => g.id === 'sway')
      ? model.parameterGroups
      : [...model.parameterGroups, PARAMETER_GROUPS.find((g) => g.id === 'sway')!],
  };
  const weights = bounceWeights(mesh, pinning);
  if (!weights.some((v) => v > 0)) throw new Error('揺れる頂点がありません。メッシュをなめらかにしてください。');
  const center = mesh.vertices[weights.indexOf(Math.max(...weights))]!;
  const deltas = evaluator.evaluate(model, defaults);
  const positions = pipeline.deform(model, deltas).byPartId[partId]?.positions;
  if (!positions) throw new Error('胸のパーツを表示して設定してください。');
  const xs = Array.from(positions).filter((_, i) => i % 2 === 0),
    ys = Array.from(positions).filter((_, i) => i % 2 === 1);
  const amplitudes = {
    x: Math.min(16, (Math.max(...xs) - Math.min(...xs)) * 0.04),
    y: Math.min(16, (Math.max(...ys) - Math.min(...ys)) * 0.06),
  };
  let safe = 1;
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      safe = Math.min(safe, safeBounceScale(mesh, positions, weights, { x: x * amplitudes.x, y: y * amplitudes.y }));
  if (!(safe > 0 && amplitudes.x > 0 && amplitudes.y > 0))
    throw new Error('胸の三角形が潰れています。メッシュを作り直してください。');
  amplitudes.x *= safe;
  amplitudes.y *= safe;
  const dummy: Physics = {
    id: ids.physics,
    partId,
    preset: 'chest',
    strength: old?.strength ?? 0.5,
    direction: old?.deform === 'bounce' ? old.direction : 'both',
    length: Math.max(...ys) - Math.min(...ys),
    ...CHEST_PRESET,
    ...(old?.deform === 'bounce'
      ? { spring: old.spring, damping: old.damping, inertia: old.inertia, range: old.range }
      : {}),
    inputs: old?.deform === 'bounce' ? old.inputs : [],
    outputParameterId: outputs[0]!,
    verticalOutputParameterId: outputs[1]!,
    deform: 'bounce',
    bounce: {
      gravityStrength: old?.bounce?.gravityStrength ?? 0.3,
      referenceCenter: center,
      referenceBasis: [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      amplitudes,
      meshId: mesh.id,
      meshSignature: curveMeshSignature(mesh),
      weights,
      bindingIds: [ids.horizontal, ids.vertical],
      pinning: { ...pinning },
    },
  };
  const frame = bounceFrame({ ...project, model }, dummy, deltas);
  if (!frame) throw new Error('胸の基準姿勢が潰れています。');
  dummy.bounce!.referenceBasis = frame.basis;
  model = {
    ...model,
    parts: model.parts.map((p) => (p.id === partId ? { ...p, physicsId: dummy.id } : p)),
    bindings: [
      ...bindings,
      bounceBinding(ids.horizontal, mesh.id, outputs[0]!, weights, amplitudes.x, 'x'),
      bounceBinding(ids.vertical, mesh.id, outputs[1]!, weights, amplitudes.y, 'y'),
    ],
  };
  const next = { ...project, model, physics: [...project.physics.filter((p) => p !== old), dummy] };
  const blocked = bounceReason(next, dummy);
  if (blocked) throw new Error(blocked);
  return next;
}
