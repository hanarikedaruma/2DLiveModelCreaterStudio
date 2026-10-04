import { describe, expect, it } from 'vitest';
import { encode } from 'fast-png';
import { decodePng, encodePng, hasPngSignature } from './png';
import { makeImage, pixelAt } from './testImages';

describe('PNG の復号と符号化', () => {
  it('RGBA を符号化して復号すると同じ画素になる', () => {
    const image = makeImage(5, 4, [10, 20, 30, 40], { x: 1, y: 1, width: 2, height: 2 });
    const png = encodePng(image);
    expect(hasPngSignature(png)).toBe(true);
    const back = decodePng(png);
    expect(back.width).toBe(5);
    expect(back.height).toBe(4);
    expect(Array.from(back.data)).toEqual(Array.from(image.data));
  });

  it('グレーは RGB にそろえて不透明にする', () => {
    const png = encode({ width: 2, height: 1, data: new Uint8Array([0, 200]), depth: 8, channels: 1 });
    const out = decodePng(png);
    expect(pixelAt(out, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(out, 1, 0)).toEqual([200, 200, 200, 255]);
  });

  it('グレー+アルファを読む', () => {
    const png = encode({ width: 1, height: 1, data: new Uint8Array([100, 50]), depth: 8, channels: 2 });
    expect(pixelAt(decodePng(png), 0, 0)).toEqual([100, 100, 100, 50]);
  });

  it('RGB は不透明にする', () => {
    const png = encode({ width: 1, height: 1, data: new Uint8Array([1, 2, 3]), depth: 8, channels: 3 });
    expect(pixelAt(decodePng(png), 0, 0)).toEqual([1, 2, 3, 255]);
  });

  it('16bit を 8bit にする', () => {
    const data = new Uint16Array([65535, 0, 32896, 65535, 0, 0, 0, 0]);
    const png = encode({ width: 2, height: 1, data, depth: 16, channels: 4 });
    const out = decodePng(png);
    expect(pixelAt(out, 0, 0)).toEqual([255, 0, 128, 255]);
    expect(pixelAt(out, 1, 0)).toEqual([0, 0, 0, 0]);
  });

  it('パレットの色と透明度を展開する', () => {
    const png = encode({
      width: 3,
      height: 1,
      data: new Uint8Array([2, 0, 1]),
      depth: 8,
      channels: 1,
      // fast-png は不透明でない色だけを tRNS に詰めて書くので、不透明な色を最後に置く
      palette: [
        [0, 255, 0, 0],
        [0, 0, 255, 128],
        [255, 0, 0, 255],
      ],
    });
    const out = decodePng(png);
    expect(pixelAt(out, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(out, 1, 0)).toEqual([0, 255, 0, 0]);
    expect(pixelAt(out, 2, 0)).toEqual([0, 0, 255, 128]);
  });

  it('1bit のグレーを展開する', () => {
    // 1行 10 画素 = 2 バイト。1010000011 → 0b10100000, 0b11000000
    const png = encode({ width: 10, height: 1, data: new Uint8Array([0b10100000, 0b11000000]), depth: 1, channels: 1 });
    const out = decodePng(png);
    const row = Array.from({ length: 10 }, (_, x) => pixelAt(out, x, 0)[0]);
    expect(row).toEqual([255, 0, 255, 0, 0, 0, 0, 0, 255, 255]);
  });

  it('RGB の tRNS で指定した色を透明にする', () => {
    // fast-png は tRNS の値の数が画素の数より多いと読まないので 3 画素にする
    const rgb = encode({
      width: 3,
      height: 1,
      data: new Uint8Array([1, 2, 3, 4, 5, 6, 4, 5, 6]),
      depth: 8,
      channels: 3,
    });
    const png = withChunk(rgb, 'tRNS', [0, 4, 0, 5, 0, 6]); // 16bit ずつの R, G, B
    const out = decodePng(png);
    expect(pixelAt(out, 0, 0)).toEqual([1, 2, 3, 255]);
    expect(pixelAt(out, 1, 0)).toEqual([4, 5, 6, 0]);
    expect(pixelAt(out, 2, 0)).toEqual([4, 5, 6, 0]);
  });

  it('グレーの tRNS で指定した値を透明にする', () => {
    const gray = encode({ width: 2, height: 1, data: new Uint8Array([7, 8]), depth: 8, channels: 1 });
    const out = decodePng(withChunk(gray, 'tRNS', [0, 8]));
    expect(pixelAt(out, 0, 0)).toEqual([7, 7, 7, 255]);
    expect(pixelAt(out, 1, 0)).toEqual([8, 8, 8, 0]);
  });

  it('PNG の印が無ければ PNG ではない', () => {
    expect(hasPngSignature(new Uint8Array([0x38, 0x42, 0x50, 0x53]))).toBe(false);
  });
});

// IHDR の直後にチャンクを差し込む（fast-png は tRNS を書かないため）
function withChunk(png: Uint8Array, type: string, body: number[]): Uint8Array {
  const typeBytes = Array.from(type, (c) => c.charCodeAt(0));
  const chunk = new Uint8Array(12 + body.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, body.length);
  chunk.set(typeBytes, 4);
  chunk.set(body, 8);
  view.setUint32(8 + body.length, crc32([...typeBytes, ...body]));
  const ihdrEnd = 8 + 12 + 13;
  return new Uint8Array([...png.subarray(0, ihdrEnd), ...chunk, ...png.subarray(ihdrEnd)]);
}

function crc32(bytes: number[]): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
