// PSD の再読み込み（カード43）の操作。取り込み（services.importer）→ レイヤーの対応 → PNG の登録 → メッシュの作り直し →
// 1つの transaction（1回の Undo）。結果（更新・追加・見つからない）を返す
import type { Asset, Project } from '@app/schema';
import type { Command, Services } from '@app/contracts';
import { assetsFromPsd, hasOpaquePixelsOutsideMesh, planPsdReload, type LayerChange } from '@app/io';
import { densityOf, generateShape, regenerateOutcome, type ReshapeDialogs } from '../../mesh/remesh';
import { vertexKeyCount } from '../../mesh/meshOps';
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
  uncovered?: ReloadedItem[]; // 旧メッシュの外に描き足された画素がある素材
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
  const uncovered: ReloadedItem[] = [];
  for (const layer of changed) {
    const parts = imageParts(project, layer.old.id);
    if (parts.length === 0) continue;
    const alpha = services.assets.getImageData(layer.next.id);
    if (layer.change !== 'resized') {
      const exposed = parts.some((part) => {
        const mesh = project.model.meshes.find((mesh) => mesh.id === part.meshId);
        if (!mesh || !alpha) return false;
        const delta = { x: layer.next.offset.x - layer.old.offset.x, y: layer.next.offset.y - layer.old.offset.y };
        const moved =
          layer.change === 'moved'
            ? { ...mesh, vertices: mesh.vertices.map((v) => ({ x: v.x + delta.x, y: v.y + delta.y })) }
            : mesh;
        return hasOpaquePixelsOutsideMesh(alpha, layer.next.offset, moved);
      });
      if (exposed) uncovered.push(item(project, layer.old, layer.next.id));
      continue;
    }
    for (const part of parts) {
      if (!alpha) return { ok: false, error: `素材の画像を読み込めなかった: ${layerNameOf(layer.next)}` };
      const density = densityOf(project.model.meshes.find((m) => m.id === part.meshId));
      meshes[part.id] = { ...services.meshGenerator.generate(alpha, layer.next.offset, density), density };
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
      ...(uncovered.length > 0 ? { uncovered } : {}),
    },
  };
}

// 結果の一覧から、描き足した所のメッシュをまとめて作り直す。形とキーの転写を1回の Undo にする。
export async function rebuildReloadMeshes(
  services: Services,
  dialogs: ReshapeDialogs,
  assetIds: readonly string[],
): Promise<boolean> {
  const before = services.store.get();
  const wanted = new Set(assetIds);
  const parts = before.model.parts.filter((part) => part.kind === 'image' && part.assetId && wanted.has(part.assetId));
  if (parts.length === 0) return false;
  const keyed = parts.some((part) => part.meshId && vertexKeyCount(before.model, part.meshId) > 0);
  if (
    !(await dialogs.confirm(
      `メッシュを ${parts.length} パーツ分まとめて作り直します。${keyed ? '変形のキーを新しいメッシュへ移します。' : ''}手で編集したメッシュの形は置き換わります。`,
    ))
  )
    return false;
  if (services.store.get() !== before) {
    dialogs.notify('確認中にプロジェクトが変わりました。もう一度読み込み直してください');
    return false;
  }
  const commands: Command[] = [];
  const done = new Set<string>();
  for (const part of parts) {
    if (part.meshId && done.has(part.meshId)) continue;
    if (part.meshId) done.add(part.meshId);
    const density = densityOf(before.model.meshes.find((mesh) => mesh.id === part.meshId));
    const generated = generateShape(services, before, part.id, density);
    if (!generated.ok) {
      dialogs.notify(generated.error);
      return false;
    }
    const outcome = regenerateOutcome(part.id, generated.shape, density, 'PSD の描き足しのメッシュ作り直し')(before);
    if (!outcome.ok) {
      dialogs.notify(outcome.error);
      return false;
    }
    commands.push(outcome.command);
  }
  services.store.transaction('PSD の描き足しのメッシュ作り直し', (dispatch) => {
    for (const command of commands) dispatch(command);
  });
  return true;
}
