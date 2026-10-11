// PSD の再読み込み（カード43）のコマンド（純粋関数）。対応した素材をまとめて新しくし、新しいレイヤーをトレイに足す。
// 変わった素材は新しい id の素材に置き換える（PNG は assets.put 済み）。同じ id のまま画素を替えると、
// Undo で project は戻っても素材の置き場の PNG が戻らないため。前の素材の PNG は置き場に残るので、Undo で元の絵に戻る
import type { Asset, Project, Vec2 } from '@app/schema';
import type { Command } from '@app/contracts';
import type { LayerChange } from '@app/io';
import { replaceAssetCommand, type RebuiltMesh } from '../../structure/replaceAsset';

export const RELOAD_LABEL = 'PSD の再読み込み';

export interface AssetUpdate {
  oldId: string;
  next: Asset; // unchanged なら oldId と同じ id（ファイル名などの記録だけ新しくしたもの）
  change: LayerChange;
}

export interface ReloadInput {
  updates: readonly AssetUpdate[];
  added: readonly Asset[]; // 新しいレイヤー（トレイの最後に足す）
  // 大きさの変わった素材を使う画像パーツの id → その素材から作り直したメッシュ（作れなかったら null でメッシュを外す）
  meshes: Readonly<Record<string, RebuiltMesh | null>>;
}

// 素材を差し替えた画像パーツの扱い:
// - image（大きさも位置も同じ）: assetId だけを替える（メッシュとキーはそのまま）
// - moved（大きさが同じで位置が違う）: assetId を替え、メッシュと回転中心を同じだけずらす（形とキーはそのまま）
// - resized（大きさが違う）: 新しい素材の位置でメッシュを作り直し、頂点のキーを転写する（カード28 の replaceAssetCommand）
// パーツの合成モードが前の PSD のレイヤーのままなら、新しいレイヤーの合成モードに合わせる（カード32 の引き継ぎ）
export function reloadPsdCommand(input: ReloadInput, options: { newId?: () => string } = {}): Command {
  return {
    label: RELOAD_LABEL,
    apply(project) {
      const present = new Map(project.assets.map((a) => [a.id, a]));
      const updates = new Map(input.updates.filter((u) => present.has(u.oldId)).map((u) => [u.oldId, u]));
      const added = input.added.filter((a) => !present.has(a.id));
      if (updates.size === 0 && added.length === 0) return project;

      // replaceAssetCommand は project.assets から差し替え先を探すので、新しい素材を先に足しておく
      const incoming = [...updates.values()].filter((u) => u.next.id !== u.oldId && !present.has(u.next.id));
      let p: Project = { ...project, assets: [...project.assets, ...incoming.map((u) => u.next)] };
      const shifted = new Set<string>();
      for (const part of project.model.parts) {
        if (part.kind !== 'image' || part.assetId === null) continue;
        const update = updates.get(part.assetId);
        const old = present.get(part.assetId);
        if (!update || !old) continue;
        if (update.next.id !== old.id) {
          const mesh = update.change === 'resized' ? (input.meshes[part.id] ?? null) : null;
          p = replaceAssetCommand(part.id, update.next.id, mesh, options).apply(p);
          if (update.change === 'resized') p = remapContourLines(p, part.id, old, update.next);
          if (update.change === 'moved') {
            const delta = offsetDelta(old, update.next);
            p = shiftMesh(p, part.meshId, delta, shifted);
            p = {
              ...p,
              model: {
                ...p.model,
                parts: p.model.parts.map((item) =>
                  item.id === part.id
                    ? {
                        ...item,
                        pivot: { x: item.pivot.x + delta.x, y: item.pivot.y + delta.y },
                      }
                    : item,
                ),
              },
            };
          }
        }
        if (part.blendMode === old.sourceBlendMode && update.next.sourceBlendMode !== old.sourceBlendMode) {
          p = setBlendMode(p, part.id, update.next.sourceBlendMode);
        }
      }
      // 素材の並びは保つ（置き換えたものは同じ場所に、新しいものは最後に）
      const assets = [...project.assets.map((a) => updates.get(a.id)?.next ?? a), ...added];
      return { ...p, assets };
    },
  };
}

// 輪郭線（I-068）の点は画像の中の位置（UV）なので、大きさの変わった素材では、キャンバス上の同じ位置になるように直す
function remapContourLines(project: Project, partId: string, old: Asset, next: Asset): Project {
  const lines = project.model.contourLines;
  if (!lines?.some((l) => l.partId === partId) || next.width <= 0 || next.height <= 0) return project;
  const remap = (uv: Vec2): Vec2 => ({
    x: (uv.x * old.width + old.offset.x - next.offset.x) / next.width,
    y: (uv.y * old.height + old.offset.y - next.offset.y) / next.height,
  });
  return {
    ...project,
    model: {
      ...project.model,
      contourLines: lines.map((l) => (l.partId === partId ? { ...l, points: l.points.map(remap) } : l)),
    },
  };
}

function offsetDelta(old: Asset, next: Asset): Vec2 {
  return { x: next.offset.x - old.offset.x, y: next.offset.y - old.offset.y };
}

// メッシュの基準状態の頂点をずらす（同じメッシュは1回だけ）
function shiftMesh(project: Project, meshId: string | null, d: Vec2, done: Set<string>): Project {
  if (meshId === null || done.has(meshId) || (d.x === 0 && d.y === 0)) return project;
  done.add(meshId);
  const { model } = project;
  if (!model.meshes.some((m) => m.id === meshId)) return project;
  const meshes = model.meshes.map((m) =>
    m.id === meshId ? { ...m, vertices: m.vertices.map((v) => ({ x: v.x + d.x, y: v.y + d.y })) } : m,
  );
  return { ...project, model: { ...model, meshes } };
}

function setBlendMode(project: Project, partId: string, blendMode: Asset['sourceBlendMode']): Project {
  const { model } = project;
  const parts = model.parts.map((p) => (p.id === partId ? { ...p, blendMode } : p));
  return { ...project, model: { ...model, parts } };
}
