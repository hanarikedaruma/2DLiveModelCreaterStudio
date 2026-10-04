// スタジオの設定（studioSettings）の「リップシンク」（カード37）。マイクの選択・開始、無音とみなす音量、
// 口の動き（控えめ / 標準 / 大きめ）、カメラの口との関係（大きい方 / マイクのみ / カメラのみ）。
// マイクとしきい値は Environment（この PC の設定）、ほかは project.model.lipSync に保存する
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useDialogs, useDispatch, useEnvironment, useProject, useServices } from '../../../shell/api';
import {
  MOUTH_SOURCE_CHOICES,
  MOUTH_STRENGTH_CHOICES,
  lipSyncBinding,
  setLipSyncCommand,
  type MicrophoneStatus,
} from './lipSync';
import './lipsync.css';

// しきい値のスライダーと今の音量の表示の範囲（dBFS）
export const THRESHOLD_MIN_DB = -80;
export const THRESHOLD_MAX_DB = -10;
const METER_MIN_DB = -80;
const METER_MAX_DB = 0;

// マイクの状態の表示。ボタンの名前（マイクをオン / オフ）には「開始」「停止」を入れない
// （トラッキングの「開始」「停止」のボタンと名前の一部が重なると、名前の一部で探す e2e が取り違える）
const STATUS_LABEL: Record<MicrophoneStatus, string> = { stopped: '停止中', starting: '準備中', running: '入力中' };

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const meterPercent = (db: number) =>
  Math.min(100, Math.max(0, ((db - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB)) * 100));
const formatDb = (db: number) => `${Math.round(db)} dB`;

export function LipSyncSection() {
  const services = useServices();
  const project = useProject();
  const dispatch = useDispatch();
  const [env, setEnv] = useEnvironment();
  const dialogs = useDialogs();
  // services.audio・services.lipSync を実行部の producer につなぐ。出力ウィンドウはスタジオの画面を離れても
  // 動き続けるので、外したとき（画面を離れたとき）もつないだまま・マイクも開いたままにする
  useEffect(() => {
    lipSyncBinding.bind({ audio: services.audio, lipSync: services.lipSync });
  }, [services]);
  const { status, level } = useSyncExternalStore(lipSyncBinding.subscribe, lipSyncBinding.state);

  // マイクの一覧。許可の前は名前が空なので、開始できたら取り直す
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  const [listVersion, setListVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    services.audio
      .listDevices()
      .then((list) => {
        if (alive) setDevices(list);
      })
      .catch((e: unknown) => console.warn('マイクの一覧を取れない', e));
    return () => {
      alive = false;
    };
  }, [services, listVersion]);

  const start = async (deviceId: string | null) => {
    try {
      await lipSyncBinding.startMicrophone(deviceId);
      setListVersion((v) => v + 1);
    } catch (e) {
      dialogs.notify(`マイクを開始できない: ${errorText(e)}`);
    }
  };

  // しきい値: 動かしている間は画面とリップシンクにだけ反映し、離したとき（change）に Environment へ保存する
  const [draft, setDraft] = useState<number | null>(null);
  const threshold = draft ?? env.silenceThreshold;
  useEffect(() => {
    lipSyncBinding.setSilenceThreshold(threshold);
  }, [threshold]);
  const sliderRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = sliderRef.current;
    if (!input) return;
    const onInput = () => setDraft(Number(input.value));
    const onChange = () => {
      setEnv({ silenceThreshold: Number(input.value) });
      setDraft(null);
    };
    input.addEventListener('input', onInput);
    input.addEventListener('change', onChange);
    return () => {
      input.removeEventListener('input', onInput);
      input.removeEventListener('change', onChange);
    };
  }, [setEnv]);
  // 動かしていない間は保存した値に合わせる（スライダーは自分で値を持つ。React の onChange は離したときに来ないため）
  useEffect(() => {
    if (draft === null && sliderRef.current) sliderRef.current.value = String(env.silenceThreshold);
  }, [draft, env.silenceThreshold]);

  const { mouthSource, strength } = project.model.lipSync;
  const hasMouth = project.model.parameters.some((p) => p.id === 'MouthOpen');
  const micDeviceId = env.microphoneDeviceId;
  const speaking = level !== null && level > threshold;

  return (
    <div className="studio-section lipsync-section">
      <h3>リップシンク</h3>
      <label className="studio-field">
        <span>マイク</span>
        <select
          value={micDeviceId ?? ''}
          onChange={(e) => {
            const id = e.target.value || null;
            setEnv({ microphoneDeviceId: id });
            if (status !== 'stopped') void start(id);
          }}
        >
          <option value="">既定のマイク</option>
          {micDeviceId && !devices.some((d) => d.id === micDeviceId) && (
            <option value={micDeviceId}>（前に使ったマイク）</option>
          )}
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <div className="studio-row">
        <button
          type="button"
          className={status === 'stopped' ? 'primary' : undefined}
          onClick={() => (status === 'stopped' ? void start(micDeviceId) : lipSyncBinding.stopMicrophone())}
        >
          {status === 'stopped' ? 'マイクをオン' : 'マイクをオフ'}
        </button>
        <span className="studio-status" data-mic={status} aria-label="マイクの状態">
          {STATUS_LABEL[status]}
        </span>
      </div>

      <label className="lipsync-threshold">
        <span>無音とみなす音量</span>
        <input
          ref={sliderRef}
          type="range"
          min={THRESHOLD_MIN_DB}
          max={THRESHOLD_MAX_DB}
          step={1}
          defaultValue={env.silenceThreshold}
          aria-label="無音とみなす音量"
          aria-valuetext={formatDb(threshold)}
        />
        <output aria-label="無音とみなす音量の値">{formatDb(threshold)}</output>
      </label>
      <div
        className="lipsync-meter"
        role="meter"
        aria-label="今の音量"
        aria-valuemin={METER_MIN_DB}
        aria-valuemax={METER_MAX_DB}
        aria-valuenow={Math.max(METER_MIN_DB, Math.min(METER_MAX_DB, Math.round(level ?? METER_MIN_DB)))}
        aria-valuetext={level === null ? 'マイクを止めている' : formatDb(level)}
      >
        <div
          className="lipsync-meter-fill"
          data-speaking={speaking}
          style={{ width: `${meterPercent(level ?? METER_MIN_DB)}%` }}
        />
        <div className="lipsync-meter-threshold" style={{ left: `${meterPercent(threshold)}%` }} />
      </div>
      <p className="studio-note">
        今の音量: {level === null ? '—' : formatDb(level)}
        {speaking && '（話している）'}
      </p>

      <div className="lipsync-label">口の動き</div>
      <div className="studio-choices" role="group" aria-label="口の動き">
        {MOUTH_STRENGTH_CHOICES.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={strength === c.id}
            onClick={() => dispatch(setLipSyncCommand('口の動きを変える', { strength: c.id }))}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="lipsync-label">カメラの口との関係</div>
      <div className="studio-choices" role="group" aria-label="カメラの口との関係">
        {MOUTH_SOURCE_CHOICES.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={mouthSource === c.id}
            onClick={() => dispatch(setLipSyncCommand('カメラの口との関係を変える', { mouthSource: c.id }))}
          >
            {c.label}
          </button>
        ))}
      </div>
      {mouthSource === 'cameraOnly' && <p className="studio-note">カメラのみのときは、マイクの音量を口に使わない</p>}
      {!hasMouth && <p className="studio-note">モデルに口のパラメータ（MouthOpen）が無いので、口は動かない</p>}
    </div>
  );
}
