import type { Vec2 } from '@app/schema';
import type { BinaryMask } from './mask';

// marching squares のセルの辺
const TOP = 0;
const RIGHT = 1;
const BOTTOM = 2;
const LEFT = 3;

// PARTNER[コード * 4 + 入った辺] = 出る辺（-1 は輪郭が通らない）
// コードはセルの四隅（ピクセルの中心）の値。左上 8・右上 4・右下 2・左下 1
const PARTNER = buildPartnerTable();

function buildPartnerTable(): Int8Array {
  const table = new Int8Array(64).fill(-1);
  const pair = (code: number, a: number, b: number) => {
    table[code * 4 + a] = b;
    table[code * 4 + b] = a;
  };
  for (let code = 0; code < 16; code++) {
    // 斜めの2つだけが内側のときは、内側の角をそれぞれ切り離す（内側は4連結）
    if (code === 5) {
      pair(code, TOP, RIGHT);
      pair(code, BOTTOM, LEFT);
      continue;
    }
    if (code === 10) {
      pair(code, TOP, LEFT);
      pair(code, BOTTOM, RIGHT);
      continue;
    }
    const tl = (code >> 3) & 1;
    const tr = (code >> 2) & 1;
    const br = (code >> 1) & 1;
    const bl = code & 1;
    const crossing: number[] = [];
    if (tl !== tr) crossing.push(TOP);
    if (tr !== br) crossing.push(RIGHT);
    if (br !== bl) crossing.push(BOTTOM);
    if (bl !== tl) crossing.push(LEFT);
    const [a, b] = crossing;
    if (a !== undefined && b !== undefined) pair(code, a, b);
  }
  return table;
}

// 0/1 のピクセルの輪郭を marching squares で求める。座標は画像の中の位置（ピクセルの境界が整数）。
// 画像の外は 0 とみなす。点は隣り合うピクセルの中心の中点に置くので、0..width × 0..height に収まる。
// 外側の輪郭も穴の輪郭も、同じ向き（内側が進む向きの右）で返す。輪郭どうしは交わらず、点も共有しない
export function traceContours(mask: BinaryMask): Vec2[][] {
  const { data, width, height, stride } = mask;
  const at = (x: number, y: number): number =>
    x >= 0 && y >= 0 && x < width && y < height ? (data[y * stride + x] ?? 0) : 0;
  // 横に隣り合うピクセル (x, y)・(x+1, y) の間の辺 H(x, y)（x = -1..width-1）をたどったか
  const seenH = new Uint8Array((width + 1) * height);
  const contours: Vec2[][] = [];

  // H(sx, sy) から1周たどる。同じ向きに続く移動は1本の辺にまとめる
  const trace = (sx: number, sy: number, leftInside: boolean): Vec2[] => {
    const start = sy * (width + 1) + sx + 1;
    seenH[start] = 1;
    let last: Vec2 = { x: sx + 1, y: sy + 0.5 };
    const points: Vec2[] = [last];
    let dirX = NaN;
    let dirY = NaN;
    // セル (cx, cy) の四隅はピクセル (cx, cy)・(cx+1, cy)・(cx+1, cy+1)・(cx, cy+1)
    let cx = sx;
    let cy = leftInside ? sy : sy - 1;
    let entry = leftInside ? TOP : BOTTOM;
    for (;;) {
      const code = (at(cx, cy) << 3) | (at(cx + 1, cy) << 2) | (at(cx + 1, cy + 1) << 1) | at(cx, cy + 1);
      const exit = PARTNER[code * 4 + entry];
      let px: number;
      let py: number;
      if (exit === TOP || exit === BOTTOM) {
        const ey = exit === TOP ? cy : cy + 1;
        const index = ey * (width + 1) + cx + 1;
        // 最初の辺に戻ったら1周
        if (index === start) return points;
        seenH[index] = 1;
        px = cx + 1;
        py = ey + 0.5;
        cy = exit === TOP ? cy - 1 : cy + 1;
        entry = exit === TOP ? BOTTOM : TOP;
      } else if (exit === LEFT || exit === RIGHT) {
        px = exit === LEFT ? cx + 0.5 : cx + 1.5;
        py = cy + 1;
        cx = exit === LEFT ? cx - 1 : cx + 1;
        entry = exit === LEFT ? RIGHT : LEFT;
      } else {
        throw new Error('輪郭の追跡に失敗した');
      }
      const dx = px - last.x;
      const dy = py - last.y;
      if (dx === dirX && dy === dirY && points.length > 1) {
        last.x = px;
        last.y = py;
      } else {
        last = { x: px, y: py };
        points.push(last);
        dirX = dx;
        dirY = dy;
      }
    }
  };

  // 横に値が変わる所（H の辺）から、まだたどっていない輪郭を始める。値の変わらない 4 ピクセルはまとめて飛ばす
  const aligned = data.byteOffset % 4 === 0 && stride % 4 === 0;
  const words = aligned ? new Uint32Array(data.buffer, data.byteOffset, (height * stride) / 4) : null;
  const rowWords = stride / 4;
  for (let y = 0; y < height; y++) {
    const base = y * stride;
    const edges = y * (width + 1);
    let left = 0; // ピクセル x-1 の値（x = 0 では画像の外）
    for (let x = 0; x < width;) {
      if (words && x % 4 === 0) {
        const word = words[y * rowWords + x / 4]!;
        if (word === (left ? 0x01010101 : 0) && x + 4 <= width) {
          x += 4;
          continue;
        }
      }
      const v = data[base + x]!;
      if (v !== left) {
        if (!seenH[edges + x]) contours.push(trace(x - 1, y, left === 1));
        left = v;
      }
      x++;
    }
    if (left !== 0 && !seenH[edges + width]) contours.push(trace(width - 1, y, true));
  }
  return contours;
}

// 画像の角のピクセルが内側のとき、marching squares が斜めに切った角を、画像の角の点で埋める
export function fillImageCorners(points: Vec2[], width: number, height: number): Vec2[] {
  const corners: [Vec2, Vec2, Vec2][] = [
    [
      { x: 0, y: 0.5 },
      { x: 0.5, y: 0 },
      { x: 0, y: 0 },
    ],
    [
      { x: width - 0.5, y: 0 },
      { x: width, y: 0.5 },
      { x: width, y: 0 },
    ],
    [
      { x: width, y: height - 0.5 },
      { x: width - 0.5, y: height },
      { x: width, y: height },
    ],
    [
      { x: 0.5, y: height },
      { x: 0, y: height - 0.5 },
      { x: 0, y: height },
    ],
  ];
  const same = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;
  const out: Vec2[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    out.push(a);
    for (const [p, q, corner] of corners) {
      if ((same(a, p) && same(b, q)) || (same(a, q) && same(b, p))) {
        out.push(corner);
        break;
      }
    }
  }
  return out;
}

// 一直線に並んだ途中の点を除く（閉じた多角形）
export function removeCollinear(points: Vec2[]): Vec2[] {
  const straight = (a: Vec2, b: Vec2, c: Vec2) => {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const vx = c.x - b.x;
    const vy = c.y - b.y;
    return ux * vy - uy * vx === 0 && ux * vx + uy * vy > 0;
  };
  const out: Vec2[] = [];
  for (const p of points) {
    while (out.length >= 2 && straight(out[out.length - 2]!, out[out.length - 1]!, p)) out.pop();
    out.push(p);
  }
  // 始点・終点のまわり（つなぎ目）
  let start = 0;
  for (;;) {
    const len = out.length - start;
    if (len < 3) break;
    const last = out[out.length - 1]!;
    if (straight(out[out.length - 2]!, last, out[start]!)) {
      out.pop();
      continue;
    }
    if (straight(last, out[start]!, out[start + 1]!)) {
      start += 1;
      continue;
    }
    break;
  }
  return start === 0 ? out : out.slice(start);
}
