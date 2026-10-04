// 「パーツの設定」の変形の細かさのセクション（カード28）。画像パーツを1つ選んだときに 軽い / 標準 / なめらか を選ぶ。
// 選ぶとその細かさでメッシュを作り直し、変形（頂点のキー）を新しいメッシュへ移す
import { useId, useState, type FC } from 'react';
import { useCanvas, useDialogs, useEditor, useProject, useServices } from '../../../shell/api';
import { partById } from '../canvas/parts';
import { DENSITY_OPTIONS, changeMeshDensity, type Density } from './remesh';
import './mesh.css';

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
