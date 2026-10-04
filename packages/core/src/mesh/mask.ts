// 不透明とみなす alpha の下限
export const OPAQUE_ALPHA = 8;

// 0/1 のピクセルの配列。行 y の先頭は y * stride（stride は 4 の倍数。width より右は 0）
export interface BinaryMask {
  data: Uint8Array;
  width: number;
  height: number;
  stride: number;
}

// alpha ≥ 8 のピクセルを、正方形（チェビシェフ距離 radius 以内）で膨らませた 0/1 の配列。
// 画像の外へは広げない。不透明なピクセルが無ければ null
export function dilatedOpaqueMask(image: ImageData, radius: number): BinaryMask | null {
  const { width, height, data } = image;
  const r = Math.max(0, Math.floor(radius));
  const stride = (width + 3) & ~3;
  // 上に r 行の 0 を足しておき、行 p を「行 p..p+2r の OR」にすると、元の行 y = p のまわり ±r になる
  const rows = height + r;
  const buf = new Uint8Array(rows * stride);
  let any = false;
  // 横方向: 不透明が続く区間ごとに、左右へ r ずつ広げて塗る
  for (let y = 0; y < height; y++) {
    const src = y * width * 4 + 3;
    const dst = (y + r) * stride;
    let x = 0;
    while (x < width) {
      while (x < width && data[src + x * 4]! < OPAQUE_ALPHA) x++;
      if (x >= width) break;
      const start = x;
      while (x < width && data[src + x * 4]! >= OPAQUE_ALPHA) x++;
      buf.fill(1, dst + Math.max(0, start - r), dst + Math.min(width, x + r));
      any = true;
    }
  }
  if (!any) return null;
  if (r > 0) orFollowingRows(buf, rows, stride, 2 * r + 1);
  return { data: buf.subarray(0, height * stride), width, height, stride };
}

// 行 p を「行 p..p+count-1 の OR」にする（その場で。範囲の外の行は 0）。4 バイトずつまとめて OR する
export function orFollowingRows(buf: Uint8Array, rows: number, stride: number, count: number): void {
  const words = new Uint32Array(buf.buffer, buf.byteOffset, (rows * stride) / 4);
  const rowWords = stride / 4;
  // 幅を 1, 2, 4, … と倍にしていき、最後に足りない分をずらして重ねる
  let span = 1;
  while (span * 2 <= count) {
    orShifted(words, rows, rowWords, span);
    span *= 2;
  }
  if (span < count) orShifted(words, rows, rowWords, count - span);
}

// 行 p |= 行 p+shift（前から順に。読む行はまだ書き換えていない）
function orShifted(words: Uint32Array, rows: number, rowWords: number, shift: number) {
  const end = (rows - shift) * rowWords;
  const offset = shift * rowWords;
  for (let i = 0; i < end; i++) words[i]! |= words[i + offset]!;
}
