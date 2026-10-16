// スタジオの右のパネル（studioSettings）のセクション: トラッキング・出力（背景はシーンの編集 scenes/ にある）
import { useEffect, useState } from 'react';
import { PanelSections, useDialogs, useEnvironment, useServices } from '../../shell/api';
import { useOutputWindow } from '../../output/controller';
import { useStudioBinding } from './binding';
import { studioRuntime, useStudioRuntime } from './runtime';
import { CameraCaptureSettings } from './CameraCaptureSettings';

export const STUDIO_SETTINGS_PANEL = 'studioSettings';
export const STUDIO_AUDIO_PANEL = 'studioAudio';

export function StudioAudioPanel() {
  return <PanelSections panelId={STUDIO_AUDIO_PANEL} />;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function StudioSettingsPanel() {
  // 素材が無いと中央はセットアップ画面になるので、パネルの側でも実行部をつないでおく
  useStudioBinding();
  return <PanelSections panelId={STUDIO_SETTINGS_PANEL} />;
}

// ---- トラッキング ----

const STATUS_LABEL = { tracking: '検出中', lost: '外れている', stopped: '停止中' } as const;

export function TrackingSection() {
  const services = useServices();
  const [env, setEnv] = useEnvironment();
  const dialogs = useDialogs();
  const { status } = useStudioRuntime();
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    let alive = true;
    services.tracking
      .listDevices()
      .then((list) => {
        if (alive) setDevices(list);
      })
      .catch((e: unknown) => console.warn('カメラの一覧を取れない', e));
    return () => {
      alive = false;
    };
  }, [services]);

  const deviceId = env.cameraDeviceId ?? devices[0]?.id ?? '';
  const started = status !== 'stopped';
  const start = async (id: string) => {
    try {
      services.trackingLayer.setMirror(env.mirror);
      await studioRuntime.startTracking(id || null);
    } catch (e) {
      dialogs.notify(`カメラを開始できない: ${errorText(e)}`);
    }
  };

  return (
    <div className="studio-section">
      <h3>トラッキング</h3>
      <label className="studio-field">
        <span>カメラ</span>
        <select
          value={deviceId}
          onChange={(e) => {
            setEnv({ cameraDeviceId: e.target.value || null });
            if (started) void start(e.target.value);
          }}
        >
          {devices.length === 0 && <option value="">（カメラが見つからない）</option>}
          {env.cameraDeviceId && !devices.some((d) => d.id === env.cameraDeviceId) && devices.length > 0 && (
            <option value={env.cameraDeviceId}>（前に使ったカメラ）</option>
          )}
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <CameraCaptureSettings />
      <label className="studio-check">
        <input type="checkbox" checked={env.mirror} onChange={(e) => setEnv({ mirror: e.target.checked })} />
        ミラー
      </label>
      <div className="studio-row">
        <button
          type="button"
          className={started ? undefined : 'primary'}
          onClick={() => (started ? studioRuntime.stopTracking() : void start(deviceId))}
        >
          {started ? '停止' : '開始'}
        </button>
        {started && env.cameraCapture.mode === 'auto' && (
          <button type="button" title="カメラ設定の実測選択をやり直す" onClick={() => void start(deviceId)}>
            再選択
          </button>
        )}
        <span className="studio-status" data-status={status} aria-label="トラッキングの状態">
          {STATUS_LABEL[status]}
        </span>
      </div>
    </div>
  );
}

// ---- 出力 ----

export const OUTPUT_PRESETS = [
  { id: '1920x1080', width: 1920, height: 1080 },
  { id: '1280x720', width: 1280, height: 720 },
] as const;
const MIN_SIZE = 16;
const MAX_SIZE = 7680;

function parseSize(text: string): number | null {
  const n = Number(text);
  return Number.isInteger(n) && n >= MIN_SIZE && n <= MAX_SIZE ? n : null;
}

export function OutputSection() {
  const services = useServices();
  const [env, setEnv] = useEnvironment();
  const dialogs = useDialogs();
  const output = useOutputWindow(services);
  const { width, height } = env.output;
  const preset = OUTPUT_PRESETS.find((p) => p.width === width && p.height === height);
  const [customChosen, setCustomChosen] = useState(false);
  const selected = customChosen || !preset ? 'custom' : preset.id;
  const [draft, setDraft] = useState({ width: String(width), height: String(height) });
  useEffect(() => setDraft({ width: String(width), height: String(height) }), [width, height]);

  const setSize = (w: number, h: number) => setEnv({ output: { ...env.output, width: w, height: h } });
  const commitDraft = () => {
    const w = parseSize(draft.width);
    const h = parseSize(draft.height);
    if (w === null || h === null) {
      setDraft({ width: String(width), height: String(height) });
      dialogs.notify(`幅と高さは ${MIN_SIZE}〜${MAX_SIZE} の整数にする`);
      return;
    }
    if (w !== width || h !== height) setSize(w, h);
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitDraft();
  };

  const open = async () => {
    try {
      await output.openWindow();
    } catch (e) {
      dialogs.notify(`出力ウィンドウを開けない: ${errorText(e)}`);
    }
  };

  return (
    <div className="studio-section">
      <h3>出力</h3>
      <label className="studio-field">
        <span>解像度</span>
        <select
          value={selected}
          onChange={(e) => {
            const p = OUTPUT_PRESETS.find((x) => x.id === e.target.value);
            setCustomChosen(!p);
            if (p) setSize(p.width, p.height);
          }}
        >
          {OUTPUT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.width}×{p.height}
            </option>
          ))}
          <option value="custom">任意</option>
        </select>
      </label>
      {selected === 'custom' && (
        <div className="studio-row studio-size-inputs">
          <input
            type="number"
            aria-label="幅"
            min={MIN_SIZE}
            max={MAX_SIZE}
            value={draft.width}
            onChange={(e) => setDraft({ ...draft, width: e.target.value })}
            onBlur={commitDraft}
            onKeyDown={onKey}
          />
          <span>×</span>
          <input
            type="number"
            aria-label="高さ"
            min={MIN_SIZE}
            max={MAX_SIZE}
            value={draft.height}
            onChange={(e) => setDraft({ ...draft, height: e.target.value })}
            onBlur={commitDraft}
            onKeyDown={onKey}
          />
        </div>
      )}
      <div className="studio-row">
        <button type="button" className="primary" onClick={() => void open()}>
          出力ウィンドウを開く
        </button>
        {output.open && (
          <button type="button" onClick={output.close}>
            閉じる
          </button>
        )}
      </div>
      {output.open && <p className="studio-note">出力ウィンドウを開いている（配信ソフトでこのウィンドウを取り込む）</p>}
    </div>
  );
}
