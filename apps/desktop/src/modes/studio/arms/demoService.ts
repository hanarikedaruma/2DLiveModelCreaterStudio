// 開発・確認用の仮の腕サービス（AT-11）。本物（AT-12）が来るまで、状態と診断を時間で動かして画面を確かめる。
// カメラも推定器も使わない。校正は1手順ごとに少し待って成功する（failOnce の手順だけ1回目を失敗させる）
import {
  emptyArmMotionStatus,
  emptyBodyTrackingStatus,
  type ArmCalibrationStep,
  type ArmMotionStatus,
  type ArmServiceStatus,
} from '@app/contracts';
import {
  defaultArmTrackingSettings,
  HAND_SHAPES,
  type ArmCalibration,
  type ArmSide,
  type ArmTrackingSettings,
} from '@app/schema';
import type { ActorSide, ArmDiagnostics, DiagnosticPoint, StudioArmService } from './service';
import { actorSideOf } from './points';

export interface DemoArmServiceOptions {
  now?: () => number; // ページの単調時計（ms）
  captureMs?: number; // 1手順を集める時間
  failOnce?: ArmCalibrationStep | null; // この手順だけ1回目を失敗させる（失敗の表示の確認用）
  mirror?: () => boolean;
}

export interface DemoArmService extends StudioArmService {
  dispose(): void;
}

const FAIL_REASON: Record<ArmCalibrationStep, string> = {
  neutral: '両肩が写っていないフレームが多い。両肩を枠に入れる',
  bend: '右肘が写っていないフレームが多い。両肘を枠に入れる',
  left: '上げた手が案内と違う側だった。あなたの左手を上げる',
  right: '上げた手が案内と違う側だった。あなたの右手を上げる',
};

function demoCalibration(): ArmCalibration {
  const arm = { upper: 75, lower: 70 };
  return {
    version: 1,
    camera: { deviceId: null, width: 640, height: 480, fps: 30 },
    shoulderCenter: { x: 320, y: 230 },
    shoulderAxis: { x: 1, y: 0 },
    shoulderWidth: 128,
    arms: {
      left: { ...arm, neutralWrist: { x: 400, y: 440 } },
      right: { ...arm, neutralWrist: { x: 240, y: 440 } },
    },
  };
}

export function createDemoArmService(options: DemoArmServiceOptions = {}): DemoArmService {
  const now = options.now ?? (() => performance.now());
  const captureMs = options.captureMs ?? 1000;
  const mirror = options.mirror ?? (() => true);
  const failed = new Set<ArmCalibrationStep>();
  let settings: ArmTrackingSettings = defaultArmTrackingSettings();
  let calibration: ArmCalibration | null = null;
  let calibrationState: ArmServiceStatus['calibration'] = { state: 'empty', step: null, reason: null };
  let session = 0;
  let motion: Record<ArmSide, ArmMotionStatus> = { L: emptyArmMotionStatus(), R: emptyArmMotionStatus() };
  let diagnostics: ArmDiagnostics | null = null;
  const listeners = new Set<() => void>();
  const diagnosticListeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const notify = () => {
    for (const l of [...listeners]) l();
  };

  const motionAt = (side: ArmSide, t: number): ArmMotionStatus => {
    const s = settings.sides[side];
    if (!s.enabled) return emptyArmMotionStatus();
    const auto = s.handMode === 'auto';
    const shape = HAND_SHAPES[Math.floor(t / 1.5 + (side === 'R' ? 2 : 0)) % HAND_SHAPES.length]!;
    const inferred = side === 'R' && t % 8 > 6;
    return {
      state: inferred ? 'inferred' : 'tracking',
      handState: auto ? 'tracking' : 'fixed',
      pose: { shoulder: 30, elbow: 40, wrist: 0 },
      hand: auto ? shape : (s.handMode as (typeof HAND_SHAPES)[number]),
      reasons: inferred ? ['elbow'] : [],
    };
  };

  const point = (x: number, y: number, visibility = 0.95): DiagnosticPoint => ({ x, y, visibility });
  const diagnosticsAt = (t: number): ArmDiagnostics => {
    const wave = Math.sin(t * Math.PI * 2);
    const rightUp = t % 6 < 3; // 演者の右手は3秒ごとに上げ下げ
    const pose: NonNullable<ArmDiagnostics['pose']> = {
      // 未反転の画像：演者の右は画像の左
      right: {
        shoulder: point(0.4, 0.48),
        elbow: point(0.35, 0.66),
        wrist: rightUp ? point(0.3, 0.3) : point(0.36, 0.9, 0.3),
      },
      left: {
        shoulder: point(0.6, 0.48),
        elbow: point(0.67, 0.6),
        wrist: point(0.72 + 0.04 * wave, 0.3 + 0.02 * Math.cos(t * Math.PI * 2)),
      },
    };
    const sides: ArmDiagnostics['sides'] = {};
    for (const side of ['L', 'R'] as const) {
      if (!settings.sides[side].enabled) continue;
      const actor: ActorSide = actorSideOf(side, mirror());
      const up = actor === 'left' || rightUp;
      sides[side] = {
        actorSide: actor,
        validity: up ? 'valid' : 'inferred',
        elbow: { x: 0.25, y: 0.4 },
        wrist: up ? { x: 0.45, y: -0.45 + 0.05 * wave } : { x: 0.1, y: 0.95 },
        target: up ? { x: 60, y: -60 } : { x: 14, y: 128 },
        actual: up ? { x: 58, y: -57 } : { x: 14, y: 125 },
        reasons: motion[side].reasons,
      };
    }
    const hands = [pose.left.wrist!, ...(rightUp ? [pose.right.wrist!] : [])].map(({ x, y }) => ({ x, y }));
    return { time: now() - 40, image: { width: 640, height: 480 }, pose, hands, sides };
  };

  const tick = () => {
    const t = now() / 1000;
    const next = { L: motionAt('L', t), R: motionAt('R', t) };
    const changed = JSON.stringify(next) !== JSON.stringify(motion);
    motion = next;
    diagnostics = diagnosticsAt(t);
    for (const l of [...diagnosticListeners]) l();
    if (changed) notify();
  };
  const run = () => {
    if (timer === null && (listeners.size > 0 || diagnosticListeners.size > 0)) {
      tick();
      timer = setInterval(tick, 33);
    } else if (timer !== null && listeners.size === 0 && diagnosticListeners.size === 0) {
      clearInterval(timer);
      timer = null;
    }
  };
  const listen = (set: Set<() => void>, listener: () => void) => {
    set.add(listener);
    run();
    return () => {
      set.delete(listener);
      run();
    };
  };

  return {
    status(): ArmServiceStatus {
      const anyOn = settings.sides.L.enabled || settings.sides.R.enabled;
      return structuredClone({
        available: true,
        reason: null,
        tracking: {
          ...emptyBodyTrackingStatus(),
          generation: 1,
          pose: { state: 'ready', delegate: 'GPU', reason: '仮の腕サービス' },
          hands: { state: 'ready', delegate: 'GPU', reason: null },
          poseFps: anyOn ? 30 : null,
          handFps: anyOn ? (settings.mode === 'light' ? 15 : 30) : null,
        },
        motion,
        calibration: calibrationState,
        rigIssues: [],
      });
    },
    subscribe: (listener) => listen(listeners, listener),
    setSettings(next) {
      settings = structuredClone(next);
      motion = { L: motionAt('L', now() / 1000), R: motionAt('R', now() / 1000) };
      notify();
    },
    settings: () => structuredClone(settings),
    async captureCalibration(step) {
      const mine = ++session;
      calibrationState = { state: 'capturing', step, reason: null };
      notify();
      await new Promise((resolve) => setTimeout(resolve, captureMs));
      if (mine !== session) return; // 取り消された
      if (options.failOnce === step && !failed.has(step)) {
        failed.add(step);
        calibrationState = { state: 'invalid', step, reason: FAIL_REASON[step] };
      } else if (step === 'right') {
        calibration = demoCalibration();
        calibrationState = { state: 'ready', step: null, reason: null };
      }
      notify();
    },
    cancelCalibration() {
      session++;
      calibrationState = { state: calibration ? 'ready' : 'empty', step: null, reason: null };
      notify();
    },
    clearCalibration() {
      calibration = null;
      calibrationState = { state: 'empty', step: null, reason: null };
      notify();
    },
    calibration: () => structuredClone(calibration),
    diagnostics: () => diagnostics,
    onDiagnostics: (listener) => listen(diagnosticListeners, listener),
    dispose() {
      listeners.clear();
      diagnosticListeners.clear();
      run();
    },
  };
}
