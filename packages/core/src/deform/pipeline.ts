import type { Mesh, Model, Part, TransformDelta, Warp } from '@app/schema';
import type { CurveGuideResult, DeformPipeline, DeformedModel, DrawItem, TargetDeltas } from '@app/contracts';
import { IDENTITY, applyAffine, isIdentity, multiplyAffine, partAffine, type Affine } from './affine';
import { applyWarp } from './warp';
import { evaluateCurveGuide } from './curveGuide';

function own<T>(record: Record<string, T>, id: string): T | undefined {
  return Object.hasOwn(record, id) ? record[id] : undefined;
}

// 親の参照が循環していたら、循環している id を並べたエラーを投げる
export function assertAcyclic(parts: Part[]): void {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const done = new Set<string>();
  for (const start of parts) {
    const path: string[] = [];
    const onPath = new Set<string>();
    let cur: Part | undefined = start;
    while (cur && !done.has(cur.id)) {
      if (onPath.has(cur.id)) {
        const loop = [...path.slice(path.indexOf(cur.id)), cur.id];
        throw new Error(`パーツの親の参照が循環している: ${loop.join(' → ')}`);
      }
      onPath.add(cur.id);
      path.push(cur.id);
      cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
    }
    for (const id of path) done.add(id);
  }
}

interface MeshBuffers {
  uvs: Float32Array;
  indices: Uint32Array;
}

function meshBuffers(mesh: Mesh): MeshBuffers {
  const uvs = new Float32Array(mesh.uvs.length * 2);
  mesh.uvs.forEach((uv, i) => {
    uvs[i * 2] = uv.x;
    uvs[i * 2 + 1] = uv.y;
  });
  const indices = new Uint32Array(mesh.triangles.length * 3);
  mesh.triangles.forEach((t, i) => indices.set(t, i * 3));
  return { uvs, indices };
}

// 差分を階層に沿って適用し、描画できる形にする（カード07）。
// 頂点は内側から外側へ: メッシュの基準頂点 + 頂点の差分 → 自身の変形 → 親のワープ → 親の変形 → … → ルート。
// uvs・indices はメッシュのオブジェクトごとに作って使い回す（受け取った側は書き換えないこと）
export function createDeformPipeline(): DeformPipeline {
  const buffersCache = new WeakMap<Mesh, MeshBuffers>();
  const acyclicChecked = new WeakSet<Part[]>();
  const warned = new WeakMap<object, Set<string>>();

  // 毎フレーム呼ばれるので、同じものについての同じ警告は1回だけ出す
  function warnOnce(owner: object, message: string) {
    let set = warned.get(owner);
    if (!set) warned.set(owner, (set = new Set()));
    if (set.has(message)) return;
    set.add(message);
    console.warn(message);
  }

  function buffersOf(mesh: Mesh): MeshBuffers {
    let b = buffersCache.get(mesh);
    if (!b) buffersCache.set(mesh, (b = meshBuffers(mesh)));
    return b;
  }

  return {
    deform(model: Model, deltas: TargetDeltas): DeformedModel {
      if (!acyclicChecked.has(model.parts)) {
        assertAcyclic(model.parts);
        acyclicChecked.add(model.parts);
      }
      const parts = new Map(model.parts.map((p) => [p.id, p]));
      const meshes = new Map(model.meshes.map((m) => [m.id, m]));
      const warpsOf = new Map<string, Warp[]>();
      for (const w of model.warps) {
        const list = warpsOf.get(w.partId);
        if (list) list.push(w);
        else warpsOf.set(w.partId, [w]);
      }

      const parentOf = (part: Part): Part | undefined => {
        if (part.parentId === null) return undefined;
        const parent = parts.get(part.parentId);
        if (!parent) warnOnce(part, `パーツ ${part.id} の親 ${part.parentId} が無い（ルートとして扱う）`);
        return parent;
      };

      const matrices = new Map<string, Affine>();
      const matrixOf = (part: Part): Affine => {
        let m = matrices.get(part.id);
        if (!m) matrices.set(part.id, (m = partAffine(part, own<TransformDelta>(deltas.transforms, part.id))));
        return m;
      };

      // 自身と祖先の visible と不透明度の積。パーツ自身の不透明度は、不透明度のキーがあれば評価の値（I-026）
      const chains = new Map<string, { visible: boolean; opacity: number }>();
      const chainOf = (part: Part): { visible: boolean; opacity: number } => {
        let c = chains.get(part.id);
        if (c) return c;
        const parent = parentOf(part);
        const up = parent ? chainOf(parent) : { visible: true, opacity: 1 };
        const keyed = deltas.opacities ? own(deltas.opacities, part.id) : undefined;
        c = { visible: up.visible && part.visible, opacity: up.opacity * (keyed ?? part.opacity) };
        chains.set(part.id, c);
        return c;
      };

      // 描画順: drawOrder の順、そのあと drawOrder に無い画像パーツを parts の順で最前面に
      const order: Part[] = [];
      const seen = new Set<string>();
      for (const id of model.drawOrder) {
        const part = parts.get(id);
        if (!part || part.kind !== 'image' || seen.has(id)) continue;
        seen.add(id);
        order.push(part);
      }
      const missing = model.parts.filter((p) => p.kind === 'image' && !seen.has(p.id));
      if (missing.length > 0) {
        warnOnce(model.drawOrder, `drawOrder に無い画像パーツを最前面に足す: ${missing.map((p) => p.id).join(', ')}`);
        order.push(...missing);
      }

      const items: DrawItem[] = [];
      const byPartId: Record<string, DrawItem> = {};
      const guides = new Map((model.curveGuides ?? []).map((g) => [g.partId, g]));
      const curveGuides: Record<string, CurveGuideResult> = {};
      for (const part of order) {
        if (part.assetId === null || part.meshId === null) continue;
        const chain = chainOf(part);
        if (!chain.visible) continue;
        const mesh = meshes.get(part.meshId);
        if (!mesh) {
          warnOnce(part, `パーツ ${part.id} のメッシュ ${part.meshId} が無い（描かない）`);
          continue;
        }

        const n = mesh.vertices.length;
        let vertexDelta = own(deltas.vertices, mesh.id);
        if (vertexDelta && vertexDelta.length !== n * 2) {
          warnOnce(mesh, `メッシュ ${mesh.id} の頂点の差分の長さ ${vertexDelta.length} が ${n * 2} と違う（無視する）`);
          vertexDelta = undefined;
        }
        let positions = new Float32Array(n * 2);
        let pending: Affine = matrixOf(part);
        let filled = false;
        // ここまでの変形（行列にまとめてある）を点に掛ける
        const flush = () => {
          if (!filled) {
            const { a, b, c, d, e, f } = pending;
            for (let i = 0; i < n; i++) {
              const v = mesh.vertices[i]!;
              const x = v.x + (vertexDelta ? vertexDelta[i * 2]! : 0);
              const y = v.y + (vertexDelta ? vertexDelta[i * 2 + 1]! : 0);
              positions[i * 2] = a * x + c * y + e;
              positions[i * 2 + 1] = b * x + d * y + f;
            }
            filled = true;
          } else if (!isIdentity(pending)) {
            applyAffine(positions, pending);
          }
          pending = IDENTITY;
        };
        for (let anc = parentOf(part); anc; anc = parentOf(anc)) {
          const warps = warpsOf.get(anc.id);
          if (warps) {
            flush();
            for (const w of warps) {
              // 使えない格子は飛ばし、長さの合わない差分は無視する（applyWarp も同じ扱いだが、ここで1回だけ知らせる）
              if (w.points.length !== (w.columns + 1) * (w.rows + 1) || !(w.bounds.width > 0 && w.bounds.height > 0)) {
                warnOnce(w, `ワープ ${w.id} の格子が正しくない（使わない）`);
                continue;
              }
              let warpDelta = own(deltas.warpPoints, w.id);
              if (warpDelta && warpDelta.length !== w.points.length * 2) {
                warnOnce(
                  w,
                  `ワープ ${w.id} の制御点の差分の長さ ${warpDelta.length} が ${w.points.length * 2} と違う（無視する）`,
                );
                warpDelta = undefined;
              }
              applyWarp(positions, w, warpDelta);
            }
          }
          pending = multiplyAffine(matrixOf(anc), pending);
        }
        flush();

        const guide = guides.get(part.id);
        if (guide && guide.meshId === mesh.id) {
          const evaluated = evaluateCurveGuide(model, deltas, guide, mesh, positions);
          positions = evaluated.positions;
          curveGuides[guide.id] = evaluated.result;
        }

        const { uvs, indices } = buffersOf(mesh);
        const item: DrawItem = {
          partId: part.id,
          assetId: part.assetId,
          positions,
          uvs,
          indices,
          opacity: Math.min(1, Math.max(0, chain.opacity)),
          blendMode: part.blendMode,
          mask: part.mask ? { sourcePartIds: [...part.mask.sourcePartIds], inverted: part.mask.inverted } : null,
        };
        items.push(item);
        byPartId[part.id] = item;
      }
      return { items, byPartId, ...(guides.size > 0 ? { curveGuides } : {}) };
    },
  };
}
