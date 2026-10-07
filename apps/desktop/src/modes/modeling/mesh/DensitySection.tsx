// 「パーツの設定」の変形の細かさのセクション（カード28）。画像パーツを1つ選んだときに 軽い / 標準 / なめらか を選ぶ。
// 選ぶとその細かさでメッシュを作り直し、変形（頂点のキー）を新しいメッシュへ移す
import { useId, useState, type FC } from 'react';
import type { Project, Vec2 } from '@app/schema';
import { transferPointDeltas } from '@app/core';
import { useCanvas, useDialogs, useEditor, useProject, useServices } from '../../../shell/api';
import { partById } from '../canvas/parts';
import { DENSITY_OPTIONS, changeMeshDensity, generateShape, regenerateOutcome, type Density } from './remesh';
import './mesh.css';

// 全ての既存の頂点キーについて、元の頂点で新しい三角形の形を評価する。
// 表示する値はこの点群での最大値（将来の編集やキーの組合せの誤差を保証する値ではない）。
export function densityKeyError(before: Project, after: Project, meshId: string): { max: number; keys: number } {
  const old = before.model.meshes.find((m) => m.id === meshId);
  const next = after.model.meshes.find((m) => m.id === meshId);
  let max = 0;
  let keys = 0;
  if (!old || !next) return { max, keys };
  for (const binding of before.model.bindings) {
    if (binding.target.type !== 'mesh' || binding.target.id !== meshId || binding.channel !== 'vertices') continue;
    const moved = after.model.bindings.find((b) => b.id === binding.id);
    binding.keys.forEach((key, k) => {
      const delta = key.delta;
      const transferred = moved?.keys[k]?.delta;
      if (!Array.isArray(delta) || !Array.isArray(transferred)) return;
      keys++;
      const reconstructed = transferPointDeltas(
        next.vertices,
        next.triangles,
        old.vertices,
        next.vertices.map((p, i) => ({ x: p.x + (transferred[i]?.x ?? 0), y: p.y + (transferred[i]?.y ?? 0) })),
      );
      old.vertices.forEach((p, i) => {
        const d: Vec2 = delta[i] ?? { x: 0, y: 0 };
        const q = reconstructed[i]!;
        max = Math.max(max, Math.hypot(q.x - p.x - d.x, q.y - p.y - d.y));
      });
    });
  }
  return { max, keys };
}

export function makeDensitySection(editor: { clearSelection(): void }): FC {
  return function DensitySection() {
    const services = useServices();
    const dialogs = useDialogs();
    const project = useProject();
    const [state] = useEditor();
    const { requestRedraw } = useCanvas();
    const name = useId();
    const [busy, setBusy] = useState(false);

    const ids = state.selectedPartIds;
    const part = ids.length === 1 && ids[0] ? partById(project.model, ids[0]) : undefined;
    if (part?.kind !== 'image') return null;
    const mesh = part.meshId ? project.model.meshes.find((m) => m.id === part.meshId) : undefined;
    const current = mesh && mesh.density !== 'custom' ? mesh.density : null;

    const choose = async (density: Density) => {
      setBusy(true);
      try {
        if (density === 'light') {
          const start = services.store.get();
          const generated = generateShape(services, start, part.id, density);
          if (!generated.ok) {
            dialogs.notify(generated.error);
            return;
          }
          const outcome = regenerateOutcome(part.id, generated.shape, density, '変形の細かさの変更')(start);
          if (!outcome.ok) {
            dialogs.notify(outcome.error);
            return;
          }
          const after = outcome.command.apply(start);
          const error = outcome.meshId ? densityKeyError(start, after, outcome.meshId) : { max: 0, keys: 0 };
          const comparison =
            error.keys > 0
              ? `既存キーの元の頂点での最大ずれ: 約 ${error.max.toFixed(2)} px（${error.keys} キーを比較）`
              : '既存の頂点キーは無い（比較する変形は無い）';
          if (
            !(await dialogs.confirm(
              `「軽い」は細かい変形を表しにくい。${comparison}。変形を新しいメッシュへ移します。作り直しますか？`,
            ))
          )
            return;
          if (services.store.get() !== start) {
            dialogs.notify('確認中にモデルが変わった。もう一度「軽い」を選んでずれを確認する');
            return;
          }
          services.store.transaction('変形の細かさの変更', (dispatch) => dispatch(outcome.command));
          editor.clearSelection();
          requestRedraw();
          return;
        }
        // 頂点の番号が変わるので、メッシュ編集ツールの頂点の選択を外す
        if (await changeMeshDensity(services, dialogs, part.id, density)) {
          editor.clearSelection();
          requestRedraw();
        }
      } finally {
        setBusy(false);
      }
    };

    return (
      <div className="mesh-density">
        <span className="mesh-density-label">変形の細かさ</span>
        <div className="mesh-density-options" role="radiogroup" aria-label="変形の細かさ">
          {DENSITY_OPTIONS.map((o) => (
            <label key={o.density} className="mesh-density-option">
              <input
                type="radio"
                name={name}
                value={o.density}
                checked={current === o.density}
                disabled={busy}
                onChange={() => void choose(o.density)}
              />
              {o.label}
            </label>
          ))}
        </div>
        {!mesh ? (
          <p className="mesh-hint">選ぶと、その細かさでメッシュを作る</p>
        ) : mesh.edited ? (
          <p className="mesh-hint">手で編集したメッシュ。選ぶと作り直す（変形は新しいメッシュへ移す）</p>
        ) : null}
      </div>
    );
  };
}
