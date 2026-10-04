// JS と Rust で同じバイナリを読み書きできるかを確かめる見本（wire.test.ts と src-tauri/src/output/frame.rs のテストが使う）。
// 中身を変えたら write-wire-sample.ts で testdata のファイルを書き直し、Rust のテストの期待値も直す
import type { DeformedModel, DrawItem } from '@app/contracts';
import { encodeFrame, encodeTextures, IdTable } from '../wire';

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

export function sampleModel(): DeformedModel {
  const items = [
    item('face', 'a-face', { opacity: 0.75 }),
    item('eyeL', 'a-eye', {
      positions: new Float32Array([1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 99]), // uvs より長い分は送らない
      blendMode: 'screen',
      mask: { sourcePartIds: ['face', 'eyeWhite'], inverted: true },
    }),
    item('hidden', 'a-missing', { blendMode: 'add' }),
  ];
  return { items, byPartId: Object.fromEntries(items.map((i) => [i.partId, i])) };
}

// partId は出てきた順に 0, 1, …、素材は a-face が 0、a-eye が 1（a-missing は送っていない）
export function sampleIds() {
  const parts = new IdTable();
  const textures = new IdTable();
  textures.ensure('a-face');
  textures.ensure('a-eye');
  return { part: (id: string) => parts.ensure(id), texture: (id: string) => textures.get(id) };
}

export function wireSample(): { frame: Uint8Array; textures: Uint8Array } {
  const frame = encodeFrame(
    sampleModel(),
    { scale: 2, offset: { x: 10, y: -5 } },
    { type: 'color', rgba: [1, 0.5, 0, 1] },
    sampleIds(),
  );
  const textures = encodeTextures(
    [
      { id: 0, kind: 'png', bytes: new Uint8Array([137, 80, 78, 71, 13]) },
      { id: 5, kind: 'rgba', width: 2, height: 1, bytes: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128]) },
    ],
    [1],
  );
  return { frame, textures };
}
