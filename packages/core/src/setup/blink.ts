// I-090: 画像上の線から片目だけのまばたきを作る。変形後の同じ目の空間で輪郭を測り、各パーツへ逆算する。
import {
  mapMeshPoint,
  newId,
  type Binding,
  type Mesh,
  type Model,
  type Part,
  type Project,
  type Vec2,
} from '@app/schema';
import type { BlinkImages, BlinkPlan } from '@app/contracts';
import { createBindingEvaluator } from '../eval';
import { createDeformPipeline } from '../deform/pipeline';
import { pointsToModelSpace } from '../deform/space';
import { createPointTargetMapper } from '../deform/inverse';
import { addVertex, boundaryEdges } from '../mesh/edit';
import { transferMeshKeys } from '../mesh/transfer';
import { closedLineY, meshSpanAt, normalizeClosedLine } from './closedLine';
import { deepEqual } from '../generate/equal';

export const BLINK_LABEL = 'この目のまばたきを作る';
type Eye = { white: Part; upper: Part; lower: Part[]; children: Part[]; parts: Part[]; ids: Set<string> };
const meshOf = (model: Model, p: Part) => model.meshes.find((m) => m.id === p.meshId);

function eyeOf(model: Model, side: 'L' | 'R'): Eye | string {
  const white = model.parts.find((p) => p.kind === 'image' && p.standardType === `eyeWhite${side}`);
  const upper = model.parts.find((p) => p.kind === 'image' && p.standardType === `upperLid${side}`);
  if (!upper || !white) return `目 ${side} の上まぶたと白目を標準パーツへ割り当ててください。`;
  if (
    [`eyeWhite${side}`, `upperLid${side}`].some(
      (type) => model.parts.filter((p) => p.kind === 'image' && p.standardType === type).length > 1,
    )
  )
    return `目 ${side} の白目と上まぶたは、それぞれ1つの画像パーツに割り当ててください。`;
  const lower = model.parts.filter((p) => p.kind === 'image' && p.standardType === `lowerLid${side}`);
  const children: Part[] = [];
  const seen = new Set([upper.id]);
  const visit = (id: string) => {
    for (const p of model.parts.filter((p) => p.parentId === id)) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      if (p.kind === 'image') children.push(p);
      visit(p.id);
    }
  };
  visit(upper.id);
  const parts = [...new Map([white, upper, ...lower, ...children].map((p) => [p.id, p])).values()];
  for (const p of parts) {
    const mesh = meshOf(model, p);
    if (!mesh || mesh.triangles.length === 0) return `${p.name} のメッシュを先に作ってください。`;
    let cur: Part | undefined = p;
    const path = new Set<string>();
    while (cur && !path.has(cur.id)) {
      path.add(cur.id);
      if (cur.locked) return `${cur.name} がロックされています。解除してから作ってください。`;
      cur = model.parts.find((a) => a.id === cur!.parentId);
    }
  }
  const ids = new Set(parts.flatMap((p) => [p.id, p.meshId!]));
  if (model.parts.some((p) => !ids.has(p.id) && p.meshId !== null && ids.has(p.meshId)))
    return 'この目のメッシュを別のパーツと共有しています。メッシュを分けてから作ってください。';
  // 目のグループの旧squashも置き換える。顔・頭・他の目には触らない。
  for (const p of model.parts.filter((p) => p.standardType === `eyeGroup${side}`)) ids.add(p.id);
  for (const w of model.warps.filter((w) => ids.has(w.partId))) ids.add(w.id);
  return { white, upper, lower, children, parts, ids };
}

export function blinkBlockReason(project: Project, side: 'L' | 'R'): string | null {
  const eye = eyeOf(project.model, side);
  return typeof eye === 'string' ? eye : null;
}

type Frame = { to(p: Vec2): Vec2; from(p: Vec2): Vec2 };
function frameOf(mesh: Mesh, display: Vec2[]): Frame | null {
  const a = mapMeshPoint(mesh, mesh.uvs, display, { x: 0.25, y: 0.5 });
  const b = mapMeshPoint(mesh, mesh.uvs, display, { x: 0.75, y: 0.5 });
  const bottom = mapMeshPoint(mesh, mesh.uvs, display, { x: 0.25, y: 0.75 });
  if (!a || !b || !bottom) return null;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 1e-6) return null;
  const ux = (b.x - a.x) / length,
    uy = (b.y - a.y) / length;
  const sign = (bottom.x - a.x) * -uy + (bottom.y - a.y) * ux >= 0 ? 1 : -1;
  const vx = -uy * sign,
    vy = ux * sign;
  return {
    to: (p) => ({ x: (p.x - a.x) * ux + (p.y - a.y) * uy, y: (p.x - a.x) * vx + (p.y - a.y) * vy }),
    from: (p) => ({ x: a.x + p.x * ux + p.y * vx, y: a.y + p.x * uy + p.y * vy }),
  };
}

function baseView(model: Model) {
  const deltas = createBindingEvaluator().evaluate(model, {});
  const deformed = createDeformPipeline().deform(model, deltas);
  const positions = (p: Part) => {
    const mesh = meshOf(model, p)!;
    const item = deformed.byPartId[p.id];
    return item
      ? mesh.vertices.map((_, i) => ({ x: item.positions[2 * i]!, y: item.positions[2 * i + 1]! }))
      : pointsToModelSpace(model, deltas, p.id, mesh.vertices);
  };
  return { deltas, positions };
}

function attachedLine(model: Model, side: 'L' | 'R', positions: (p: Part) => Vec2[]): Vec2[] | null {
  const line = model.setupHints[side === 'L' ? 'closedLineL' : 'closedLineR'];
  if (!line) return null;
  if (line.partId === null) return line.points;
  const p = model.parts.find((p) => p.id === line.partId);
  const mesh = p && meshOf(model, p);
  if (!p || !mesh) return null;
  const display = positions(p);
  const mapped = line.points.map((uv) => mapMeshPoint(mesh, mesh.uvs, display, uv));
  return mapped.every((p): p is Vec2 => p !== null) ? mapped : null;
}

export function suggestClosedEyeLine(project: Project, side: 'L' | 'R', images?: BlinkImages) {
  const eye = eyeOf(project.model, side);
  if (typeof eye === 'string') return null;
  const view = baseView(project.model),
    mesh = meshOf(project.model, eye.white)!;
  const display = view.positions(eye.white),
    frame = frameOf(mesh, display);
  if (!frame) return null;
  const profile = profileOf(project, eye.white, display, frame, images);
  if (!profile) return null;
  const points = [0.04, 0.27, 0.5, 0.73, 0.96].map((t) => {
    const x = profile.x0 + (profile.x1 - profile.x0) * t;
    const top = profile.top(x),
      bottom = profile.bottom(x);
    return mapMeshPoint(mesh, display, mesh.uvs, frame.from({ x, y: top + (bottom - top) * 0.82 }));
  });
  return points.every((p): p is Vec2 => p !== null) ? { partId: eye.white.id, points } : null;
}

type Profile = { x0: number; x1: number; top(x: number): number; bottom(x: number): number };
function profileOf(project: Project, part: Part, display: Vec2[], frame: Frame, images?: BlinkImages): Profile | null {
  const mesh = meshOf(project.model, part)!,
    points = display.map(frame.to);
  const image = part.assetId ? images?.[part.assetId] : undefined;
  const samples = new Map<number, { top: number; bottom: number }>();
  if (image) {
    // UV三角形から画素を同じ目の空間へ運ぶ。画像自身の回転・ワープも含む。
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        if (image.data[(y * image.width + x) * 4 + 3]! < 32) continue;
        const p = mapMeshPoint(mesh, mesh.uvs, points, { x: (x + 0.5) / image.width, y: (y + 0.5) / image.height });
        if (!p) continue;
        const column = Math.round(p.x),
          span = samples.get(column);
        samples.set(column, {
          top: Math.min(span?.top ?? Infinity, p.y - 0.5),
          bottom: Math.max(span?.bottom ?? -Infinity, p.y + 0.5),
        });
      }
  }
  const x0 = image && samples.size ? Math.min(...samples.keys()) : Math.min(...points.map((p) => p.x));
  const x1 = image && samples.size ? Math.max(...samples.keys()) : Math.max(...points.map((p) => p.x));
  if (x1 - x0 < 1e-6 || (image && samples.size === 0)) return null;
  const columns = Array.from({ length: Math.ceil(x1) - Math.floor(x0) + 1 }, (_, i) => Math.floor(x0) + i);
  const spans = columns.map(
    (x) =>
      samples.get(x) ??
      (image
        ? null
        : meshSpanAt({ vertices: points, triangles: mesh.triangles }, Math.max(x0 + 1e-5, Math.min(x1 - 1e-5, x)))),
  );
  for (let i = 1; i < spans.length; i++) spans[i] ??= spans[i - 1] ?? null;
  for (let i = spans.length - 2; i >= 0; i--) spans[i] ??= spans[i + 1] ?? null;
  if (spans.some((s) => s === null)) return null;
  const at = (x: number, edge: 'top' | 'bottom') => {
    const v = Math.max(0, Math.min(spans.length - 1, x - columns[0]!)),
      i = Math.min(spans.length - 2, Math.floor(v)),
      t = v - i;
    return spans[i]![edge] * (1 - t) + spans[i + 1]![edge] * t;
  };
  return { x0, x1, top: (x) => at(x, 'top'), bottom: (x) => at(x, 'bottom') };
}

// 縦の列が外周にも届くように辺上へ頂点を追加。元の三角形の内側だけを分割し、他のキーを転写する。
function refine(model: Model, part: Part, display: Vec2[], frame: Frame): Model {
  const mesh = meshOf(model, part)!,
    points = display.map(frame.to);
  const x0 = Math.min(...points.map((p) => p.x)),
    x1 = Math.max(...points.map((p) => p.x));
  const edges = new Map<string, [number, number]>();
  for (const [a, b, c] of mesh.triangles)
    for (const [i, j] of [
      [a, b],
      [b, c],
      [c, a],
    ] as [number, number][])
      edges.set(i < j ? `${i},${j}` : `${j},${i}`, [i, j]);
  const candidates: Vec2[] = [];
  const step = Math.max(5, (x1 - x0) / 80);
  for (let x = x0 + step; x < x1; x += step)
    for (const [a, b] of edges.values()) {
      const p = points[a]!,
        q = points[b]!;
      if (Math.abs(q.x - p.x) < 1e-6) continue;
      const t = (x - p.x) / (q.x - p.x);
      if (t > 1e-6 && t < 1 - 1e-6)
        candidates.push({
          x: mesh.vertices[a]!.x * (1 - t) + mesh.vertices[b]!.x * t,
          y: mesh.vertices[a]!.y * (1 - t) + mesh.vertices[b]!.y * t,
        });
    }
  let shape = { vertices: mesh.vertices, uvs: mesh.uvs, triangles: mesh.triangles };
  for (const p of candidates) {
    if (shape.vertices.length >= 4096 || shape.vertices.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1.25)) continue;
    const added = addVertex(shape, p);
    if (added.ok) shape = added.shape;
  }
  if (shape.vertices.length === mesh.vertices.length) return model;
  const transferred = transferMeshKeys(model, mesh.id, shape);
  return {
    ...transferred,
    meshes: transferred.meshes.map((m) => (m.id === mesh.id ? { ...m, ...shape, density: 'custom', edited: true } : m)),
  };
}

export function planBlink(project: Project, side: 'L' | 'R', images?: BlinkImages, nextId = newId): BlinkPlan {
  const eye = eyeOf(project.model, side);
  const fail = (reason: string): BlinkPlan => ({ command: null, reason, replacesCustom: false });
  if (typeof eye === 'string') return fail(eye);
  if (images && [eye.white, eye.upper, ...eye.lower].some((p) => !p.assetId || !images[p.assetId]))
    return fail('白目・まぶたの素材画像が読み込まれていません。素材を確認してください。');
  const open = `EyeOpen${side}`;
  if (!project.model.parameters.some((p) => p.id === open && p.default === 1 && p.min === 0 && p.max === 1))
    return fail(`${open}（範囲 0〜1、既定値 1）を追加してください。`);
  const owns = (b: Binding) => eye.ids.has(b.target.id) && b.parameterIds.includes(open);
  const replaced = project.model.bindings.filter(owns);
  const replacesCustom = replaced.some(
    (b) =>
      b.parameterIds.length > 1 || b.keys.some((k) => k.locked || k.source === 'manual' || k.source === 'combined'),
  );
  let model: Model = { ...project.model, bindings: project.model.bindings.filter((b) => !owns(b)) };
  let view = baseView(model),
    frame = frameOf(meshOf(model, eye.white)!, view.positions(eye.white));
  if (!frame) return fail('白目のメッシュがつぶれているため、線の位置を計算できません。');
  const hintKey = side === 'L' ? 'closedLineL' : 'closedLineR';
  const legacy = model.setupHints[hintKey];
  if (legacy?.partId === null) {
    const mesh = meshOf(model, eye.white)!,
      display = view.positions(eye.white);
    const points = legacy.points.map((p) => mapMeshPoint(mesh, display, mesh.uvs, p));
    if (points.every((p): p is Vec2 => p !== null))
      model = { ...model, setupHints: { ...model.setupHints, [hintKey]: { partId: eye.white.id, points } } };
  }
  const lineWorld = attachedLine(model, side, view.positions);
  const line = normalizeClosedLine(lineWorld?.map(frame.to));
  if (!line) return fail('閉じた目の線をなぞるか、［線の案を作る］を押してください。');
  const whiteProfile = profileOf({ ...project, model }, eye.white, view.positions(eye.white), frame, images);
  const upperProfile = profileOf({ ...project, model }, eye.upper, view.positions(eye.upper), frame, images);
  if (!whiteProfile || !upperProfile) return fail('白目または上まぶたに不透明な画像がありません。');
  if (line.at(-1)!.x <= whiteProfile.x0 || line[0]!.x >= whiteProfile.x1)
    return fail('線が白目と重なっていません。白目の端から端まで引き直してください。');
  const checkX = (Math.max(line[0]!.x, whiteProfile.x0) + Math.min(line.at(-1)!.x, whiteProfile.x1)) / 2;
  if (closedLineY(line, checkX) < upperProfile.bottom(checkX) - 1)
    return fail('線が開いた上まぶたより上にあります。閉じたときの下の端をなぞってください。');
  if (
    closedLineY(line, checkX) >
    whiteProfile.bottom(checkX) + (whiteProfile.bottom(checkX) - whiteProfile.top(checkX)) * 0.5
  )
    return fail('線が白目から離れすぎています。白目の下側を目安に引き直してください。');
  for (const p of eye.parts) model = refine(model, p, view.positions(p), frame);
  view = baseView(model);
  // 線の意味と開いた姿勢は同じ。転写で他のパラメータの形を保持する。
  frame = frameOf(meshOf(model, eye.white)!, view.positions(eye.white))!;
  const f = frame;
  const xs = Array.from(
    { length: Math.max(3, Math.ceil(upperProfile.x1 - upperProfile.x0) + 1) },
    (_, i) => upperProfile.x0 + i,
  );
  const rawTop = xs.map(upperProfile.top);
  const window = (arr: number[], i: number, fn: (...n: number[]) => number) =>
    fn(...arr.slice(Math.max(0, i - 3), i + 4));
  const dilated = rawTop.map((_, i) => window(rawTop, i, Math.max));
  const top = dilated.map((_, i) => window(dilated, i, Math.min));
  const bottom = xs.map(upperProfile.bottom);
  const thickness = xs.map((_, i) => {
    const a = Math.max(0, i - 3),
      b = Math.min(xs.length - 1, i + 3);
    const slope = (top[b]! + bottom[b]! - (top[a]! + bottom[a]!)) / (2 * Math.max(1, b - a));
    return Math.max(0.65, (0.35 * (bottom[i]! - top[i]!)) / Math.sqrt(1 + slope * slope));
  });
  const middle = thickness
    .filter(
      (_, i) =>
        xs[i]! > whiteProfile.x0 + (whiteProfile.x1 - whiteProfile.x0) * 0.3 &&
        xs[i]! < whiteProfile.x1 - (whiteProfile.x1 - whiteProfile.x0) * 0.3,
    )
    .sort((a, b) => a - b);
  const median = middle[Math.floor(middle.length / 2)] ?? 2;
  const sample = (arr: number[], x: number) => {
    const v = Math.max(0, Math.min(arr.length - 1, x - xs[0]!)),
      i = Math.min(arr.length - 2, Math.floor(v)),
      t = v - i;
    return arr[i]! * (1 - t) + arr[i + 1]! * t;
  };
  const outer = side === 'L' ? 1 : -1;
  const start = outer > 0 ? line.at(-1)!.x : line[0]!.x;
  const end = outer > 0 ? upperProfile.x1 : upperProfile.x0;
  const C = (x: number) => {
    if (outer * (x - start) <= 0) return closedLineY(line, x);
    const slope = (closedLineY(line, start) - closedLineY(line, start - outer * 8)) / 8;
    return closedLineY(line, start) + slope * outer * (x - start);
  };
  const thick = (x: number) => {
    const t = Math.max(0, Math.min(1, (outer * (x - start)) / Math.max(1, outer * (end - start))));
    return Math.min(sample(thickness, x), 1.2 * median) * (1 - t) + 0.65 * t;
  };
  const values = [0, 0.25, 0.5, 0.75, 1];
  const bindings: Binding[] = [];
  for (const part of eye.parts) {
    const mesh = meshOf(model, part)!,
      display = view.positions(part),
      local = mesh.vertices.map((p, i) => ({
        x: p.x + (view.deltas.vertices[mesh.id]?.[2 * i] ?? 0),
        y: p.y + (view.deltas.vertices[mesh.id]?.[2 * i + 1] ?? 0),
      }));
    const worldField = view.deltas.modelVertices?.[mesh.id];
    const forward = (ps: Vec2[]) =>
      pointsToModelSpace(model, view.deltas, part.id, ps).map((p, i) => ({
        x: p.x + (worldField?.[2 * i] ?? 0),
        y: p.y + (worldField?.[2 * i + 1] ?? 0),
      }));
    // プローブの配列長が変わる逆算ではmodel座標の差分を各頂点ごとに先に除く。
    const solve = createPointTargetMapper((ps) => pointsToModelSpace(model, view.deltas, part.id, ps), local);
    const keys: Binding['keys'] = [];
    for (const value of values) {
      if (value === 1) {
        keys.push({ coords: [1], delta: mesh.vertices.map(() => ({ x: 0, y: 0 })), source: 'auto', locked: false });
        continue;
      }
      const targets = display.map((p) => {
        const q = f.to(p),
          x = q.x,
          c = C(x),
          band = thick(x);
        let closedY: number;
        if (part.id === eye.white.id) {
          const t = Math.max(
            0,
            Math.min(1, (q.y - whiteProfile.top(x)) / Math.max(1e-6, whiteProfile.bottom(x) - whiteProfile.top(x))),
          );
          closedY = c - Math.max(0.6, band * 0.55) + t * 0.15;
        } else if (part.id === eye.upper.id) {
          const t = sample(top, x),
            b = sample(bottom, x);
          const tail = Math.max(0, Math.min(1, (outer * (x - start)) / Math.max(1, outer * (end - start))));
          closedY =
            q.y < t
              ? c - band + (q.y - t) * (0.3 * (1 - tail) + 0.04 * tail)
              : q.y <= b
                ? c - band + ((q.y - t) / Math.max(1e-6, b - t)) * band
                : c + Math.min(1, (q.y - b) * 0.15);
        } else if (eye.children.some((p) => p.id === part.id)) {
          closedY = q.y + c - upperProfile.bottom(x);
        } else {
          closedY = c - Math.max(0.6, band * 0.55) + (q.y - whiteProfile.bottom(x)) * 0.15;
        }
        return f.from({ x, y: q.y * value + closedY * (1 - value) });
      });
      const solved = solve(
        targets.map((p, i) => ({ x: p.x - (worldField?.[2 * i] ?? 0), y: p.y - (worldField?.[2 * i + 1] ?? 0) })),
      );
      if (!solved || forward(solved).some((p, i) => Math.hypot(p.x - targets[i]!.x, p.y - targets[i]!.y) > 0.01))
        return fail(`${part.name} のワープがつぶれているため、まばたきを逆算できません。`);
      keys.push({
        coords: [value],
        delta: solved.map((p, i) => ({ x: p.x - local[i]!.x, y: p.y - local[i]!.y })),
        source: 'auto',
        locked: false,
      });
    }
    bindings.push({
      id: nextId(),
      target: { type: 'mesh', id: mesh.id },
      channel: 'vertices',
      parameterIds: [open],
      keyValues: [values],
      keys,
      generation: 'linear',
      divisions: null,
    });
    if (part.id === eye.white.id || eye.lower.some((p) => p.id === part.id)) {
      const shown = part.opacity;
      bindings.push({
        id: nextId(),
        target: { type: 'part', id: part.id },
        channel: 'transform',
        parameterIds: [open],
        keyValues: [[0, 0.05, 1]],
        keys: [0, 0.05, 1].map((v) => ({
          coords: [v],
          delta: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: v === 0 ? 0 : shown },
          source: 'auto',
          locked: false,
        })),
        generation: 'linear',
        divisions: null,
        controlsOpacity: true,
      });
    }
  }
  const stable = bindings.map((b) => ({
    ...b,
    id:
      replaced.find(
        (old) => old.channel === b.channel && old.target.id === b.target.id && old.parameterIds.length === 1,
      )?.id ?? b.id,
  }));
  model = { ...model, bindings: [...model.bindings, ...stable] };
  // 参照が変わったら古い計画を適用しない。確認中の更新はUIで計画と確認をやり直す。
  const next = deepEqual(model, project.model) ? project : { ...project, model };
  return { command: { label: BLINK_LABEL, apply: (p) => (p === project ? next : p) }, reason: null, replacesCustom };
}

export function eyeGuideEdges(model: Model, partId: string): Vec2[][] {
  const part = model.parts.find((p) => p.id === partId),
    mesh = part && meshOf(model, part);
  return mesh ? boundaryEdges(mesh.triangles).map(([a, b]) => [mesh.uvs[a]!, mesh.uvs[b]!]) : [];
}
