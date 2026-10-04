// PSD の再読み込み（カード43）。直した PSD を最初の取り込みと同じ処理（トリミング・クリッピングの統合・警告）で読み、
// 前に取り込んだ素材とレイヤーを対応させる。素材やパーツの書き換えは画面の側（コマンド）で行う
import type { Asset } from '@app/schema';
import type { ImportWarning, ImportedAsset, Importer } from '@app/contracts';
import { createImporter, type ImportFile } from './importer';
import { hasPsdSignature } from './psd';

// レイヤーを見分ける鍵（グループの道筋とレイヤー名）
export function layerKey(asset: Asset): string {
  return JSON.stringify([asset.source.layerPath ?? [], asset.source.layerName ?? null]);
}

export interface LayerMatch<O extends Asset = Asset, N extends Asset = Asset> {
  pairs: { old: O; next: N }[]; // 対応したもの（新しい側の順）
  added: N[]; // 新しいレイヤー
  missing: O[]; // 無くなったレイヤー（元の順）
}

// layerPath と layerName が同じものを対応させる。同じ名前が重なるときは、それぞれの元の順番どうしで対応させる
export function matchLayers<O extends Asset, N extends Asset>(
  oldAssets: readonly O[],
  newAssets: readonly N[],
): LayerMatch<O, N> {
  const queues = new Map<string, O[]>();
  for (const asset of oldAssets) {
    const key = layerKey(asset);
    const queue = queues.get(key);
    if (queue) queue.push(asset);
    else queues.set(key, [asset]);
  }
  const pairs: LayerMatch<O, N>['pairs'] = [];
  const added: N[] = [];
  const used = new Set<O>();
  for (const next of newAssets) {
    const old = queues.get(layerKey(next))?.shift();
    if (old) {
      pairs.push({ old, next });
      used.add(old);
    } else {
      added.push(next);
    }
  }
  return { pairs, added, missing: oldAssets.filter((a) => !used.has(a)) };
}

// 取り込んだ PSD のファイル名（素材の並びの順、重なりなし）
export function psdSourceFiles(assets: readonly Asset[]): string[] {
  return [...new Set(assets.filter((a) => a.source.kind === 'psd').map((a) => a.source.file))];
}

// その PSD から取り込んだ素材
export function assetsFromPsd(assets: readonly Asset[], file: string): Asset[] {
  return assets.filter((a) => a.source.kind === 'psd' && a.source.file === file);
}

// unchanged: 画素も位置も同じ / image: 大きさと位置が同じで画素が違う / moved: 大きさが同じで位置が違う / resized: 大きさが違う
export type LayerChange = 'unchanged' | 'image' | 'moved' | 'resized';

export function layerChange(old: Asset, next: Asset): LayerChange {
  if (old.width !== next.width || old.height !== next.height) return 'resized';
  if (old.offset.x !== next.offset.x || old.offset.y !== next.offset.y) return 'moved';
  return old.hash === next.hash ? 'unchanged' : 'image';
}

export interface ReloadedLayer {
  old: Asset;
  // 新しい素材。unchanged なら old の id・path・画素のまま、ファイル名・非表示・合成モード・不透明度などだけを新しくしたもの
  next: Asset;
  png: Uint8Array; // next の PNG（トリミング済み）
  change: LayerChange;
}

export interface PsdReloadPlan {
  file: string; // 読み込み直したファイルの名前
  layers: ReloadedLayer[]; // 対応したレイヤー
  added: ImportedAsset[]; // 新しいレイヤー（トレイに足す）
  missing: Asset[]; // PSD から無くなったレイヤーの素材（消さない）
  warnings: ImportWarning[]; // 取り込みの警告（assetIds は使う側の id）。キャンバスの大きさが前と違えば canvasMismatch も足す
}

// oldAssets は、読み込み直す PSD から前に取り込んだ素材（assetsFromPsd で選ぶ）。PSD でなければ例外
export async function planPsdReload(
  file: ImportFile,
  oldAssets: readonly Asset[],
  importer: Importer = createImporter(),
): Promise<PsdReloadPlan> {
  if (!hasPsdSignature(file.data)) throw new Error(`PSD ではないので読み込み直せない: ${file.name}`);
  const { assets, warnings } = await importer.importFiles([file]);
  const pngOf = new Map(assets.map((a) => [a.asset.id, a.png]));
  const match = matchLayers(
    oldAssets,
    assets.map((a) => a.asset),
  );

  const usedId = new Map<string, string>(); // 取り込みで付いた id → 使う id
  const layers = match.pairs.map(({ old, next }): ReloadedLayer => {
    const change = layerChange(old, next);
    const png = pngOf.get(next.id)!;
    if (change !== 'unchanged') return { old, next, png, change };
    usedId.set(next.id, old.id);
    const refreshed: Asset = {
      ...old,
      canvasSize: { ...next.canvasSize },
      source: next.source,
      sourceBlendMode: next.sourceBlendMode,
      sourceOpacity: next.sourceOpacity,
    };
    return { old, next: refreshed, png, change };
  });
  const added = match.added.map((asset) => ({ asset, png: pngOf.get(asset.id)! }));

  const out: ImportWarning[] = warnings.map((w) => ({ ...w, assetIds: w.assetIds.map((id) => usedId.get(id) ?? id) }));
  const before = oldAssets[0]?.canvasSize;
  const after = assets[0]?.asset.canvasSize;
  if (before && after && (before.width !== after.width || before.height !== after.height)) {
    out.unshift({
      kind: 'canvasMismatch',
      assetIds: [...layers.map((l) => l.next.id), ...added.map((a) => a.asset.id)],
      layerNames: [file.name],
      message:
        `${file.name} のキャンバスの大きさ（${after.width}×${after.height}）が前の取り込み（${before.width}×${before.height}）と違う。` +
        '位置がずれている可能性がある',
    });
  }
  return { file: file.name, layers, added, missing: match.missing, warnings: out };
}
