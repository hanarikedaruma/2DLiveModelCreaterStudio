// Spout2 の送信（Rust の src-tauri/src/output/frame.rs）へ渡すバイナリ。値はすべてリトルエンディアン。
//
// フレーム（'SPF1'）: magic, view（scale・offset.x・offset.y の f32）, 背景（種類 u32 と、色なら乗算していない
// r g b a の f32、画像ならテクスチャの番号 u32）, 品目数 u32, 品目ごとに partId の番号・テクスチャの番号・頂点数 n・
// 索引の数 m（u32）, positions（f32 × 2n）, uvs（f32 × 2n）, indices（u32 × m）, opacity（f32）, blendMode（u32）,
// マスク（u32。0: なし、1: マスク、2: 反転）, マスク元の数 k と partId の番号（u32 × k）
//
// テクスチャ（'SPT1'）: magic, 足す数 u32, それぞれ 番号・種類（0: PNG、1: 乗算していない RGBA8）・幅・高さ・
// バイト数（u32）とバイト列（4 バイトの境界まで 0 で埋める）, 消す数 u32, 消す番号（u32 × 数）
import type { DeformedModel, ViewTransform } from '@app/contracts';
import type { BlendMode } from '@app/schema';

export const FRAME_MAGIC = 0x31465053; // 'SPF1'
export const TEXTURES_MAGIC = 0x31545053; // 'SPT1'
export const NO_TEXTURE = 0xffffffff;

const BLEND_CODE: Record<BlendMode, number> = { normal: 0, multiply: 1, screen: 2, add: 3 };

export type WireBackground =
  | { type: 'transparent' }
  | { type: 'color'; rgba: readonly [number, number, number, number] } // 乗算していない 0..1
  | { type: 'image'; texture: number };

export type WireTexture =
  | { id: number; kind: 'png'; bytes: Uint8Array }
  | { id: number; kind: 'rgba'; width: number; height: number; bytes: Uint8Array }; // 乗算していない

// 文字列（partId・assetId など）に番号を振る。消した番号は使い回さない（古いフレームと取り違えない）
export class IdTable {
  private readonly ids = new Map<string, number>();
  private next = 0;

  get(key: string): number | undefined {
    return this.ids.get(key);
  }

  ensure(key: string): number {
    let id = this.ids.get(key);
    if (id === undefined) {
      id = this.next++;
      this.ids.set(key, id);
    }
    return id;
  }

  delete(key: string): number | undefined {
    const id = this.ids.get(key);
    this.ids.delete(key);
    return id;
  }

  allocate(): number {
    return this.next++;
  }
}

export interface FrameIds {
  part(partId: string): number;
  texture(assetId: string): number | undefined; // 送っていない素材は undefined（描かない）
}

const vertexCount = (positions: Float32Array, uvs: Float32Array) => Math.min(positions.length, uvs.length) >> 1;

export function encodeFrame(
  model: DeformedModel,
  view: ViewTransform,
  background: WireBackground,
  ids: FrameIds,
): Uint8Array {
  let size = 4 + 12 + 4 + (background.type === 'color' ? 16 : background.type === 'image' ? 4 : 0) + 4;
  for (const item of model.items) {
    const n = vertexCount(item.positions, item.uvs);
    size += 16 + n * 16 + item.indices.length * 4 + 16 + (item.mask ? item.mask.sourcePartIds.length * 4 : 0);
  }
  const buffer = new ArrayBuffer(size);
  const out = new DataView(buffer);
  let at = 0;
  const u32 = (v: number) => {
    out.setUint32(at, v, true);
    at += 4;
  };
  const f32 = (v: number) => {
    out.setFloat32(at, v, true);
    at += 4;
  };
  u32(FRAME_MAGIC);
  f32(view.scale);
  f32(view.offset.x);
  f32(view.offset.y);
  if (background.type === 'color') {
    u32(1);
    for (const c of background.rgba) f32(c);
  } else if (background.type === 'image') {
    u32(2);
    u32(background.texture);
  } else {
    u32(0);
  }
  u32(model.items.length);
  for (const item of model.items) {
    const n = vertexCount(item.positions, item.uvs);
    u32(ids.part(item.partId));
    u32(ids.texture(item.assetId) ?? NO_TEXTURE);
    u32(n);
    u32(item.indices.length);
    at = copyFloats(out, at, item.positions, 2 * n);
    at = copyFloats(out, at, item.uvs, 2 * n);
    for (let i = 0; i < item.indices.length; i++) u32(item.indices[i]!);
    f32(item.opacity);
    u32(BLEND_CODE[item.blendMode] ?? 0);
    if (item.mask) {
      u32(item.mask.inverted ? 2 : 1);
      u32(item.mask.sourcePartIds.length);
      for (const id of item.mask.sourcePartIds) u32(ids.part(id));
    } else {
      u32(0);
      u32(0);
    }
  }
  return new Uint8Array(buffer);
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

// 型付き配列はまとめて写す（値はすべて 4 バイトなので境界はそろっている）。ビッグエンディアンの環境だけ1つずつ書く
function copyFloats(out: DataView, at: number, src: Float32Array, count: number): number {
  if (LITTLE_ENDIAN) {
    new Float32Array(out.buffer, at, count).set(src.subarray(0, count));
  } else {
    for (let i = 0; i < count; i++) out.setFloat32(at + i * 4, src[i]!, true);
  }
  return at + count * 4;
}

const pad4 = (n: number) => (4 - (n % 4)) % 4;

export function encodeTextures(upserts: readonly WireTexture[], removals: readonly number[]): Uint8Array {
  let size = 4 + 4 + 4 + removals.length * 4;
  for (const t of upserts) size += 20 + t.bytes.length + pad4(t.bytes.length);
  const bytes = new Uint8Array(size);
  const out = new DataView(bytes.buffer);
  let at = 0;
  const u32 = (v: number) => {
    out.setUint32(at, v, true);
    at += 4;
  };
  u32(TEXTURES_MAGIC);
  u32(upserts.length);
  for (const t of upserts) {
    u32(t.id);
    u32(t.kind === 'png' ? 0 : 1);
    u32(t.kind === 'rgba' ? t.width : 0);
    u32(t.kind === 'rgba' ? t.height : 0);
    u32(t.bytes.length);
    bytes.set(t.bytes, at);
    at += t.bytes.length + pad4(t.bytes.length);
  }
  u32(removals.length);
  for (const id of removals) u32(id);
  return bytes;
}
