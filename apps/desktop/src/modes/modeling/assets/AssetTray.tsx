// 素材トレイ（left のパネル）。サムネイル、PSD のグループごとの折りたたみ、非表示の印、ドラッグ元、[素材を追加]
import { useMemo, useState, type MouseEvent } from 'react';
import { PanelSections, useDialogs, useProject, useServices } from '../../../shell/api';
import { importFromFiles } from './actions';
import { AssetList } from './AssetList';
import { FilePickButton } from './FilePickButton';
import { groupWarnings, importWarningsOf, useImportWarnings } from './warnings';
import './assets.css';

export function ImportWarnings() {
  const services = useServices();
  const warnings = useImportWarnings(services);
  const groups = useMemo(() => groupWarnings(warnings), [warnings]);
  if (groups.length === 0) return null;
  return (
    <div className="import-warnings" role="alert" aria-label="取り込みの警告">
      <div className="import-warnings-head">
        <strong>取り込みの警告</strong>
        <button
          type="button"
          className="am-icon-button"
          aria-label="警告を閉じる"
          onClick={() => importWarningsOf(services).set([])}
        >
          ×
        </button>
      </div>
      <ul className="import-warning-list">
        {groups.map((g) => (
          <li key={g.kind} data-warning-kind={g.kind}>
            <p>{g.text}</p>
            {g.layerNames.length > 0 && (
              <ul className="layer-names">
                {g.layerNames.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AssetTray() {
  const services = useServices();
  const project = useProject();
  const { notify } = useDialogs();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const pick = (assetId: string, e: MouseEvent) => {
    setSelected((prev) => {
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return new Set([assetId]);
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };
  // 選んでいる素材を押してドラッグしたら、選んでいるものをまとめて運ぶ
  const dragIds = (assetId: string) =>
    selected.has(assetId) ? project.assets.filter((a) => selected.has(a.id)).map((a) => a.id) : [assetId];

  const add = async (files: File[]) => {
    setBusy(true);
    try {
      await importFromFiles(services, notify, files);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="asset-tray">
      <div className="tray-toolbar">
        <FilePickButton label="素材を追加" disabled={busy} onFiles={(files) => void add(files)} />
        <span className="am-dim">{project.assets.length} 個</span>
      </div>
      <PanelSections panelId="assets.tray" />
      <ImportWarnings />
      {project.assets.length === 0 ? (
        <p className="am-dim">素材はまだ無い</p>
      ) : (
        <>
          <AssetList
            assets={project.assets}
            repo={services.assets}
            model={project.model}
            selectedIds={selected}
            onPick={pick}
            dragIds={dragIds}
          />
          <p className="am-dim am-hint">右の標準パーツの枠へドラッグして割り当てる（Ctrl+クリックで複数選択）</p>
        </>
      )}
    </div>
  );
}
