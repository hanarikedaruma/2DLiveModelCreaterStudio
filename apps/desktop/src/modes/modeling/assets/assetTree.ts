// 素材トレイの並び。PSD はファイルごとのフォルダの中に、グループ（layerPath）ごとのフォルダを作る。PNG は根に並べる
import type { Asset } from '@app/schema';

export type AssetTreeNode =
  { kind: 'folder'; key: string; name: string; children: AssetTreeNode[] } | { kind: 'asset'; asset: Asset };

type Folder = Extract<AssetTreeNode, { kind: 'folder' }>;

export function buildAssetTree(assets: readonly Asset[]): AssetTreeNode[] {
  const roots: AssetTreeNode[] = [];
  const folders = new Map<string, Folder>();
  const folderIn = (list: AssetTreeNode[], path: string[], name: string): Folder => {
    const key = JSON.stringify(path);
    let folder = folders.get(key);
    if (!folder) {
      folder = { kind: 'folder', key, name, children: [] };
      folders.set(key, folder);
      list.push(folder);
    }
    return folder;
  };
  for (const asset of assets) {
    if (asset.source.kind !== 'psd') {
      roots.push({ kind: 'asset', asset });
      continue;
    }
    const path = [asset.source.file];
    let folder = folderIn(roots, path, asset.source.file);
    for (const name of asset.source.layerPath ?? []) {
      path.push(name);
      folder = folderIn(folder.children, path, name);
    }
    folder.children.push({ kind: 'asset', asset });
  }
  return roots;
}
