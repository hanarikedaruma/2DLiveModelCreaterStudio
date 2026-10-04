// PSD の再読み込み（カード43）の操作。取り込み（services.importer）→ レイヤーの対応 → PNG の登録 → メッシュの作り直し →
// 1つの transaction（1回の Undo）。結果（更新・追加・見つからない）を返す
import type { Asset, Project } from '@app/schema';
import type { Services } from '@app/contracts';
import { assetsFromPsd, planPsdReload, type LayerChange } from '@app/io';
import { densityOf } from '../../mesh/remesh';
import type { RebuiltMesh } from '../../structure/replaceAsset';
import { layerNameOf } from '../commands';
import { importWarningsOf } from '../warnings';
import { RELOAD_LABEL, reloadPsdCommand } from './commands';

export interface ReloadedItem {
  assetId: string; // 再読み込みのあとの素材の id
  name: string;
  parts: number; // その素材を使う画像パーツの数
}

export interface ReloadSummary {
  file: string;
  updated: (ReloadedItem & { change: Exclude<LayerChange, 'unchanged'> })[];
  unchanged: number;
  added: ReloadedItem[];
  missing: ReloadedItem[]; // 素材とパーツは消さない
  warnings: number;
}

export type ReloadOutcome = { ok: true; summary: ReloadSummary } | { ok: false; error: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function imageParts(project: Project, assetId: string) {
  return project.model.parts.filter((p) => p.kind === 'image' && p.assetId === assetId);
}

function item(project: Project, asset: Asset, assetId = asset.id): ReloadedItem {
  return { assetId, name: layerNameOf(asset), parts: imageParts(project, asset.id).length };
}

// sourceFile は読み込み直す PSD（前に取り込んだときのファイル名）。file は選び直した PSD
export async function reloadPsd(
  services: Services,
  file: { name: string; data: Uint8Array },
  sourceFile: string,
): Promise<ReloadOutcome> {
  const olds = assetsFromPsd(services.store.get().assets, sourceFile);
  if (olds.length === 0) return { ok: false, error: `${sourceFile} から取り込んだ素材が無い` };
  let plan: Awaited<ReturnType<typeof planPsdReload>>;
  try {
    plan = await planPsdReload(file, olds, services.importer);
  } catch (e) {
    return { ok: false, error: `読み込み直せない: ${errorText(e)}` };
  }
  if (plan.layers.length === 0) {
    return {
      ok: false,
      error: `${file.name} には ${sourceFile} と同じレイヤーが無い（別の PSD かもしれない。新しく取り込むなら [素材を追加]）`,
    };
  }

  const changed = plan.layers.filter((l) => l.change !== 'unchanged');
  await Promise.all([
    ...changed.map((l) => services.assets.put(l.next.id, l.png)),
    ...plan.added.map((a) => services.assets.put(a.asset.id, a.png)),
  ]);

  // ここから先は await しない（メッシュを作ったプロジェクトのまま、すぐにコマンドを入れる）
  const project = services.store.get();
  const meshes: Record<string, RebuiltMesh> = {};
  for (const layer of changed) {
    if (layer.change !== 'resized') continue;
    for (const part of imageParts(project, layer.old.id)) {
      const imageData = services.assets.getImageData(layer.next.id);
      if (!imageData) return { ok: false, error: `素材の画像を読み込めなかった: ${layerNameOf(layer.next)}` };
      const density = densityOf(project.model.meshes.find((m) => m.id === part.meshId));
      meshes[part.id] = { ...services.meshGenerator.generate(imageData, layer.next.offset, density), density };
    }
  }
  services.store.transaction(RELOAD_LABEL, (dispatch) =>
    dispatch(
      reloadPsdCommand({
        updates: plan.layers.map((l) => ({ oldId: l.old.id, next: l.next, change: l.change })),
        added: plan.added.map((a) => a.asset),
        meshes,
      }),
    ),
  );
  importWarningsOf(services).set(plan.warnings);

  return {
    ok: true,
    summary: {
      file: plan.file,
      updated: changed.map((l) => ({
        ...item(project, l.old, l.next.id),
        change: l.change as Exclude<LayerChange, 'unchanged'>,
      })),
      unchanged: plan.layers.length - changed.length,
      added: plan.added.map((a) => ({ assetId: a.asset.id, name: layerNameOf(a.asset), parts: 0 })),
      missing: plan.missing.map((a) => item(project, a)),
      warnings: plan.warnings.length,
    },
  };
}
