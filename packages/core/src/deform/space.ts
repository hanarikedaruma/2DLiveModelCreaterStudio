// パーツの空間の点を、祖先の変形とワープを掛けたキャンバス上の位置にする（カード29。ツールの表示に使う）。
// 順序はパイプラインと同じ: 画像自身のワープ → 自身の変形 → 親のワープ → 親の変形 → … → ルート
import type { Model, Part, Vec2 } from '@app/schema';
import type { TargetDeltas } from '@app/contracts';
import { partAffine, transformVec } from './affine';
import { applyWarp } from './warp';

function own<T>(record: Record<string, T>, id: string): T | undefined {
  return Object.hasOwn(record, id) ? record[id] : undefined;
}

// partId から親へたどって変形とワープを掛ける。stopAt の祖先に着いたら、その祖先のワープと変形は掛けずに止まる
function lift(
  model: Model,
  deltas: TargetDeltas,
  partId: string,
  points: Vec2[],
  stopAt: string | null,
  skipOwnWarp = false,
): Vec2[] {
  let out = points.map((p) => ({ x: p.x, y: p.y }));
  const parts = new Map(model.parts.map((p) => [p.id, p]));
  const start = parts.get(partId);
  if (!start || partId === stopAt) return out;

  const seen = new Set<string>();
  const transform = (part: Part) => {
    const m = partAffine(part, own(deltas.transforms, part.id));
    out = out.map((p) => transformVec(m, p));
  };
  const warpPart = (part: Part) => {
    const warps = model.warps.filter((w) => w.partId === part.id);
    if (!warps.length) return;
    const buf = new Float64Array(out.flatMap((p) => [p.x, p.y]));
    for (const w of warps) applyWarp(buf, w, own(deltas.warpPoints, w.id));
    out = out.map((_, i) => ({ x: buf[i * 2]!, y: buf[i * 2 + 1]! }));
  };
  if (start.kind === 'image' && !skipOwnWarp) warpPart(start);
  transform(start);
  seen.add(start.id);
  let cur = start.parentId === null ? undefined : parts.get(start.parentId);
  while (cur && !seen.has(cur.id) && cur.id !== stopAt) {
    seen.add(cur.id);
    warpPart(cur);
    transform(cur);
    cur = cur.parentId === null ? undefined : parts.get(cur.parentId);
  }
  return out;
}

// partId の空間（自身の変形を掛ける前の座標。基準状態ならキャンバス座標と同じ）の点を、
// 自身の変形 → 親のワープ → 親の変形 → … → ルートの順に掛けたキャンバス上の位置にする。
// グループの点（そのグループのワープの制御点など）なら、祖先の変形とワープを掛けた見えている位置になる。
// 画像パーツのメッシュの頂点（基準 + 差分）を渡すと、変形パイプラインの最終頂点と同じになる。
// partId が無ければ点をそのまま返す。親の参照が循環していたら、一巡したところで止める
export function pointsToModelSpace(model: Model, deltas: TargetDeltas, partId: string, points: Vec2[]): Vec2[] {
  return lift(model, deltas, partId, points, null);
}

// ワープの制御点は既にそのワープの出力。自身のワープをもう一度掛けず、変形と祖先のワープだけで表示する
export function warpPointsToModelSpace(model: Model, deltas: TargetDeltas, partId: string, points: Vec2[]): Vec2[] {
  return lift(model, deltas, partId, points, null, true);
}

// partId の空間の点を、祖先 ancestorId のワープを掛ける直前の空間（ancestorId のワープの入力）にする。
// ancestorId のワープと変形は掛けない。partId と ancestorId が同じなら点をそのまま返す。
// ancestorId が祖先でなければ、ルートまで掛ける（pointsToModelSpace と同じ）
export function pointsToAncestorSpace(
  model: Model,
  deltas: TargetDeltas,
  partId: string,
  ancestorId: string,
  points: Vec2[],
): Vec2[] {
  return lift(model, deltas, partId, points, ancestorId);
}
