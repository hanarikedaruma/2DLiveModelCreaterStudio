import { describe, expect, it } from 'vitest';
import type { HandShape } from '@app/schema';
import { createHandShapeTracker, SHAPE_TIMING, type HandShapeEstimate } from './tracker';
import { sampleTime, syntheticHand, type SyntheticHand } from './synthetic';

type Step = Omit<SyntheticHand, 'time'>;
const at = (t: number, step: Step, generation = 1) => syntheticHand({ ...step, time: sampleTime(t, generation) });

// fps の間隔で、shape の列（各要素が durationMs 続く）を流す
function play(fps: number, plan: [Step, number][], side: 'L' | 'R' = 'L', tracker = createHandShapeTracker()) {
  const dt = 1000 / fps;
  const out: HandShapeEstimate[] = [];
  let t = 0;
  for (const [step, duration] of plan) {
    const end = t + duration;
    for (; t < end - 1e-9; t += dt) out.push(tracker.update(side, at(t, step)));
  }
  return { out, tracker };
}
const firstConfirmed = (out: HandShapeEstimate[], shape: HandShape) =>
  out.find((r) => r.confirmed === shape)?.time.capturedAt ?? null;
const switches = (out: HandShapeEstimate[]) =>
  out.filter((r, i) => i > 0 && r.confirmed !== out[i - 1]!.confirmed).map((r) => r.confirmed);

describe('切替の安定化', () => {
  it('15/30/60fps で同じ時間（約120ms）続いてから切り替わる', () => {
    const delays = [15, 30, 60].map((fps) => {
      const { out } = play(fps, [
        [{ shape: 'open' }, 1000],
        [{ shape: 'fist' }, 1000],
      ]);
      return firstConfirmed(out, 'fist')! - 1000;
    });
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(SHAPE_TIMING.stableMs - 1e-6);
      expect(d).toBeLessThanOrEqual(SHAPE_TIMING.stableMs + 1000 / 15);
    }
    expect(Math.max(...delays) - Math.min(...delays)).toBeLessThanOrEqual(1000 / 15);
  });

  it('最初の形も約120ms続いてから確定する', () => {
    const { out } = play(30, [[{ shape: 'peace' }, 500]]);
    expect(out[0]!.confirmed).toBeNull();
    expect(firstConfirmed(out, 'peace')).toBeGreaterThanOrEqual(SHAPE_TIMING.stableMs - 1e-6);
  });

  it('短く変わるだけ・交互に揺れるだけでは切り替えない', () => {
    for (const fps of [15, 30, 60]) {
      const { out } = play(fps, [
        [{ shape: 'open' }, 500],
        [{ shape: 'fist' }, 100],
        [{ shape: 'open' }, 300],
        ...Array.from({ length: 10 }, (_, i): [Step, number] => [{ shape: i % 2 ? 'fist' : 'point' }, 1000 / fps]),
        [{ shape: 'open' }, 300],
      ]);
      expect(switches(out)).toEqual(['open']);
    }
  });

  it('境界の揺れ（開始の閾値をまたぐ）でも確定した形を保ち、切替待ちを始めない', () => {
    const noisy = (i: number): Step => ({
      shape: 'open',
      ratios: { index: i % 2 ? 1.33 : 1.45, ring: i % 3 ? 1.36 : 1.5 },
    });
    const tracker = createHandShapeTracker();
    play(30, [[{ shape: 'open' }, 400]], 'L', tracker);
    for (let i = 0; i < 30; i++) {
      const r = tracker.update('L', at(400 + i * 33, noisy(i)));
      expect(r.confirmed).toBe('open');
      expect(r.candidate.shape).toBe('open');
      expect(r.confirmedAt).toBe(400 + i * 33);
    }
  });

  it('unknown は新しい形にならず、確定した形と確定時刻（confirmedAt）を変えない', () => {
    const tracker = createHandShapeTracker();
    const { out } = play(30, [[{ shape: 'point' }, 400]], 'L', tracker);
    const confirmedAt = out.at(-1)!.confirmedAt;
    for (let t = 400; t < 1400; t += 33) {
      const r = tracker.update('L', at(t, { shape: 'fist', ratios: { index: 1.8, pinky: 1.8 } }));
      expect(r.candidate.shape).toBeNull();
      expect(r.confirmed).toBe('point');
      expect(r.confirmedAt).toBe(confirmedAt);
      expect(r.pending).toBeNull();
    }
  });

  it('unknown をはさむと、新しい候補の続きは途切れる', () => {
    const tracker = createHandShapeTracker();
    play(30, [[{ shape: 'open' }, 400]], 'L', tracker);
    tracker.update('L', at(400, { shape: 'fist' }));
    tracker.update('L', at(466, { shape: 'fist' }));
    tracker.update('L', at(500, { shape: 'fist', ratios: { middle: 1.3 } })); // 中指が決まらない
    expect(tracker.update('L', at(533, { shape: 'fist' })).confirmed).toBe('open');
    expect(tracker.update('L', at(533 + SHAPE_TIMING.stableMs, { shape: 'fist' })).confirmed).toBe('fist');
  });

  it('観測が200msより空いたら、切替待ちの候補を続いたとみなさない', () => {
    const tracker = createHandShapeTracker();
    play(30, [[{ shape: 'open' }, 400]], 'L', tracker);
    tracker.update('L', at(400, { shape: 'peace' }));
    const r = tracker.update('L', at(400 + SHAPE_TIMING.maxGapMs + 50, { shape: 'peace' }));
    expect(r.confirmed).toBe('open');
    expect(r.pending?.since).toBe(400 + SHAPE_TIMING.maxGapMs + 50);
  });

  it('手が見えない・所属が決まらない観測は候補を空にし、確定した形は保つ', () => {
    const tracker = createHandShapeTracker();
    play(30, [[{ shape: 'peace' }, 400]], 'L', tracker);
    for (const validity of ['missing', 'ambiguous'] as const) {
      const r = tracker.update('L', {
        ...at(400 + (validity === 'missing' ? 10 : 20), { shape: 'fist' }),
        validity,
        landmarks: [],
        worldLandmarks: [],
      });
      expect(r.validity).toBe(validity);
      expect(r.candidate).toEqual({ shape: null, score: 0, palmAxis: null });
      expect(r.confirmed).toBe('peace');
    }
  });

  it('掌の軸は切替待ちの間も毎回の観測から出し、観測できた時刻だけ axisObservedAt を進める', () => {
    const tracker = createHandShapeTracker();
    play(30, [[{ shape: 'open' }, 300]], 'L', tracker);
    const switching = tracker.update('L', at(300, { shape: 'fist', direction: 0 }));
    expect(switching.confirmed).toBe('open');
    expect(switching.candidate.palmAxis!.x).toBeCloseTo(1, 6);
    expect(switching.axisObservedAt).toBe(300);
    const collapsed = tracker.update('L', at(333, { shape: 'fist', tilt: 75 }));
    expect(collapsed.candidate.palmAxis).toBeNull();
    expect(collapsed.axisObservedAt).toBe(300);
  });

  it('指さしの向きは候補が指さしのときだけ返す', () => {
    const tracker = createHandShapeTracker();
    const point = tracker.update('L', at(0, { shape: 'point', direction: 0 }));
    expect(point.pointDirection!.x).toBeGreaterThan(0.9);
    expect(tracker.update('L', at(33, { shape: 'open', direction: 0 })).pointDirection).toBeNull();
  });

  it('左右は独立', () => {
    const tracker = createHandShapeTracker();
    for (let t = 0; t < 500; t += 33) {
      tracker.update('L', at(t, { shape: 'fist' }));
      tracker.update('R', at(t, { shape: t < 250 ? 'open' : 'peace' }));
    }
    expect(tracker.result('L')!.confirmed).toBe('fist');
    expect(tracker.result('R')!.confirmed).toBe('peace');
  });

  it('同じか古い撮影時刻の観測は受け付けない', () => {
    const tracker = createHandShapeTracker();
    play(30, [[{ shape: 'open' }, 400]], 'L', tracker);
    const last = tracker.result('L')!;
    expect(tracker.update('L', at(100, { shape: 'fist' }))).toBe(last);
    expect(tracker.update('L', at(last.time.capturedAt, { shape: 'fist' }))).toBe(last);
  });

  it('世代が変わると履歴を捨て、古い世代の観測は受け付けない', () => {
    const tracker = createHandShapeTracker();
    play(30, [[{ shape: 'open' }, 400]], 'L', tracker);
    const fresh = tracker.update('L', at(10, { shape: 'open' }, 2));
    expect(fresh.confirmed).toBeNull();
    expect(fresh.pending?.since).toBe(10);
    tracker.update('R', at(20, { shape: 'fist' }, 2));
    tracker.reset(3);
    expect(tracker.result('L')).toBeNull();
    const old = tracker.update('L', at(500, { shape: 'fist' }, 2));
    expect(old.confirmed).toBeNull();
    expect(old.candidate.shape).toBeNull();
    expect(tracker.result('L')).toBeNull();
  });

  it('ミラーを変えると両側の履歴を捨てる（同じ値の設定では捨てない）', () => {
    const tracker = createHandShapeTracker({ mirror: true });
    play(30, [[{ shape: 'open' }, 400]], 'L', tracker);
    tracker.configure({ mirror: true });
    expect(tracker.result('L')!.confirmed).toBe('open');
    tracker.configure({ mirror: false });
    expect(tracker.result('L')).toBeNull();
    expect(tracker.update('L', at(500, { shape: 'open' })).confirmed).toBeNull();
  });
});
