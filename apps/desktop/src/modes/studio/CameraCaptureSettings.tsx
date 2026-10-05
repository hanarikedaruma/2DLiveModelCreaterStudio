import { useEffect, useState, useSyncExternalStore } from 'react';
import { useEnvironment, useServices } from '../../shell/api';

const SIZES = [
  [640, 480],
  [1280, 720],
  [1920, 1080],
  [3840, 2160],
] as const;

function CaptureNumber({
  label,
  value,
  max,
  min = 16,
  commit,
}: {
  label: string;
  value: number;
  max: number;
  min?: number;
  commit(value: number): void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const done = () => {
    const n = Number(text);
    if (text.trim() && Number.isInteger(n) && n >= min && n <= max) commit(n);
    else setText(String(value));
  };
  return (
    <input
      type="number"
      aria-label={label}
      min={min}
      max={max}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done();
      }}
    />
  );
}

export function CameraCaptureSettings() {
  const services = useServices();
  const [env, setEnv] = useEnvironment();
  const settings = env.cameraCapture;
  const [custom, setCustom] = useState(false);
  useEffect(() => services.tracking.configureCapture(settings), [services, settings]);
  const stats = useSyncExternalStore(
    (listener) => services.tracking.onCaptureStats(listener),
    () => services.tracking.captureStats(),
  );
  const set = (patch: Partial<typeof settings>) => setEnv({ cameraCapture: { ...settings, ...patch } });
  const size = SIZES.find(([w, h]) => settings.width === w && settings.height === h);
  const selected = custom || !size ? 'custom' : size.join('x');
  const fps = (v: number | null | undefined) => (v === null || v === undefined ? '--' : v.toFixed(1));
  return (
    <div className="camera-capture">
      <div className="studio-choices" role="group" aria-label="カメラ入力の設定方式">
        <button
          type="button"
          aria-pressed={settings.mode === 'auto'}
          title="受信映像と顔推定のfpsを測り、追従性を優先して選ぶ"
          onClick={() => set({ mode: 'auto' })}
        >
          自動
        </button>
        <button type="button" aria-pressed={settings.mode === 'manual'} onClick={() => set({ mode: 'manual' })}>
          手動
        </button>
      </div>
      {settings.mode === 'manual' && (
        <>
          <label className="studio-field">
            <span>解像度</span>
            <select
              aria-label="カメラの解像度"
              value={selected}
              onChange={(e) => {
                const next = SIZES.find((s) => s.join('x') === e.target.value);
                setCustom(!next);
                if (next) set({ width: next[0], height: next[1] });
              }}
            >
              {SIZES.map((s) => (
                <option key={s.join('x')} value={s.join('x')}>
                  {s.join('×')}
                </option>
              ))}
              <option value="custom">任意</option>
            </select>
          </label>
          {selected === 'custom' && (
            <div className="camera-dimensions">
              <CaptureNumber label="カメラの幅" value={settings.width} max={7680} commit={(width) => set({ width })} />
              <span>×</span>
              <CaptureNumber
                label="カメラの高さ"
                value={settings.height}
                max={4320}
                commit={(height) => set({ height })}
              />
            </div>
          )}
          <label className="studio-field">
            <span>fps</span>
            <CaptureNumber
              label="カメラの要求fps"
              value={settings.fps}
              min={1}
              max={120}
              commit={(value) => set({ fps: value })}
            />
          </label>
        </>
      )}
      <dl className="camera-stats" aria-label="カメラの実測">
        <dt>映像</dt>
        <dd>{stats ? `${stats.width}×${stats.height}` : '--'}</dd>
        <dt>受信fps</dt>
        <dd>{fps(stats?.cameraFps)}</dd>
        <dt>推定fps</dt>
        <dd>{fps(stats?.trackingFps)}</dd>
        <dt>動作設定</dt>
        <dd>{stats?.nominalFps === null || !stats ? '--' : `${stats.nominalFps} fps`}</dd>
        <dt title="機器が報告した全体の上限。解像度や照明で実測fpsは変わる">機器上限</dt>
        <dd>{stats?.maxFps === null || !stats ? '--' : `${stats.maxFps} fps`}</dd>
      </dl>
      {stats?.state === 'selecting' && (
        <p className="studio-note" role="status">
          {settings.mode === 'auto' ? '自動選択中' : '設定を適用中'}
        </p>
      )}
      {stats?.warning && (
        <p className="studio-note studio-warn" role="status">
          {stats.warning}
        </p>
      )}
    </div>
  );
}
