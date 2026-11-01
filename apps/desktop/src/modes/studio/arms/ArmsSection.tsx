// スタジオの設定（studioSettings）の「腕・手」（AT-11）。左右の有効・動きの大きさ・なめらかさ・手形、準備の不足、状態、
// 校正、詳細（認識・点・制限の理由）。操作は全て services.arms（ArmService）へ渡し、Project・Environment へは書かない
// （保存はサービスの側。AT-12）。カメラは開かず、校正のときだけ顔の校正と同じ道（studioRuntime）でトラッキングを開始する
import { useCallback, useEffect, useState } from 'react';
import type { ArmSide, ArmSideSettings, ArmTrackingSettings, HandShape } from '@app/schema';
import { HAND_SHAPES } from '@app/schema';
import { useDialogs, useEnvironment, useProject, useServices } from '../../../shell/api';
import { studioRuntime } from '../runtime';
import { ArmCalibrationDialog } from './ArmCalibrationDialog';
import { createArmCalibrationFlow, type ArmCalibrationFlow } from './flow';
import { FEATURE_LABEL, LIMIT_LABEL, SHAPE_LABEL, VALIDITY_LABEL, sideTitle, statusLine } from './labels';
import { armReadiness, type ReadinessItem } from './readiness';
import {
  studioArmService,
  useArmDiagnostics,
  useArmSnapshot,
  type DiagnosticPoint,
  type StudioArmService,
} from './service';
import { actorSideOf } from './points';
import './arms.css';

const SIDES: ArmSide[] = ['L', 'R'];

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function ArmsSection() {
  const services = useServices();
  const found = studioArmService(services);
  return (
    <div className="studio-section arms-section">
      <h3>腕・手</h3>
      {found.service ? (
        <ArmsBody service={found.service} />
      ) : (
        <p className="studio-note">腕・手の追従は使えない（{found.reason}）</p>
      )}
    </div>
  );
}

// 今のカメラ（校正のときとの違いを見るため）。開始していなければ null
function useCurrentCamera(): { deviceId: string | null; width: number; height: number } | null {
  const services = useServices();
  const [env] = useEnvironment();
  const read = useCallback(() => {
    const stats = services.tracking.captureStats();
    return stats && stats.state === 'ready' ? { width: stats.width, height: stats.height } : null;
  }, [services]);
  const [size, setSize] = useState(read);
  useEffect(() => {
    setSize(read());
    return services.tracking.onCaptureStats(() => setSize(read()));
  }, [services, read]);
  return size ? { deviceId: env.cameraDeviceId, ...size } : null;
}

function ArmsBody({ service }: { service: StudioArmService }) {
  const services = useServices();
  const project = useProject();
  const [env] = useEnvironment();
  const dialogs = useDialogs();
  const { status, settings, calibration } = useArmSnapshot(service);
  const camera = useCurrentCamera();
  const [flow] = useState<ArmCalibrationFlow>(() => createArmCalibrationFlow());
  const [detailsOpen, setDetailsOpen] = useState(false);
  const mirror = env.mirror;

  // 画面を離れたら途中の校正はやめる
  useEffect(() => () => flow.cancel(), [flow]);

  const items = armReadiness({
    status,
    settings,
    calibration,
    rigs: project.model.armRigs ?? [],
    camera,
    faceMappingOff: project.trackingSetup.mode === 'off',
  });

  const setSide = (side: ArmSide, patch: Partial<ArmSideSettings>) => {
    const next: ArmTrackingSettings = {
      ...settings,
      sides: { ...settings.sides, [side]: { ...settings.sides[side], ...patch } },
    };
    service.setSettings(next);
  };

  // 校正を始める。カメラが止まっていて体の点も来ていなければ、顔の校正と同じく選んであるカメラで開始する
  const begin = async () => {
    if (flow.active()) return;
    if (studioRuntime.getState().status === 'stopped' && service.status().tracking.pose.state === 'off') {
      try {
        services.trackingLayer.setMirror(mirror);
        await studioRuntime.startTracking(env.cameraDeviceId);
      } catch (e) {
        dialogs.notify(`カメラを開始できない: ${errorText(e)}`);
        return;
      }
    }
    flow.start(service);
  };

  const enabled = SIDES.filter((s) => settings.sides[s].enabled);
  return (
    <>
      <div className="arms-sides" role="group" aria-label="追従する腕">
        {SIDES.map((side) => (
          <label key={side} className="studio-check">
            <input
              type="checkbox"
              checked={settings.sides[side].enabled}
              onChange={(e) => setSide(side, { enabled: e.target.checked })}
            />
            {sideTitle(side, mirror)}
          </label>
        ))}
      </div>
      {enabled.length === 0 && <p className="studio-note">左腕・右腕のどちらかを入れると、カメラで腕が動く</p>}

      <Readiness items={items} onCalibrate={() => void begin()} />

      <div className="studio-row">
        <button type="button" onClick={() => void begin()}>
          腕の校正
        </button>
        {calibration && (
          <button type="button" onClick={() => service.clearCalibration()}>
            未校正に戻す
          </button>
        )}
      </div>

      {enabled.length > 0 && (
        <dl className="arms-status" aria-label="腕の状態">
          {enabled.map((side) => (
            <div key={side}>
              <dt>{side === 'L' ? '左腕' : '右腕'}</dt>
              <dd data-state={status.motion[side].state}>{statusLine(status.motion[side])}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="arms-settings" role="group" aria-label="腕の動き">
        <span className="arms-settings-head">左腕</span>
        <span className="arms-settings-head">右腕</span>
        <span className="arms-settings-label">動きの大きさ</span>
        {SIDES.map((side) => (
          <RangeField
            key={side}
            label={`${side === 'L' ? '左腕' : '右腕'}の動きの大きさ`}
            min={0}
            max={2}
            step={0.1}
            value={settings.sides[side].gain}
            onCommit={(gain) => setSide(side, { gain })}
          />
        ))}
        <span className="arms-settings-label">なめらかさ</span>
        {SIDES.map((side) => (
          <RangeField
            key={side}
            label={`${side === 'L' ? '左腕' : '右腕'}のなめらかさ`}
            min={0}
            max={1}
            step={0.05}
            value={settings.sides[side].smoothing}
            onCommit={(smoothing) => setSide(side, { smoothing })}
          />
        ))}
        <span className="arms-settings-label">手形</span>
        {SIDES.map((side) => (
          <select
            key={side}
            aria-label={`${side === 'L' ? '左腕' : '右腕'}の手形`}
            value={settings.sides[side].handMode}
            onChange={(e) => setSide(side, { handMode: e.target.value as ArmSideSettings['handMode'] })}
          >
            <option value="auto">自動</option>
            {HAND_SHAPES.map((s) => (
              <option key={s} value={s}>
                {SHAPE_LABEL[s]}に固定
              </option>
            ))}
          </select>
        ))}
      </div>
      <p className="studio-note">手形を固定しても、腕はカメラに合わせて動く</p>

      <details className="arms-details" onToggle={(e) => setDetailsOpen(e.currentTarget.open)}>
        <summary>詳細（認識の状態・点・制限の理由）</summary>
        {/* 開いている間だけ診断を購読する */}
        {detailsOpen && <ArmsDetails service={service} settings={settings} setSide={setSide} mirror={mirror} />}
      </details>

      <ArmCalibrationDialog flow={flow} service={service} mirror={mirror} sides={enabled.length ? enabled : SIDES} />
    </>
  );
}

function Readiness(props: { items: ReadinessItem[]; onCalibrate(): void }) {
  if (props.items.length === 0) return null;
  return (
    <ul className="arms-readiness" aria-label="腕の準備">
      {props.items.map((item) => (
        <li key={item.id} data-level={item.level}>
          <span>
            {item.level === 'block' ? '⚠ ' : '・'}
            {item.text}
          </span>
          {item.action === 'calibrate' && (
            <button type="button" className="arms-inline" onClick={props.onCalibrate}>
              校正する
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// 動かしている間は手元の値だけを変え、離したとき（キーなら押したとき）にサービスへ渡す
function RangeField(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onCommit(value: number): void;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const commit = () => {
    if (draft !== props.value) props.onCommit(draft);
  };
  return (
    <span className="arms-range">
      <input
        type="range"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={props.step}
        value={draft}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <output>{draft.toFixed(props.step < 0.1 ? 2 : 1)}</output>
    </span>
  );
}

const fmt = (v: { x: number; y: number } | null) => (v ? `${v.x.toFixed(2)}, ${v.y.toFixed(2)}` : '—');
const fmtRaw = (v: DiagnosticPoint | null) => (v ? `${fmt(v)}（${v.visibility.toFixed(2)}）` : '—');

function ArmsDetails(props: {
  service: StudioArmService;
  settings: ArmTrackingSettings;
  setSide(side: ArmSide, patch: Partial<ArmSideSettings>): void;
  mirror: boolean;
}) {
  const { service, settings } = props;
  const { status } = useArmSnapshot(service);
  const { diagnostics, stale } = useArmDiagnostics(service);
  const t = status.tracking;
  return (
    <div className="arms-details-body">
      <label className="studio-field">
        <span>認識の負荷</span>
        <select
          value={settings.mode}
          onChange={(e) => service.setSettings({ ...settings, mode: e.target.value as ArmTrackingSettings['mode'] })}
        >
          <option value="normal">通常</option>
          <option value="light">軽量（手の認識を減らす）</option>
        </select>
      </label>
      {SIDES.map((side) => (
        <label key={side} className="studio-field">
          <span>{side === 'L' ? '左腕' : '右腕'}の休止時の形</span>
          <select
            value={settings.sides[side].restHand}
            onChange={(e) => props.setSide(side, { restHand: e.target.value as HandShape })}
          >
            {HAND_SHAPES.map((s) => (
              <option key={s} value={s}>
                {SHAPE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      ))}
      <dl className="arms-diag" aria-label="認識の状態">
        <dt>体（Pose）</dt>
        <dd>
          {FEATURE_LABEL[t.pose.state]}
          {t.pose.delegate ? `・${t.pose.delegate}` : ''}
          {t.poseFps !== null ? `・${t.poseFps.toFixed(0)}fps` : ''}
          {t.pose.reason ? `（${t.pose.reason}）` : ''}
        </dd>
        <dt>手</dt>
        <dd>
          {FEATURE_LABEL[t.hands.state]}
          {t.hands.delegate ? `・${t.hands.delegate}` : ''}
          {t.handFps !== null ? `・${t.handFps.toFixed(0)}fps` : ''}
          {t.hands.reason ? `（${t.hands.reason}）` : ''}
        </dd>
        <dt>落としたフレーム・古い結果</dt>
        <dd>
          {t.droppedFrames}・{t.staleResults}
        </dd>
      </dl>
      <div className="arms-diag-points" data-stale={stale ? 'true' : undefined} aria-label="左右の点">
        {stale && <p className="studio-warn">点が古い（認識が止まっている）</p>}
        {!diagnostics && <p className="studio-note">点がまだ来ていない</p>}
        {diagnostics &&
          SIDES.map((side) => {
            const d = diagnostics.sides[side];
            const raw = diagnostics.pose?.[actorSideOf(side, props.mirror)] ?? null;
            const motion = status.motion[side];
            return (
              <dl key={side} className="arms-diag" aria-label={`${side === 'L' ? '左腕' : '右腕'}の点`}>
                <dt>{sideTitle(side, props.mirror)}</dt>
                <dd>{d ? VALIDITY_LABEL[d.validity] : '更新なし'}</dd>
                <dt>生の肩・肘・手首（画像の0..1、見え方）</dt>
                <dd>
                  {fmtRaw(raw?.shoulder ?? null)} ／ {fmtRaw(raw?.elbow ?? null)} ／ {fmtRaw(raw?.wrist ?? null)}
                </dd>
                <dt>採用した肘・手首（腕の長さ1）</dt>
                <dd>
                  {fmt(d?.elbow ?? null)} ／ {fmt(d?.wrist ?? null)}
                </dd>
                <dt>目標・実際の手首（モデルpx）</dt>
                <dd>
                  {fmt(d?.target ?? null)} ／ {fmt(d?.actual ?? null)}
                </dd>
                <dt>制限の理由</dt>
                <dd>
                  {[...new Set([...(d?.reasons ?? []), ...motion.reasons])].map((r) => LIMIT_LABEL[r]).join('・') ||
                    'なし'}
                </dd>
              </dl>
            );
          })}
      </div>
    </div>
  );
}
