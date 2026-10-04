// キャリブレーションの手順の進め方（カード35）。正面を向く・目を閉じる・口を大きく開ける の3手順を順に行う。
// 各手順は 3・2・1 と数えたあと、1秒ぶんのフレーム（services.tracking のミラー・キャリブレーションの前のもの）を集めて
// CalibrationService.capture に渡す。3手順が終わったら result() を onComplete に渡す（画面が Environment に保存する）
import type { CalibrationService, CalibrationStep, TrackingFrame, TrackingSource } from '@app/contracts';
import type { Environment } from '@app/schema';

export type CalibrationResult = NonNullable<Environment['calibration']>;

export const CALIBRATION_STEPS: readonly { id: CalibrationStep; label: string; instruction: string }[] = [
  { id: 'neutral', label: '正面を向く', instruction: 'カメラの正面を向いて、ふだんの顔のままでいる' },
  {
    id: 'eyesClosed',
    label: '目を閉じる',
    instruction: '正面を向いたまま、「1」になったら両目を閉じ、2秒ほどそのまま閉じている',
  },
  { id: 'mouthOpen', label: '口を大きく開ける', instruction: '正面を向いたまま、口をできるだけ大きく開ける' },
];

export const COUNTDOWN_FROM = 3; // 3・2・1
export const COUNT_INTERVAL_MS = 1000;
export const COLLECT_MS = 1000; // 1秒ぶんのフレームを集める
export const MIN_CALIBRATION_FRAMES = 5; // 検出できたフレームがこれより少なければ、その手順をやり直してもらう
export const NO_FACE_MESSAGE = '顔を見つけられなかった。カメラに顔を映して、もう一度行う';
export const NO_RESULT_MESSAGE = 'キャリブレーションの値を求められなかった。もう一度行う';

// step は CALIBRATION_STEPS の番号
export type CalibrationPhase =
  | { kind: 'idle' }
  | { kind: 'countdown'; step: number; count: number }
  | { kind: 'collecting'; step: number; frames: number } // frames: 集めた中で検出できたフレームの数
  | { kind: 'failed'; step: number; message: string }
  | { kind: 'done'; result: CalibrationResult };

export interface CalibrationTargets {
  tracking: Pick<TrackingSource, 'onFrame'>;
  calibration: CalibrationService;
  onComplete(result: CalibrationResult): void;
}

// 時間をおいて呼ぶ。戻り値で取り消す（テストでは差し替える）
export type ScheduleFn = (cb: () => void, ms: number) => () => void;

const defaultSchedule: ScheduleFn = (cb, ms) => {
  const id = setTimeout(cb, ms);
  return () => clearTimeout(id);
};

export interface CalibrationFlow {
  state(): CalibrationPhase;
  subscribe(listener: () => void): () => void;
  running(): boolean; // 数えている・集めている間
  start(targets: CalibrationTargets): void; // 前の値を消して、最初の手順から始める
  retry(): void; // 失敗した手順をやり直す
  cancel(): void; // やめる（保存しない。前のキャリブレーションはそのまま）。終わったあとに閉じるのもこれ
}

export function createCalibrationFlow(schedule: ScheduleFn = defaultSchedule): CalibrationFlow {
  let phase: CalibrationPhase = { kind: 'idle' };
  let targets: CalibrationTargets | null = null;
  let offFrames: (() => void) | null = null;
  let cancelTimer: (() => void) | null = null;
  let buffer: TrackingFrame[] = [];
  const listeners = new Set<() => void>();

  function set(next: CalibrationPhase) {
    phase = next;
    for (const l of [...listeners]) l();
  }

  function stopTimer() {
    cancelTimer?.();
    cancelTimer = null;
  }

  function release() {
    stopTimer();
    offFrames?.();
    offFrames = null;
    targets = null;
    buffer = [];
  }

  function countdown(step: number, count: number) {
    set({ kind: 'countdown', step, count });
    cancelTimer = schedule(() => {
      cancelTimer = null;
      if (count > 1) countdown(step, count - 1);
      else collect(step);
    }, COUNT_INTERVAL_MS);
  }

  function collect(step: number) {
    buffer = [];
    set({ kind: 'collecting', step, frames: 0 });
    cancelTimer = schedule(() => {
      cancelTimer = null;
      finish(step);
    }, COLLECT_MS);
  }

  function onFrame(frame: TrackingFrame) {
    if (phase.kind !== 'collecting') return;
    buffer.push(frame);
    if (frame.detected) set({ ...phase, frames: phase.frames + 1 });
  }

  function finish(step: number) {
    const t = targets;
    const def = CALIBRATION_STEPS[step];
    if (!t || !def) return;
    const frames = buffer;
    buffer = [];
    if (frames.filter((f) => f.detected).length < MIN_CALIBRATION_FRAMES) {
      set({ kind: 'failed', step, message: NO_FACE_MESSAGE });
      return;
    }
    t.calibration.capture(def.id, frames);
    if (step + 1 < CALIBRATION_STEPS.length) {
      countdown(step + 1, COUNTDOWN_FROM);
      return;
    }
    const result = t.calibration.result();
    if (!result) {
      set({ kind: 'failed', step, message: NO_RESULT_MESSAGE });
      return;
    }
    release();
    t.onComplete(result);
    set({ kind: 'done', result });
  }

  return {
    state: () => phase,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    running: () => phase.kind === 'countdown' || phase.kind === 'collecting',
    start(next) {
      release();
      targets = next;
      next.calibration.reset();
      offFrames = next.tracking.onFrame(onFrame);
      countdown(0, COUNTDOWN_FROM);
    },
    retry() {
      if (phase.kind !== 'failed' || !targets) return;
      countdown(phase.step, COUNTDOWN_FROM);
    },
    cancel() {
      release();
      if (phase.kind !== 'idle') set({ kind: 'idle' });
    },
  };
}
