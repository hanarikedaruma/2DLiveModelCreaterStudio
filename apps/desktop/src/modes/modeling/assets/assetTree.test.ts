import { describe, expect, it } from 'vitest';
import { makeAsset } from '../structure/testing';
import { buildAssetTree, type AssetTreeNode } from './assetTree';

// 確かめやすい形にする
function shape(nodes: AssetTreeNode[]): unknown[] {
  return nodes.map((n) => (n.kind === 'asset' ? n.asset.id : { [n.name]: shape(n.children) }));
}

describe('buildAssetTree', () => {
  it('PSD はファイルとグループ（layerPath）ごとのフォルダ、PNG は根に並べる', () => {
    const tree = buildAssetTree([
      makeAsset('png1'),
      makeAsset('a', { source: { kind: 'psd', file: 'm.psd', layerName: 'a', layerPath: ['頭', '目'] } }),
      makeAsset('b', { source: { kind: 'psd', file: 'm.psd', layerName: 'b', layerPath: ['頭'] } }),
      makeAsset('c', { source: { kind: 'psd', file: 'm.psd', layerName: 'c', layerPath: ['頭', '目'] } }),
      makeAsset('d', { source: { kind: 'psd', file: 'm.psd', layerName: 'd' } }),
      makeAsset('e', { source: { kind: 'psd', file: 'n.psd', layerName: 'e', layerPath: ['頭'] } }),
    ]);
    expect(shape(tree)).toEqual([
      'png1',
      { 'm.psd': [{ 頭: [{ 目: ['a', 'c'] }, 'b'] }, 'd'] },
      { 'n.psd': [{ 頭: ['e'] }] },
    ]);
  });

  it('名前に / があっても別のフォルダとして扱う', () => {
    const tree = buildAssetTree([
      makeAsset('a', { source: { kind: 'psd', file: 'm.psd', layerPath: ['a/b'] } }),
      makeAsset('b', { source: { kind: 'psd', file: 'm.psd', layerPath: ['a', 'b'] } }),
    ]);
    expect(shape(tree)).toEqual([{ 'm.psd': [{ 'a/b': ['a'] }, { a: [{ b: ['b'] }] }] }]);
  });
});
