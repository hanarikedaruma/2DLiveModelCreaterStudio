// 腕のサービス（AT-12）。体の推定（AT-04、顔と同じカメラ）→ 左右の対応付け（AT-05）→ 手形（AT-07）→
// 腕の追従（AT-09、IKはAT-06）を組み立て、CC-032 の ArmService として画面（AT-11）へ渡す。
// 設定は Project.armTracking（Undoできるプロジェクトの変更）、校正は Environment.armCalibration（保存は外から渡す関数）。
// 腕の層（tick）と、フレームの後の受け取り（afterFrame）はスタジオの実行部が呼ぶ
import type {
  ArmCalibrationStep,
  ArmDiagnosticPoint,
  ArmDiagnostics,
  ArmMotionStatus,
  ArmService,
  ArmServiceStatus,
  BodyTrackingCapability,
  BodyTrackingConfig,
  BodyTrackingFrame,
  Command,
  HandShapeResult,
  Layer,
  NormalizedBodyFrame,
  ParamValues,
  ProjectStore,
  TrackingSource,
} from '@app/contracts';
import { emptyArmMotionStatus, emptyBodyTrackingStatus } from '@app/contracts';
import { constrainArmPose, createArmMotionSession, forwardArm, solveArmIK } from '@app/core';
import {
  defaultArmTrackingSettings,
  inspectArmRigs,
  type ArmCalibration,
  type ArmSide,
  type ArmTrackingSettings,
  type Project,
} from '@app/schema';
import {
  computeArmCalibration,
  createBodyAssociation,
  createHandShapeTracker,
  type CalibrationSample,
} from '@app/tracking';

const SIDES: ArmSide[] = ['L', 'R'];
export const CALIBRATION_COLLECT_MS = 1000; // 1手順で集める撮影時刻の長さ
export const CALIBRATION_TIMEOUT_MS = 4000; // この間に点が来なければ失敗にする
const STEPS: ArmCalibrationStep[] = ['neutral', 'bend', 'left', 'right'];
const POSE_INDEX = { left: { shoulder: 11, elbow: 13, wrist: 15 }, right: { shoulder: 12, elbow: 14, wrist: 16 } };

export interface ArmServiceDeps {
  store: Pick<ProjectStore, 'get' | 'subscribe' | 'dispatch'>;
  tracking: Pick<TrackingSource, 'body' | 'captureStats'>;
  schedule?: (cb: () => void, ms: number) => () => void;
}

// スタジオの実行部・環境設定の結び付けが使う、契約の外の口
export interface ArmRuntime {
  attach(): () => void; // スタジオがつながっている間だけ体の推定を購読する
  tick(now: number): Layer | null; // 腕の層
  afterFrame(frame: { layers: Layer[]; params: ParamValues }): void; // 表情・アニメーションの上書きの終わりを見る
  setMirror(on: boolean): void;
  setCalibration(calibration: ArmCalibration | null): void; // Environment から
  setCameraDeviceId(id: string | null): void;
  onCalibrationChange(save: (calibration: ArmCalibration | null) => void): () => void; // Environment へ保存する
  feed(frame: BodyTrackingFrame): void; // 体の推定の通知（試験・開発の確認でも使う）
  dispose(): void;
}

export type ArmServiceWithRuntime = ArmService & { readonly runtime: ArmRuntime };

const runtimes = new WeakMap<object, ArmRuntime>();
// services.arms（契約の型）から実行部の口を取り出す。本物以外（仮サービス）なら null
export function armRuntimeOf(service: ArmService | undefined): ArmRuntime | null {
  return service ? (runtimes.get(service) ?? null) : null;
}

const settingsOf = (project: Project): ArmTrackingSettings => project.armTracking ?? defaultArmTrackingSettings();
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function createArmService(deps: ArmServiceDeps): ArmServiceWithRuntime {
  const schedule =
    deps.schedule ??
    ((cb: () => void, ms: number) => {
      const id = setTimeout(cb, ms);
      return () => clearTimeout(id);
    });
  let mirror = true;
  let calibrationValue: ArmCalibration | null = null;
  let deviceId: string | null = null;
  const association = createBodyAssociation({ mirror, calibration: null });
  const hands = createHandShapeTracker({ mirror });
  const session = createArmMotionSession({ solveIK: solveArmIK, constrain: constrainArmPose });

  const listeners = new Set<() => void>();
  const diagnosticListeners = new Set<() => void>();
  const savers = new Set<(c: ArmCalibration | null) => void>();
  let diagnosticsValue: ArmDiagnostics | null = null;
  let calibrationState: ArmServiceStatus['calibration'] = { state: 'empty', step: null, reason: null };
  let motionKey = '';
  let motion: Record<ArmSide, ArmMotionStatus> = { L: emptyArmMotionStatus(), R: emptyArmMotionStatus() };
  let lastGeneration = 0;
  let lastDisplayed: ParamValues = {};
  let attachments = 0;
  let offBody: (() => void)[] = [];
  let bodyConfig: BodyTrackingConfig | null = null;
  let project = deps.store.get();

  const notify = () => {
    for (const l of [...listeners]) l();
  };
  const body = (): BodyTrackingCapability | undefined => deps.tracking.body;

  // 校正の手順の記録
  let samples: CalibrationSample[] = [];
  let capture: {
    step: ArmCalibrationStep;
    startAt: number | null;
    finish: (problem: string | null) => void;
    cancelTimeout: () => void;
    resolve: () => void;
  } | null = null;

  // 体の推定を動かすのは、左右のどちらかを入れていて、その側に有効な腕の設定がある間だけ（判断2）
  function wantedConfig(): BodyTrackingConfig {
    const settings = settingsOf(project);
    const rigs = project.model.armRigs ?? [];
    const enabled =
      attachments > 0 &&
      SIDES.some((side) => settings.sides[side].enabled && rigs.some((r) => r.side === side && r.enabled));
    return { enabled: enabled || capture !== null, mode: settings.mode, hands: true };
  }
  function configureBody() {
    const b = body();
    if (!b) return;
    const next = wantedConfig();
    if (bodyConfig && sameJson(bodyConfig, next)) return; // 同じ設定で世代を上げない
    bodyConfig = next;
    b.configure(next);
  }

  function applyProject(next: Project) {
    project = next;
    session.configure(next.model, settingsOf(next));
    configureBody();
  }
  applyProject(project);
  const offStore = deps.store.subscribe((p) => {
    if (p.model === project.model && p.armTracking === project.armTracking) {
      project = p;
      return;
    }
    applyProject(p);
    notify();
  });

  function resetSession() {
    session.reset(lastGeneration, lastDisplayed);
  }

  function diagnosticsOf(frame: BodyTrackingFrame, normalized: NormalizedBodyFrame): ArmDiagnostics {
    const time = (frame.pose ?? frame.hands)!.time.capturedAt;
    const landmarks = frame.pose?.value.landmarks ?? null;
    const point = (i: number): ArmDiagnosticPoint | null => {
      const p = landmarks?.[i];
      return p ? { x: p.x, y: p.y, visibility: p.visibility } : null;
    };
    const previous = diagnosticsValue;
    const pose = landmarks
      ? landmarks.length
        ? {
            left: {
              shoulder: point(POSE_INDEX.left.shoulder),
              elbow: point(POSE_INDEX.left.elbow),
              wrist: point(POSE_INDEX.left.wrist),
            },
            right: {
              shoulder: point(POSE_INDEX.right.shoulder),
              elbow: point(POSE_INDEX.right.elbow),
              wrist: point(POSE_INDEX.right.wrist),
            },
          }
        : null
      : (previous?.pose ?? null); // 手だけの通知では、前の Pose の点を残す
    const handWrists = frame.hands
      ? frame.hands.value.flatMap((h) => (h.landmarks[0] ? [{ x: h.landmarks[0].x, y: h.landmarks[0].y }] : []))
      : (previous?.hands ?? []);
    const sides: ArmDiagnostics['sides'] = { ...(previous?.sides ?? {}) };
    const rigs = project.model.armRigs ?? [];
    for (const side of SIDES) {
      const arm = normalized.arms[side];
      if (!arm) continue;
      const rig = rigs.find((r) => r.side === side);
      const length = rig ? rig.lengths.upper + rig.lengths.lower : null;
      const pose = motion[side].pose;
      sides[side] = {
        actorSide: arm.actorSide,
        validity: arm.validity,
        elbow: arm.elbow.position,
        wrist: arm.wrist.position,
        target:
          arm.wrist.position && length !== null
            ? { x: arm.wrist.position.x * length, y: arm.wrist.position.y * length }
            : null,
        actual: rig && pose ? forwardArm(rig, pose).wrist : null,
        reasons: [...motion[side].reasons],
      };
    }
    return { time, image: { ...frame.image }, pose, hands: handWrists, sides };
  }

  function feed(frame: BodyTrackingFrame) {
    const sample = frame.pose ?? frame.hands;
    if (!sample) return;
    lastGeneration = Math.max(lastGeneration, sample.time.generation);
    const normalized = association.update(frame);
    const shapes: Partial<Record<ArmSide, HandShapeResult>> = {};
    for (const side of SIDES) {
      const hand = normalized.hands[side];
      if (hand) shapes[side] = hands.update(side, hand);
    }
    session.update({ body: normalized, shapes });
    if (capture && frame.pose && frame.pose.value.landmarks.length) collect(frame);
    diagnosticsValue = diagnosticsOf(frame, normalized);
    for (const l of [...diagnosticListeners]) l();
  }

  function collect(frame: BodyTrackingFrame) {
    const c = capture!;
    const t = frame.pose!.time.capturedAt;
    if (c.startAt === null) c.startAt = t;
    samples.push({ step: c.step, pose: frame.pose!.value, image: { ...frame.image } });
    if (t - c.startAt >= CALIBRATION_COLLECT_MS) c.finish(null);
  }

  function cameraOf() {
    const stats = deps.tracking.captureStats();
    const image = diagnosticsValue?.image;
    return {
      deviceId,
      width: stats?.width ?? image?.width ?? 0,
      height: stats?.height ?? image?.height ?? 0,
      fps: stats?.trackingFps ?? stats?.nominalFps ?? stats?.requestedFps ?? 30,
    };
  }

  function saveCalibration(next: ArmCalibration | null) {
    calibrationValue = next;
    association.configure({ mirror, calibration: next });
    resetSession();
    for (const save of [...savers]) save(next);
  }

  function setCalibrationState(state: ArmServiceStatus['calibration']) {
    calibrationState = state;
    notify();
  }

  const service: ArmService = {
    settings: () => structuredClone(settingsOf(deps.store.get())),
    setSettings(next) {
      const current = deps.store.get();
      if (sameJson(settingsOf(current), next)) return;
      const value = structuredClone(next);
      // 判断1：プロジェクトの変更として Undo できる
      const command: Command = { label: '腕・手の設定を変更', apply: (p) => ({ ...p, armTracking: value }) };
      deps.store.dispatch(command);
    },
    status(): ArmServiceStatus {
      const b = body();
      return {
        available: !!b,
        reason: b ? null : 'この推定元は腕・手の推定に対応していない',
        tracking: b ? b.status() : emptyBodyTrackingStatus(),
        motion: structuredClone(motion),
        calibration: { ...calibrationState },
        rigIssues: inspectArmRigs(project.model),
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    captureCalibration(step) {
      capture?.finish('別の手順を始めた');
      if (step === 'neutral') samples = [];
      setCalibrationState({ state: 'capturing', step, reason: null });
      return new Promise<void>((resolve) => {
        const entry = {
          step,
          startAt: null as number | null,
          finish: (problem: string | null) => {
            if (capture !== entry) return;
            capture = null;
            entry.cancelTimeout();
            configureBody();
            if (problem) {
              setCalibrationState({ state: 'invalid', step, reason: problem });
            } else if (step === 'right' || STEPS.indexOf(step) === STEPS.length - 1) {
              const result = computeArmCalibration(samples, cameraOf());
              samples = [];
              if (result.calibration) {
                saveCalibration(result.calibration);
                setCalibrationState({ state: 'ready', step: null, reason: null });
              } else setCalibrationState({ state: 'invalid', step, reason: result.problems.join('。') });
            }
            resolve();
          },
          cancelTimeout: () => {},
          resolve,
        };
        capture = entry;
        entry.cancelTimeout = schedule(
          () => entry.finish('体の点が来ていない（カメラと腕の認識が動いているか確かめる）'),
          CALIBRATION_TIMEOUT_MS,
        );
        configureBody(); // 校正の間は体の推定を動かす
      });
    },
    cancelCalibration() {
      const c = capture;
      capture = null;
      c?.cancelTimeout();
      samples = [];
      configureBody();
      setCalibrationState({ state: calibrationValue ? 'ready' : 'empty', step: null, reason: null });
      c?.resolve(); // 待っている captureCalibration は、何も保存せずに終える
    },
    clearCalibration() {
      saveCalibration(null);
      setCalibrationState({ state: 'empty', step: null, reason: null });
    },
    calibration: () => structuredClone(calibrationValue),
    diagnostics: () => structuredClone(diagnosticsValue),
    onDiagnostics(listener) {
      diagnosticListeners.add(listener);
      return () => {
        diagnosticListeners.delete(listener);
      };
    },
  };

  const runtime: ArmRuntime = {
    attach() {
      attachments += 1;
      if (attachments === 1) {
        const b = body();
        if (b) offBody = [b.onFrame(feed), b.onStatus(notify)];
        configureBody();
      }
      let attached = true;
      return () => {
        if (!attached) return;
        attached = false;
        attachments -= 1;
        if (attachments === 0) {
          for (const off of offBody) off();
          offBody = [];
          configureBody();
        }
      };
    },
    tick(t) {
      const layer = session.tick(t);
      const status = session.status();
      // 姿勢の数値は毎フレーム変わるので、状態・手形・理由が変わったときだけ画面へ知らせる
      const key = JSON.stringify(
        SIDES.map((s) => [status[s].state, status[s].handState, status[s].hand, status[s].reasons]),
      );
      motion = status;
      if (key !== motionKey) {
        motionKey = key;
        notify();
      }
      return layer;
    },
    afterFrame(frame) {
      lastDisplayed = frame.params;
      const rigs = project.model.armRigs ?? [];
      for (const side of SIDES) {
        const rig = rigs.find((r) => r.side === side);
        if (!rig) continue;
        const ids = [rig.parameters.shoulder, rig.parameters.elbow, rig.parameters.wrist];
        // 腕の層より上（表情・ホットキー・アニメーションなど）が、この側の腕を重み1で上書きしたか
        const full = frame.layers.some(
          (layer) =>
            layer.id !== 'tracking' &&
            ids.some(
              (id) =>
                id in layer.values &&
                (layer.blend?.[id] ?? 'override') === 'override' &&
                (layer.parameterWeights?.[id] ?? layer.weight) >= 0.999,
            ),
        );
        // 上書きの間は出力を表示中の姿勢に合わせ続け、終わった次のフレームから追従へつなぐ（跳ばない）
        if (full) session.resumeFrom(side, frame.params);
      }
    },
    setMirror(on) {
      if (on === mirror) return;
      mirror = on;
      association.configure({ mirror, calibration: calibrationValue });
      hands.configure({ mirror });
      resetSession(); // いきなり左右を入れ替えず、休止を経て反対の手で再取得する
      notify();
    },
    setCalibration(next) {
      if (sameJson(next, calibrationValue)) return;
      calibrationValue = next ? structuredClone(next) : null;
      association.configure({ mirror, calibration: calibrationValue });
      resetSession();
      if (!capture) calibrationState = { state: calibrationValue ? 'ready' : 'empty', step: null, reason: null };
      notify();
    },
    setCameraDeviceId(id) {
      deviceId = id;
    },
    onCalibrationChange(save) {
      savers.add(save);
      return () => {
        savers.delete(save);
      };
    },
    feed,
    dispose() {
      offStore();
      for (const off of offBody) off();
      offBody = [];
      capture?.cancelTimeout();
      capture = null;
      listeners.clear();
      diagnosticListeners.clear();
      savers.clear();
    },
  };
  runtimes.set(service, runtime);
  return Object.assign(service, { runtime });
}
