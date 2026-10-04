import { describe, expect, it } from 'vitest';
import type { DeformedModel, DrawItem } from '@app/contracts';
import frameFile from '../../../src-tauri/src/output/testdata/wire-sample-frame.hex?raw';
import texturesFile from '../../../src-tauri/src/output/testdata/wire-sample-textures.hex?raw';
import { sampleIds, sampleModel, wireSample } from './compare/wireSample';
import { encodeFrame, encodeTextures, FRAME_MAGIC, IdTable, NO_TEXTURE, TEXTURES_MAGIC } from './wire';

function item(partId: string, assetId: string, extra: Partial<DrawItem> = {}): DrawItem {
  return {
    partId,
    assetId,
    positions: new Float32Array([0, 0, 10, 0, 10, 10]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1]),
    indices: new Uint32Array([0, 1, 2]),
    opacity: 1,
    blendMode: 'normal',
    mask: null,
    ...extra,
  };
}

const model = (...items: DrawItem[]): DeformedModel => ({
  items,
  byPartId: Object.fromEntries(items.map((i) => [i.partId, i])),
});

class Reader {
  private at = 0;
  private readonly view: DataView;
  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u32() {
    const v = this.view.getUint32(this.at, true);
    this.at += 4;
    return v;
  }
  f32() {
    const v = this.view.getFloat32(this.at, true);
    this.at += 4;
    return v;
  }
  f32s(n: number) {
    return Array.from({ length: n }, () => this.f32());
  }
  u32s(n: number) {
    return Array.from({ length: n }, () => this.u32());
  }
  bytes(n: number) {
    const out = new Uint8Array(this.view.buffer, this.view.byteOffset + this.at, n).slice();
    this.at += n;
    return out;
  }
  done() {
    return this.at === this.view.byteLength;
  }
}

describe('フレームのバイナリ', () => {
  it('品目数 → 品目ごとの番号・頂点・索引・不透明度・合成・マスクと、view・背景を書く', () => {
    const bytes = encodeFrame(
      sampleModel(),
      { scale: 2, offset: { x: 10, y: -5 } },
      { type: 'color', rgba: [1, 0.5, 0, 1] },
      sampleIds(),
    );
    const r = new Reader(bytes);
    expect(r.u32()).toBe(FRAME_MAGIC);
    expect(r.f32s(3)).toEqual([2, 10, -5]);
    expect(r.u32()).toBe(1);
    expect(r.f32s(4)).toEqual([1, 0.5, 0, 1]);
    expect(r.u32()).toBe(3);
    // face
    expect(r.u32s(4)).toEqual([0, 0, 3, 3]);
    expect(r.f32s(6)).toEqual([0, 0, 10, 0, 10, 10]);
    expect(r.f32s(6)).toEqual([0, 0, 1, 0, 1, 1]);
    expect(r.u32s(3)).toEqual([0, 1, 2]);
    expect(r.f32()).toBe(0.75);
    expect(r.u32s(3)).toEqual([0, 0, 0]); // normal・マスクなし・マスク元 0
    // eyeL（マスク元の face は 0、eyeWhite は新しい番号）
    expect(r.u32s(4)).toEqual([1, 1, 3, 3]);
    expect(r.f32s(6)).toEqual([1.5, 2.5, 3.5, 4.5, 5.5, 6.5]);
    expect(r.f32s(6)).toEqual([0, 0, 1, 0, 1, 1]);
    expect(r.u32s(3)).toEqual([0, 1, 2]);
    expect(r.f32()).toBe(1);
    expect(r.u32s(5)).toEqual([2, 2, 2, 0, 2]); // screen・反転マスク・2 つ（face, eyeWhite）
    // hidden（素材を送っていない）
    expect(r.u32s(2)).toEqual([3, NO_TEXTURE]);
    r.u32s(2);
    r.f32s(12);
    r.u32s(3);
    r.f32();
    expect(r.u32s(3)).toEqual([3, 0, 0]); // add
    expect(r.done()).toBe(true);
  });

  it('背景は透明と画像（テクスチャの番号）も書ける', () => {
    const empty = model();
    const ids = sampleIds();
    const transparent = new Reader(
      encodeFrame(empty, { scale: 1, offset: { x: 0, y: 0 } }, { type: 'transparent' }, ids),
    );
    transparent.u32s(4);
    expect(transparent.u32s(2)).toEqual([0, 0]);
    expect(transparent.done()).toBe(true);
    const image = new Reader(
      encodeFrame(empty, { scale: 1, offset: { x: 0, y: 0 } }, { type: 'image', texture: 9 }, ids),
    );
    image.u32s(4);
    expect(image.u32s(3)).toEqual([2, 9, 0]);
    expect(image.done()).toBe(true);
  });

  it('知らない合成モードは通常として送る', () => {
    const bytes = encodeFrame(
      model(item('p', 'a', { blendMode: 'overlay' as DrawItem['blendMode'] })),
      { scale: 1, offset: { x: 0, y: 0 } },
      { type: 'transparent' },
      { part: () => 0, texture: () => 0 },
    );
    const r = new Reader(bytes);
    r.u32s(6);
    r.u32s(4);
    r.f32s(12);
    r.u32s(3);
    r.f32();
    expect(r.u32()).toBe(0);
  });
});

describe('テクスチャのバイナリ', () => {
  it('PNG と RGBA を 4 バイトの境界にそろえて書き、消す番号を続ける', () => {
    const bytes = encodeTextures(
      [
        { id: 3, kind: 'png', bytes: new Uint8Array([1, 2, 3, 4, 5]) },
        { id: 7, kind: 'rgba', width: 1, height: 1, bytes: new Uint8Array([9, 8, 7, 6]) },
      ],
      [1, 2],
    );
    const r = new Reader(bytes);
    expect(r.u32()).toBe(TEXTURES_MAGIC);
    expect(r.u32()).toBe(2);
    expect(r.u32s(5)).toEqual([3, 0, 0, 0, 5]);
    expect(Array.from(r.bytes(8))).toEqual([1, 2, 3, 4, 5, 0, 0, 0]);
    expect(r.u32s(5)).toEqual([7, 1, 1, 1, 4]);
    expect(Array.from(r.bytes(4))).toEqual([9, 8, 7, 6]);
    expect(r.u32s(3)).toEqual([2, 1, 2]);
    expect(r.done()).toBe(true);
  });
});

describe('番号の表', () => {
  it('同じ文字列には同じ番号、消した番号は使い回さない', () => {
    const t = new IdTable();
    expect(t.ensure('a')).toBe(0);
    expect(t.ensure('b')).toBe(1);
    expect(t.ensure('a')).toBe(0);
    expect(t.delete('a')).toBe(0);
    expect(t.get('a')).toBeUndefined();
    expect(t.ensure('a')).toBe(2);
    expect(t.allocate()).toBe(3);
  });
});

// Rust の側（src-tauri/src/output/frame.rs の「JS のエンコードを読む」）が同じファイルを読んで中身を確かめる。
// 形を変えたときは compare/write-wire-sample.ts で書き直し、Rust のテストも直す
// 16 進の文字列（空白・改行は読み飛ばす）
const fromHex = (text: string) => Uint8Array.from(text.replace(/\s+/g, '').match(/../g) ?? [], (h) => parseInt(h, 16));

describe('Rust と共有する見本', () => {
  it('見本のフレームとテクスチャのバイナリがファイルと同じ', () => {
    const { frame, textures } = wireSample();
    expect(Array.from(frame)).toEqual(Array.from(fromHex(frameFile)));
    expect(Array.from(textures)).toEqual(Array.from(fromHex(texturesFile)));
  });
});
