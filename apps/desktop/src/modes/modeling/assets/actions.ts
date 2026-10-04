// services を使う操作（取り込み・割り当て・かんたんセットアップ）。コマンドは store を通すので、どれも Undo できる
import type { Asset } from '@app/schema';
import type { ImportWarning, Services } from '@app/contracts';
import { addAssets, assign, findAssignment, findSlotPart, type MeshData, type SlotTarget } from './commands';
import { importWarningsOf } from './warnings';

export type Density = 'light' | 'standard' | 'smooth';

// File（Blob）の中身を読む。jsdom の Blob には arrayBuffer が無いので FileReader でも読めるようにする
export async function readFileBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('ファイルを読めない'));
    reader.readAsArrayBuffer(file);
  });
}

// importer.importFiles → assets.put で PNG を登録 → コマンド addAssets。警告は services ごとに覚える
export async function importAssetFiles(
  services: Services,
  files: { name: string; data: Uint8Array }[],
): Promise<{ added: Asset[]; warnings: ImportWarning[] }> {
  const { assets, warnings } = await services.importer.importFiles(files);
  await Promise.all(assets.map((a) => services.assets.put(a.asset.id, a.png)));
  const added = assets.map((a) => a.asset);
  if (added.length > 0) services.store.dispatch(addAssets(added));
  importWarningsOf(services).set(warnings);
  return { added, warnings };
}

// 画面から取り込む。結果を通知で知らせる
export async function importFromFiles(
  services: Services,
  notify: (message: string) => void,
  files: readonly File[],
): Promise<void> {
  if (files.length === 0) return;
  try {
    const read = await Promise.all(files.map(async (f) => ({ name: f.name, data: await readFileBytes(f) })));
    const { added, warnings } = await importAssetFiles(services, read);
    if (added.length === 0) notify('取り込める素材が無かった');
    else notify(`素材を ${added.length} 個取り込んだ`);
    if (warnings.length > 0) notify('取り込みの警告がある。素材トレイの一覧を確認してください');
  } catch (e) {
    notify(`取り込めない: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// 素材の ImageData からメッシュを作る。素材か画像が無ければ null
export function meshForAsset(services: Services, assetId: string, density: Density = 'standard'): MeshData | null {
  const asset = services.store.get().assets.find((a) => a.id === assetId);
  const imageData = services.assets.getImageData(assetId);
  if (!asset || !imageData) return null;
  return services.meshGenerator.generate(imageData, asset.offset, density);
}

// ドロップで枠に入れる。ほかの枠に入っていた素材があれば「付け替え」になる
export function assignAssets(services: Services, target: SlotTarget, assetIds: readonly string[]): void {
  const { model } = services.store.get();
  const slot = findSlotPart(model, target);
  const moves = assetIds.some((id) => {
    const current = findAssignment(model, id);
    return current !== null && current.slot.id !== slot?.id;
  });
  const items = assetIds.map((assetId) => ({ assetId, mesh: meshForAsset(services, assetId) }));
  services.store.dispatch(assign(target, items, { label: moves ? '割り当ての付け替え' : '割り当て' }));
}

// [かんたんセットアップ]: plan の command を transaction で実行し、warnings を通知で出す
export function runAutoSetup(services: Services, notify: (message: string) => void): void {
  const { command, warnings } = services.autoSetup.plan(services.store.get());
  services.store.transaction('かんたんセットアップ', (dispatch) => dispatch(command));
  for (const w of warnings) notify(w);
}
