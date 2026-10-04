// 閉じた目の線（カード42）。Model.setupHints の closedLineL / closedLineR（キャンバス座標の点の列）を
// x の関数（折れ線）として使う。メッシュの縦の範囲（上端・下端）もここで求める
import type { Mesh, Vec2 } from '@app/schema';

const SAME_X = 1e-6;

// 左右どちらからなぞっても同じ線にする（x の昇順）。同じ x の点は高さの平均でまとめ、数でない点は除く。
// x の違う点が2つ未満なら null（線として使えない）
export function normalizeClosedLine(points: readonly Vec2[] | null | undefined): Vec2[] | null {
  if (!points) return null;
  const sorted = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x);
  const line: Vec2[] = [];
  for (let i = 0; i < sorted.length;) {
    const x = sorted[i]!.x;
    let sum = 0;
    let count = 0;
    while (i < sorted.length && Math.abs(sorted[i]!.x - x) < SAME_X) {
      sum += sorted[i++]!.y;
      count++;
    }
    line.push({ x, y: sum / count });
  }
  return line.length >= 2 ? line : null;
}

// 折れ線の x での高さ。線の外側では端の高さを使う。line は normalizeClosedLine の結果
export function closedLineY(line: readonly Vec2[], x: number): number {
  const first = line[0]!;
  if (x <= first.x) return first.y;
  for (let i = 1; i < line.length; i++) {
    const b = line[i]!;
    if (x > b.x) continue;
    const a = line[i - 1]!;
    return a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
  }
  return line[line.length - 1]!.y;
}

export interface Span {
  top: number;
  bottom: number;
}

// メッシュの x での縦の範囲（三角形の辺が縦の線 x と交わる高さの最小・最大）。交わる辺が無ければ null
export function meshSpanAt(mesh: Pick<Mesh, 'vertices' | 'triangles'>, x: number): Span | null {
  let top = Infinity;
  let bottom = -Infinity;
  const hit = (y: number) => {
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  };
  for (const tri of mesh.triangles) {
    for (let e = 0; e < 3; e++) {
      const a = mesh.vertices[tri[e]!];
      const b = mesh.vertices[tri[(e + 1) % 3]!];
      if (!a || !b) continue;
      if (x < Math.min(a.x, b.x) - SAME_X || x > Math.max(a.x, b.x) + SAME_X) continue;
      if (Math.abs(b.x - a.x) <= SAME_X) {
        hit(a.y);
        hit(b.y);
      } else {
        hit(a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y));
      }
    }
  }
  return top <= bottom ? { top, bottom } : null;
}
