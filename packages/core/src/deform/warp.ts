import type { Vec2, Warp } from '@app/schema';

// 格子のワープ（カード29）。ファイル名と applyWarp の名前は変形パイプライン（カード07）が使うので変えないこと

// 使える格子か: 分割が 1 以上の整数、制御点が (columns+1)×(rows+1) 個、bounds の幅と高さが正
export function isUsableWarp(warp: Warp): boolean {
  const { columns, rows, bounds } = warp;
  return (
    Number.isInteger(columns) &&
    Number.isInteger(rows) &&
    columns >= 1 &&
    rows >= 1 &&
    warp.points.length === (columns + 1) * (rows + 1) &&
    bounds.width > 0 &&
    bounds.height > 0 &&
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height)
  );
}

// 規則的な格子の制御点（行優先）。この制御点のワープは恒等になる
export function regularWarpPoints(bounds: Warp['bounds'], columns: number, rows: number): Vec2[] {
  const points: Vec2[] = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= columns; i++) {
      points.push({ x: bounds.x + (bounds.width * i) / columns, y: bounds.y + (bounds.height * j) / rows });
    }
  }
  return points;
}

// グループのワープを points（[x0, y0, ...]、キャンバス座標）にその場で掛ける。
// u = (x − bounds.x) / bounds.width × columns、v = (y − bounds.y) / bounds.height × rows。
// セル i = floor(u)・j = floor(v) を 0..columns−1・0..rows−1 に丸め、s = u − i・t = v − j として、
// 4つの角の制御点（基準の points + delta）を双線形補間した位置へ動かす。
// 格子の外の点は端のセルの式をそのまま使うので、s・t が 0..1 を超えて外へなめらかに延びる。
// 使えない格子（isUsableWarp が false）なら何もしない。delta の長さが制御点の数 × 2 でなければ delta を使わない
export function applyWarp(points: Float32Array | Float64Array, warp: Warp, delta: Float32Array | undefined): void {
  if (!isUsableWarp(warp)) return;
  const { columns, rows } = warp;
  const { x: bx, y: by, width, height } = warp.bounds;
  const stride = columns + 1;
  const n = warp.points.length;
  const d = delta && delta.length === n * 2 ? delta : undefined;

  // 制御点（基準 + 差分）
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const p = warp.points[k]!;
    cx[k] = p.x + (d ? d[k * 2]! : 0);
    cy[k] = p.y + (d ? d[k * 2 + 1]! : 0);
  }

  const su = columns / width;
  const sv = rows / height;
  const lastI = columns - 1;
  const lastJ = rows - 1;
  for (let k = 0; k + 1 < points.length; k += 2) {
    const u = (points[k]! - bx) * su;
    const v = (points[k + 1]! - by) * sv;
    const i = Math.min(lastI, Math.max(0, Math.floor(u)));
    const j = Math.min(lastJ, Math.max(0, Math.floor(v)));
    const s = u - i;
    const t = v - j;
    const k00 = j * stride + i;
    const k10 = k00 + 1;
    const k01 = k00 + stride;
    const k11 = k01 + 1;
    const w00 = (1 - s) * (1 - t);
    const w10 = s * (1 - t);
    const w01 = (1 - s) * t;
    const w11 = s * t;
    points[k] = w00 * cx[k00]! + w10 * cx[k10]! + w01 * cx[k01]! + w11 * cx[k11]!;
    points[k + 1] = w00 * cy[k00]! + w10 * cy[k10]! + w01 * cy[k01]! + w11 * cy[k11]!;
  }
}
