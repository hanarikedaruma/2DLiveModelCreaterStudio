// セットアップ画面（素材が1つも無いとき中央に出る）。PSD・PNG を複数ドラッグ&ドロップして取り込む
import { useEffect, useRef, useState } from 'react';
import { useDialogs, useServices } from '../../../shell/api';
import { importFromFiles } from './actions';
import { FilePickButton } from './FilePickButton';
import './assets.css';

export function SetupScreen() {
  const services = useServices();
  const { notify } = useDialogs();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = async (files: File[]) => {
    setBusy(true);
    try {
      await importFromFiles(services, notify, files);
    } finally {
      // 取り込めたら素材が増えてこの画面は消える
      if (mounted.current) setBusy(false);
    }
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
        {busy && <p className="am-dim">読み込み中…</p>}
        <p className="am-dim am-hint">読み込んだら、左の素材トレイから右の標準パーツの枠へドラッグして割り当てる</p>
      </div>
    </div>
  );
}
