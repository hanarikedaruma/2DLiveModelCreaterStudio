// 腕の校正の手順の進め方（AT-11）。楽な姿勢 → 肘を軽く曲げる → 左手を上げる → 右手を上げる の4手順。
// 各手順は、要る点が写るのを待ち、3・2・1 と数えてから ArmService.captureCalibration(step) を呼ぶ（集めて確かめるのはサービス）。
// 4手順が終わったら「手形を試す」へ進む。キャンセルは cancelCalibration で途中の記録を捨て、前の校正を残す
import type { ArmCalibrationStep } from '@app/contracts';
import type { ArmSide, HandShape } from '@app/schema';
import type { StudioArmService } from './service';
import { missingParts, type BodyPart } from './points';

export const ARM_CALIBRATION_STEPS: readonly { id: ArmCalibrationStep; label: string; instruction: string }[] = [
  { id: 'neutral', label: '楽な姿勢', instruction: '両肩と両肘が枠に入るように座り、腕を楽に下ろす' },
  { id: 'bend', label: '肘を軽く曲げる', instruction: '両肘を軽く曲げて、両手首を枠の中に入れる' },
  { id: 'left', label: '左手を上げる', instruction: 'あなたの左手を、肩より高く上げる' },
  { id: 'right', label: '右手を上げる', instruction: 'あなたの右手を、肩より高く上げる' },
];
export const ARM_COUNTDOWN_FROM = 3;
export const ARM_COUNT_INTERVAL_MS = 1000;
export const NO_RESULT_MESSAGE = '腕の校正の値を求められなかった。もう一度行う';

// step は ARM_CALIBRATION_STEPS の番号
export type ArmCalibrationPhase =
  | { kind: 'idle' }
  | { kind: 'waiting'; step: number; missing: BodyPart[]; noPoints: boolean } // 要る点が写るのを待つ
  | { kind: 'countdown'; step: number; count: number }
  | { kind: 'capturing'; step: number }
  | { kind: 'failed'; step: number; message: string }
  | { kind: 'shapes'; seen: Record<ArmSide, HandShape[]> }; // 校正を保存した後、手形を試す

export type ScheduleFn = (cb: () => void, ms: number) => () => void;
const defaultSchedule: ScheduleFn = (cb, ms) => {
  const id = setTimeout(cb, ms);
  return () => clearTimeout(id);
};

export interface ArmCalibrationFlow {
  state(): ArmCalibrationPhase;
  subscribe(listener: () => void): () => void;
  active(): boolean; // 手順の途中（待つ・数える・集める・失敗）
  start(service: StudioArmService): void;
  retry(): void; // 失敗した手順をやり直す
  cancel(): void; // 途中ならやめる（前の校正はそのまま）。手形を試す画面ならそのまま閉じる
}

export function createArmCalibrationFlow(schedule: ScheduleFn = defaultSchedule): ArmCalibrationFlow {
  let phase: ArmCalibrationPhase = { kind: 'idle' };
  let service: StudioArmService | null = null;
  let token = 0; // 進めるたびに増やす。古い待ち・数え・集めの結果を捨てる
  let cleanup: (() => void)[] = [];
  const listeners = new Set<() => void>();

  const set = (next: ArmCalibrationPhase) => {
    phase = next;
    for (const l of [...listeners]) l();
  };
  const stop = () => {
    token++;
    for (const off of cleanup) off();
    cleanup = [];
  };
  const active = () => phase.kind !== 'idle' && phase.kind !== 'shapes';

  const fail = (step: number, message: string) => {
    stop();
    set({ kind: 'failed', step, message });
  };

  const enterStep = (step: number) => {
    stop();
    const s = service!;
    const id = ARM_CALIBRATION_STEPS[step]!.id;
    // 診断が来るたびに確かめる。足りない点が変わったときだけ知らせる
    const check = (first: boolean) => {
      if (!first && (phase.kind !== 'waiting' || phase.step !== step)) return;
      const diagnostics = s.diagnostics();
      const missing = missingParts(id, diagnostics);
      if (missing.length === 0) return countdown(step, ARM_COUNTDOWN_FROM);
      const noPoints = diagnostics?.pose == null;
      if (first || phase.kind !== 'waiting' || phase.missing.join() !== missing.join() || phase.noPoints !== noPoints)
        set({ kind: 'waiting', step, missing, noPoints });
    };
    cleanup.push(s.onDiagnostics(() => check(false)));
    check(true);
  };

  const countdown = (step: number, count: number) => {
    stop();
    const mine = token;
    set({ kind: 'countdown', step, count });
    cleanup.push(
      schedule(() => {
        if (mine !== token) return;
        if (count > 1) countdown(step, count - 1);
        else void capture(step);
      }, ARM_COUNT_INTERVAL_MS),
    );
  };

  const capture = async (step: number) => {
    stop();
    const mine = token;
    const s = service!;
    set({ kind: 'capturing', step });
    try {
      await s.captureCalibration(ARM_CALIBRATION_STEPS[step]!.id);
    } catch (e) {
      if (mine === token) fail(step, e instanceof Error ? e.message : String(e));
      return;
    }
    if (mine !== token) return;
    const result = s.status().calibration;
    if (result.state === 'invalid') return fail(step, result.reason ?? NO_RESULT_MESSAGE);
    if (step + 1 < ARM_CALIBRATION_STEPS.length) return enterStep(step + 1);
    if (result.state !== 'ready' || !s.calibration()) return fail(step, NO_RESULT_MESSAGE);
    shapes();
  };

  // 左右それぞれで、追従中に認識できた手形に印を付ける（成功の条件にはしない）
  const shapes = () => {
    stop();
    const s = service!;
    let seen: Record<ArmSide, HandShape[]> = { L: [], R: [] };
    const record = (first: boolean) => {
      const motion = s.status().motion;
      let changed = false;
      for (const side of ['L', 'R'] as const) {
        const hand = motion[side].handState === 'tracking' ? motion[side].hand : null;
        if (hand && !seen[side].includes(hand)) {
          seen = { ...seen, [side]: [...seen[side], hand] };
          changed = true;
        }
      }
      if (first || changed) set({ kind: 'shapes', seen });
    };
    cleanup.push(s.subscribe(() => record(false)));
    record(true);
  };

  return {
    state: () => phase,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    active,
    start(next) {
      if (active()) return;
      service = next;
      enterStep(0);
    },
    retry() {
      if (phase.kind === 'failed') enterStep(phase.step);
    },
    cancel() {
      if (phase.kind === 'idle') return;
      const wasActive = active();
      stop();
      if (wasActive) service?.cancelCalibration();
      set({ kind: 'idle' });
    },
  };
}
