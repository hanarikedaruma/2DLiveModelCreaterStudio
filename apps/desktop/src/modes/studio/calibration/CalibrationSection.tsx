// スタジオの設定（studioSettings）の「キャリブレーション・動き」（カード35）。
// [キャリブレーション] で3手順（正面を向く・目を閉じる・口を大きく開ける）を行い、結果を Environment.calibration に保存する。
// 「動き」の 安定 / 標準 / 大きく動く（Environment.trackingPreset）と、目のトラッキングのオン・オフ。
// 設定は services.trackingLayer に渡す。アプリイベント 'recalibrate'（ホットキー）でキャリブレーションを始める
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { TRACKING_PRESETS, type TrackingPreset, type TrackingPresetName, type TrackingTuning } from '@app/tracking';
import { DetailDisclosure, onAppEvent, presetOf, useDialogs, useEnvironment, useServices } from '../../../shell/api';
import { useConfirmOverwriteCustom } from '../../../shell/level';
import { RECALIBRATE_EVENT } from '../../../hotkeys/actions';
import { studioRuntime } from '../runtime';
import { CALIBRATION_STEPS, COUNTDOWN_FROM, createCalibrationFlow, type CalibrationFlow } from './flow';
import './calibration.css';

export const MOTION_CHOICES: readonly { id: TrackingPresetName; label: string }[] = [
  { id: 'stable', label: '安定' },
  { id: 'standard', label: '標準' },
  { id: 'large', label: '大きく動く' },
];

// 詳細で数値を変える項目
const TUNING_FIELDS: readonly { key: keyof TrackingTuning; label: string; min: number; step: number }[] = [
  { key: 'minCutoff', label: 'ならしの強さ（minCutoff。小さいほどなめらか）', min: 0.01, step: 0.1 },
  { key: 'beta', label: '速い動きへの追従（beta）', min: 0, step: 0.01 },
  { key: 'gain', label: '動きの大きさ（gain）', min: 0, step: 0.1 },
  { key: 'deadZone', label: '動かない幅（deadZone。顔の角度の度）', min: 0, step: 0.5 },
];

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Environment.trackingPreset と custom の値から、今の値
export function tuningOf(preset: TrackingPreset, custom: TrackingTuning): TrackingTuning {
  return preset === 'custom' ? custom : { ...TRACKING_PRESETS[preset] };
}

// minCutoff は正、ほかは 0 以上の有限の数
function parseTuningValue(key: keyof TrackingTuning, text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  if (key === 'minCutoff' ? n <= 0 : n < 0) return null;
  return n;
}

const round = (v: number, digits = 1) => {
  const r = Number(v.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

export function CalibrationSection() {
  const services = useServices();
  const [env, setEnv] = useEnvironment();
  const dialogs = useDialogs();
  const confirmOverwrite = useConfirmOverwriteCustom();
  const [flow] = useState<CalibrationFlow>(() => createCalibrationFlow());
  const phase = useSyncExternalStore(flow.subscribe, flow.state);

  // 設定を services.trackingLayer に渡す（作り直しても引き継ぐのは services/trackingLayer.ts の包み）
  useEffect(() => services.trackingLayer.setCalibration(env.calibration), [services, env.calibration]);
  const preset = env.trackingPreset;
  const custom = env.trackingCustom;
  useEffect(() => {
    if (preset === 'custom') services.trackingLayer.setPreset('custom', custom);
    else services.trackingLayer.setPreset(preset);
  }, [services, preset, custom]);
  useEffect(() => services.trackingLayer.setEyeTracking(env.eyeTracking), [services, env.eyeTracking]);

  // 画面を離れたら（パネルが消えたら）途中のキャリブレーションはやめる
  useEffect(() => () => flow.cancel(), [flow]);

  // キャリブレーションを始める。トラッキングを開始していなければ、選んであるカメラで開始する
  const begin = useCallback(async () => {
    if (flow.running()) return;
    if (studioRuntime.getState().status === 'stopped') {
      try {
        services.trackingLayer.setMirror(env.mirror);
        await studioRuntime.startTracking(env.cameraDeviceId);
      } catch (e) {
        dialogs.notify(`カメラを開始できない: ${errorText(e)}`);
        return;
      }
    }
    flow.start({
      tracking: services.tracking,
      calibration: services.calibration,
      onComplete: (result) => setEnv({ calibration: result }),
    });
  }, [flow, services, env.mirror, env.cameraDeviceId, dialogs, setEnv]);

  // ホットキーの「キャリブレーションをやり直す」
  const beginRef = useRef(begin);
  useEffect(() => {
    beginRef.current = begin;
  });
  useEffect(() => onAppEvent(RECALIBRATE_EVENT, () => void beginRef.current()), []);

  const values = tuningOf(preset, custom);
  const current = presetOf(values, TRACKING_PRESETS);

  const choose = async (id: TrackingPresetName) => {
    if (current === id) return;
    if (!(await confirmOverwrite(current))) return;
    setEnv({ trackingPreset: id });
  };

  // 詳細で数値を変えた。プリセットのどれかと同じになればその名前、違えば 'custom' にする
  const setTuning = (key: keyof TrackingTuning, value: number) => {
    const next: TrackingTuning = { ...values, [key]: value };
    const name = presetOf(next, TRACKING_PRESETS) as TrackingPreset;
    setEnv({ trackingPreset: name, trackingCustom: next });
  };

  return (
    <div className="studio-section calibration-section">
      <h3>キャリブレーション・動き</h3>
      <div className="studio-row">
        <button type="button" className="primary" onClick={() => void begin()}>
          キャリブレーション
        </button>
        {env.calibration && (
          <button type="button" onClick={() => setEnv({ calibration: null })}>
            未設定に戻す
          </button>
        )}
      </div>
      <p className="studio-note" aria-label="キャリブレーションの状態">
        {env.calibration
          ? 'キャリブレーション済み（正面・目・口を合わせてある）'
          : '未設定（正面を向く・目を閉じる・口を大きく開ける の3手順で、顔に合わせる）'}
      </p>

      <div className="calibration-label">動き</div>
      <div className="studio-choices" role="group" aria-label="動き">
        {MOTION_CHOICES.map((c) => (
          <button key={c.id} type="button" aria-pressed={current === c.id} onClick={() => void choose(c.id)}>
            {c.label}
          </button>
        ))}
        {current === 'custom' && (
          <button type="button" aria-pressed="true" disabled>
            カスタム
          </button>
        )}
      </div>
      <p className="studio-note">安定は動きの遅れが少し増えます</p>
      <DetailDisclosure label="動きの数値">
        <div className="calibration-tuning">
          {TUNING_FIELDS.map((f) => (
            <TuningInput
              key={f.key}
              label={f.label}
              min={f.min}
              step={f.step}
              value={values[f.key]}
              onCommit={(text) => {
                const n = parseTuningValue(f.key, text);
                if (n === null) {
                  dialogs.notify(f.key === 'minCutoff' ? 'minCutoff は 0 より大きい数にする' : '0 以上の数にする');
                  return false;
                }
                if (n !== values[f.key]) setTuning(f.key, n);
                return true;
              }}
            />
          ))}
        </div>
      </DetailDisclosure>

      <label className="studio-check calibration-eyes">
        <input type="checkbox" checked={env.eyeTracking} onChange={(e) => setEnv({ eyeTracking: e.target.checked })} />
        目のトラッキング
      </label>
      {!env.eyeTracking && (
        <p className="studio-note">
          {env.autoBlink ? '目の開け閉めは自動のまばたきにする' : '目は開いたままにする（自動のまばたきがオフ）'}
        </p>
      )}
      <label className="studio-check calibration-auto-blink">
        <input type="checkbox" checked={env.autoBlink} onChange={(e) => setEnv({ autoBlink: e.target.checked })} />
        自動のまばたき
      </label>
      <p className="studio-note">
        目の値がカメラから来ていない間（顔が外れた・カメラ停止中・割り当てに目が無い）にまばたきする
      </p>

      {phase.kind !== 'idle' && <CalibrationDialog flow={flow} />}
    </div>
  );
}

function TuningInput(props: {
  label: string;
  min: number;
  step: number;
  value: number;
  onCommit(text: string): boolean; // false なら元の値に戻す
}) {
  const [draft, setDraft] = useState(String(props.value));
  useEffect(() => setDraft(String(props.value)), [props.value]);
  const commit = () => {
    if (draft === String(props.value)) return;
    if (!props.onCommit(draft)) setDraft(String(props.value));
  };
  return (
    <label className="calibration-tuning-field">
      <span>{props.label}</span>
      <input
        type="number"
        aria-label={props.label}
        min={props.min}
        step={props.step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </label>
  );
}

function CalibrationDialog({ flow }: { flow: CalibrationFlow }) {
  const phase = useSyncExternalStore(flow.subscribe, flow.state);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  if (phase.kind === 'idle') return null;
  const stepIndex = phase.kind === 'done' ? CALIBRATION_STEPS.length : phase.step;
  const step = CALIBRATION_STEPS[stepIndex];

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog calibration-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="キャリブレーション"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') flow.cancel();
        }}
      >
        <ol className="calibration-steps" aria-label="手順">
          {CALIBRATION_STEPS.map((s, i) => (
            <li
              key={s.id}
              data-state={i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'pending'}
              aria-current={i === stepIndex ? 'step' : undefined}
            >
              {s.label}
            </li>
          ))}
        </ol>

        {phase.kind === 'countdown' && step && (
          <>
            <p className="calibration-instruction">{step.instruction}</p>
            <div className="calibration-count" aria-live="assertive" aria-label="カウント">
              {phase.count}
            </div>
            <p className="studio-note">{COUNTDOWN_FROM}・2・1 のあと、1秒ぶんの顔の動きを読み取る</p>
          </>
        )}
        {phase.kind === 'collecting' && step && (
          <>
            <p className="calibration-instruction">{step.instruction}</p>
            <div className="calibration-count" aria-live="assertive" aria-label="カウント">
              そのまま
            </div>
            <p className="studio-note">読み取っている（{phase.frames} フレーム）</p>
          </>
        )}
        {phase.kind === 'failed' && (
          <p className="calibration-instruction studio-warn" role="alert">
            {phase.message}
          </p>
        )}
        {phase.kind === 'done' && (
          <>
            <p className="calibration-instruction">キャリブレーションを保存した</p>
            <dl className="calibration-result">
              <dt>正面の向き</dt>
              <dd>
                左右 {round(phase.result.neutral.yaw)}°・上下 {round(phase.result.neutral.pitch)}°・傾き{' '}
                {round(phase.result.neutral.roll)}°
              </dd>
              <dt>目を閉じたとき</dt>
              <dd>
                左 {round(phase.result.eyeClosed.l, 2)}・右 {round(phase.result.eyeClosed.r, 2)}
              </dd>
              <dt>口を開けたとき</dt>
              <dd>{round(phase.result.mouthOpenMax, 2)}</dd>
            </dl>
          </>
        )}

        <div className="dialog-buttons">
          {phase.kind === 'failed' && (
            <button type="button" className="primary" onClick={() => flow.retry()}>
              もう一度
            </button>
          )}
          {phase.kind === 'done' ? (
            <button type="button" className="primary" ref={cancelRef} onClick={() => flow.cancel()}>
              閉じる
            </button>
          ) : (
            <button type="button" ref={cancelRef} onClick={() => flow.cancel()}>
              キャンセル
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
