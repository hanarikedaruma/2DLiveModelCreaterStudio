// セットアップ画面（素材が1つも無いとき中央に出る）。PSD・PNG を複数ドラッグ&ドロップして取り込む
import { useState } from 'react';
import { useDialogs, useServices } from '../../../shell/api';
import { importFromFiles } from './actions';
import { FilePickButton } from './FilePickButton';
import { ImportProgress } from './ImportProgress';
import { useImportState } from './importSession';
import './assets.css';

export function SetupScreen() {
  const services = useServices();
  const { notify } = useDialogs();
  const [over, setOver] = useState(false);
  const { busy } = useImportState(services);

  const run = async (files: File[]) => {
    if (!busy) await importFromFiles(services, notify, files);
  };

  return (
    <div
      className={`setup-screen${over ? ' over' : ''}`}
      data-testid="setup-drop"
      onDragOver={(e) => {
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...(e.dataTransfer?.files ?? [])];
        if (files.length > 0) void run(files);
      }}
    >
      <div className="setup-box">
        <h2>素材を読み込む</h2>
        <p>PSD・PNG をここにドラッグ&ドロップ（複数可）</p>
        <FilePickButton label="ファイルを選ぶ" className="primary" disabled={busy} onFiles={(f) => void run(f)} />
        <ImportProgress />
        <p className="am-dim am-hint">読み込んだら、左の素材トレイから右の標準パーツの枠へドラッグして割り当てる</p>
      </div>
    </div>
  );
}
