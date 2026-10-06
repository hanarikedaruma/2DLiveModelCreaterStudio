// 素材トレイの「欠けた素材」（STEP3 のカード58・I-056）。開いたときにファイルが無く、透明な画像の代わりで
// 開いた素材があるときだけ出す。PNG か PSD を選んで差し替える（PSD は元のレイヤー名と同じレイヤー、無ければ選ぶ）
import { useEffect, useReducer, useState } from 'react';
import type { ImportedAsset } from '@app/contracts';
import type { Asset, Project } from '@app/schema';
import { useDialogs, useProject, useServices } from '../shell/api';
import type { ProjectActions } from './actions';

export const MISSING_ASSETS_SECTION_ID = 'project.missingAssets';
export const ACCEPT_REPLACEMENT = '.png,.psd,image/png,image/vnd.adobe.photoshop';

let currentActions: ProjectActions | null = null;
export function setMissingAssetsActions(actions: ProjectActions | null): void {
  currentActions = actions;
}

// 素材を使っているパーツの名前
function partNamesOf(project: Project, assetId: string): string[] {
  return project.model.parts.filter((p) => p.assetId === assetId).map((p) => p.name);
}

// arrayBuffer が無い環境（テストの jsdom など）では FileReader で読む
async function readBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('ファイルを読めない'));
    reader.readAsArrayBuffer(file);
  });
}

function sourceText(asset: Asset): string {
  return asset.source.layerName ? `${asset.source.file} の「${asset.source.layerName}」` : asset.source.file;
}

interface Pending {
  assetId: string;
  candidates: ImportedAsset[];
}

export function MissingAssetsSection() {
  const project = useProject();
  const services = useServices();
  const dialogs = useDialogs();
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [choice, setChoice] = useState(0);
  const actions = currentActions;
  useEffect(() => actions?.subscribe(refresh), [actions]);
  if (!actions) return null;
  const missingIds = actions.missingAssetIds();
  if (missingIds.length === 0) return null;

  async function replace(old: Asset, imported: ImportedAsset) {
    const a = imported.asset;
    if (a.canvasSize.width !== old.canvasSize.width || a.canvasSize.height !== old.canvasSize.height) {
      const ok = await dialogs.confirm(
        `キャンバスの大きさが元と違います（元 ${old.canvasSize.width}×${old.canvasSize.height}、選んだもの ${a.canvasSize.width}×${a.canvasSize.height}）。差し替えますか？`,
      );
      if (!ok) return;
    }
    await actions!.replaceMissingAsset(old.id, imported);
  }

  async function pick(old: Asset, file: File) {
    let found: ImportedAsset[];
    try {
      const data = await readBytes(file);
      found = (await services.importer.importFiles([{ name: file.name, data }])).assets;
    } catch (e) {
      dialogs.notify(`読めなかった: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (found.length === 0) {
      dialogs.notify(`${file.name} に使える画像が無い`);
      return;
    }
    const sameLayer = found.filter((f) => old.source.layerName && f.asset.source.layerName === old.source.layerName);
    if (found.length === 1 || sameLayer.length === 1) {
      await replace(old, sameLayer[0] ?? found[0]!);
      return;
    }
    setChoice(0);
    setPending({ assetId: old.id, candidates: found });
  }

  return (
    <section className="missing-assets" aria-label="欠けた素材">
      <p>
        <strong>欠けた素材</strong> {missingIds.length} 個
        <span className="am-dim">（ファイルが無いので透明な画像の代わりで開いた）</span>
      </p>
      <ul>
        {missingIds.map((id) => {
          const asset = project.assets.find((a) => a.id === id)!;
          const parts = partNamesOf(project, id);
          return (
            <li key={id} data-asset-id={id}>
              <span>{parts.length > 0 ? parts.join('・') : '（パーツ無し）'}</span>
              <span className="am-dim">：{sourceText(asset)}</span>
              {pending?.assetId === id ? (
                <span>
                  <select
                    aria-label="差し替えるレイヤー"
                    value={choice}
                    onChange={(e) => setChoice(Number(e.target.value))}
                  >
                    {pending.candidates.map((c, i) => (
                      <option key={c.asset.id} value={i}>
                        {c.asset.source.layerName ?? c.asset.source.file}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const chosen = pending.candidates[choice];
                      setPending(null);
                      if (chosen) void replace(asset, chosen);
                    }}
                  >
                    差し替える
                  </button>
                  <button type="button" onClick={() => setPending(null)}>
                    やめる
                  </button>
                </span>
              ) : (
                <label className="missing-assets-pick">
                  差し替える…
                  <input
                    type="file"
                    accept={ACCEPT_REPLACEMENT}
                    aria-label={`${parts.join('・') || sourceText(asset)} を差し替えるファイル`}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void pick(asset, file);
                    }}
                  />
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
