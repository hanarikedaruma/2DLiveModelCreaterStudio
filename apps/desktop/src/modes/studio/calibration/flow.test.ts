import { describe, expect, it, vi } from 'vitest';
import type { CalibrationService, TrackingFrame } from '@app/contracts';
import { createCalibrationService } from '@app/tracking';
import {
  COLLECT_MS,
  COUNT_INTERVAL_MS,
  MIN_CALIBRATION_FRAMES,
  NO_FACE_MESSAGE,
  createCalibrationFlow,
  type ScheduleFn,
} from './flow';

// 時刻を手で進める予定表
function manualSchedule() {
  let now = 0;
  let tasks: { at: number; cb: () => void }[] = [];
  const schedule: ScheduleFn = (cb, ms) => {
    const task = { at: now + ms, cb };
    tasks.push(task);
    return () => {
      tasks = tasks.filter((t) => t !== task);
    };
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = tasks.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      tasks = tasks.filter((t) => t !== next);
      now = next.at;
      next.cb();
    }
    now = end;
  };
  return { schedule, advance, pending: () => tasks.length };
}

// フレームを手で流すカメラ
function manualTracking() {
  const listeners = new Set<(f: TrackingFrame) => void>();
  return {
    onFrame(l: (f: TrackingFrame) => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    emit(f: TrackingFrame) {
      for (const l of [...listeners]) l(f);
    },
    listeners: () => listeners.size,
  };
}

function frame(patch: Partial<TrackingFrame> = {}): TrackingFrame {
  return {
    time: 0,
    detected: true,
    faceYaw: 0,
    facePitch: 0,
    faceRoll: 0,
    eyeOpenL: 1,
    eyeOpenR: 1,
    eyeBallX: 0,
    eyeBallY: 0,
    mouthOpen: 0,
    ...patch,
  };
}

function setup(calibration: CalibrationService = createCalibrationService()) {
  const timer = manualSchedule();
  const tracking = manualTracking();
  const flow = createCalibrationFlow(timer.schedule);
  const onComplete = vi.fn();
  const start = () => flow.start({ tracking, calibration, onComplete });
  return { timer, tracking, flow, onComplete, start, calibration };
}

describe('createCalibrationFlow', () => {
  it('3・2・1 と数えてから1秒ぶんのフレームを集め、3手順のあと結果を onComplete に渡す', () => {
    const { timer, tracking, flow, onComplete, start } = setup();
    expect(flow.state()).toEqual({ kind: 'idle' });
    start();
    expect(flow.state()).toEqual({ kind: 'countdown', step: 0, count: 3 });
    expect(flow.running()).toBe(true);
    // 数えている間のフレームは使わない
    tracking.emit(frame({ faceYaw: 40 }));
    timer.advance(COUNT_INTERVAL_MS);
    expect(flow.state()).toEqual({ kind: 'countdown', step: 0, count: 2 });
    timer.advance(COUNT_INTERVAL_MS);
    expect(flow.state()).toEqual({ kind: 'countdown', step: 0, count: 1 });
    timer.advance(COUNT_INTERVAL_MS);
    expect(flow.state()).toEqual({ kind: 'collecting', step: 0, frames: 0 });

    const steps: Partial<TrackingFrame>[] = [
      { faceYaw: 6, facePitch: -4, faceRoll: 2 },
      { eyeOpenL: 0.1, eyeOpenR: 0.2 },
      { mouthOpen: 0.7 },
    ];
    steps.forEach((patch, i) => {
      if (i > 0) {
        expect(flow.state()).toEqual({ kind: 'countdown', step: i, count: 3 });
        timer.advance(3 * COUNT_INTERVAL_MS);
      }
      expect(flow.state()).toMatchObject({ kind: 'collecting', step: i });
      for (let k = 0; k < 30; k++) tracking.emit(frame(patch));
      expect(flow.state()).toEqual({ kind: 'collecting', step: i, frames: 30 });
      timer.advance(COLLECT_MS);
    });

    const result = {
      neutral: { yaw: 6, pitch: -4, roll: 2 },
      eyeClosed: { l: 0.1, r: 0.2 },
      mouthOpenMax: 0.7,
    };
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(result);
    expect(flow.state()).toEqual({ kind: 'done', result });
    expect(flow.running()).toBe(false);
    expect(tracking.listeners()).toBe(0); // 終わったらフレームを受けない
    flow.cancel(); // 閉じる
    expect(flow.state()).toEqual({ kind: 'idle' });
  });

  it('各手順のフレームを、その手順として CalibrationService.capture に渡す。始めるときに reset する', () => {
    const calibration: CalibrationService = { capture: vi.fn(), result: vi.fn(() => null), reset: vi.fn() };
    const { timer, tracking, start } = setup(calibration);
    start();
    expect(calibration.reset).toHaveBeenCalledTimes(1);
    timer.advance(3 * COUNT_INTERVAL_MS);
    const frames = Array.from({ length: 10 }, (_, i) => frame({ time: i, faceYaw: i }));
    for (const f of frames) tracking.emit(f);
    timer.advance(COLLECT_MS);
    expect(calibration.capture).toHaveBeenCalledWith('neutral', frames);
  });

  it('検出できたフレームが少なければ、その手順を失敗にし、もう一度でその手順からやり直す', () => {
    const { timer, tracking, flow, onComplete, start } = setup();
    start();
    timer.advance(3 * COUNT_INTERVAL_MS);
    for (let k = 0; k < 30; k++) tracking.emit(frame({ faceYaw: 5 }));
    timer.advance(COLLECT_MS);
    // 2つ目の手順（目を閉じる）で顔が外れた
    timer.advance(3 * COUNT_INTERVAL_MS);
    for (let k = 0; k < 30; k++) tracking.emit(frame({ detected: k < MIN_CALIBRATION_FRAMES - 1 }));
    timer.advance(COLLECT_MS);
    expect(flow.state()).toEqual({ kind: 'failed', step: 1, message: NO_FACE_MESSAGE });
    expect(flow.running()).toBe(false);
    expect(timer.pending()).toBe(0);

    flow.retry();
    expect(flow.state()).toEqual({ kind: 'countdown', step: 1, count: 3 });
    timer.advance(3 * COUNT_INTERVAL_MS);
    for (let k = 0; k < 30; k++) tracking.emit(frame({ eyeOpenL: 0.3, eyeOpenR: 0.3 }));
    timer.advance(COLLECT_MS);
    timer.advance(3 * COUNT_INTERVAL_MS);
    for (let k = 0; k < 30; k++) tracking.emit(frame({ mouthOpen: 0.8 }));
    timer.advance(COLLECT_MS);
    // 1つ目の手順の値は取り直さずに残っている
    expect(onComplete).toHaveBeenCalledWith({
      neutral: { yaw: 5, pitch: 0, roll: 0 },
      eyeClosed: { l: 0.3, r: 0.3 },
      mouthOpenMax: 0.8,
    });
  });

  it('キャンセルすると数えるのをやめ、フレームを受けず、保存しない', () => {
    const { timer, tracking, flow, onComplete, start } = setup();
    start();
    timer.advance(COUNT_INTERVAL_MS);
    flow.cancel();
    expect(flow.state()).toEqual({ kind: 'idle' });
    expect(timer.pending()).toBe(0);
    expect(tracking.listeners()).toBe(0);
    timer.advance(10_000);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('途中で start し直すと最初の手順からやり直す（前のフレームの受け取りは外す）', () => {
    const { timer, tracking, flow, start } = setup();
    start();
    timer.advance(3 * COUNT_INTERVAL_MS + 500);
    start();
    expect(flow.state()).toEqual({ kind: 'countdown', step: 0, count: 3 });
    expect(tracking.listeners()).toBe(1);
    expect(timer.pending()).toBe(1);
  });

  it('変わるたびに subscribe した関数を呼ぶ。失敗していないときの retry は何もしない', () => {
    const { timer, flow, start } = setup();
    const listener = vi.fn();
    const off = flow.subscribe(listener);
    flow.retry();
    expect(listener).not.toHaveBeenCalled();
    start();
    timer.advance(COUNT_INTERVAL_MS);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    timer.advance(COUNT_INTERVAL_MS);
    expect(listener).toHaveBeenCalledTimes(2);
    flow.cancel();
  });
});
