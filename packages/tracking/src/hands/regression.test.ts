// AT-01 の実カメラの点列（2回目の収録、片手の手形の区間を各0.6秒）を、AT-05 の対応付け → 手形の判定へ流す。
// 区間は収録の順につないであり、前の区間の形から次の区間の形への切替も含む（区間の間は約10秒空く）。
import { describe, expect, it } from 'vitest';
import type { ArmSide } from '@app/schema';
import { createBodyAssociation } from '../body';
import { loadShapeFixture, type ShapeTruth } from './fixtures';
import { createHandShapeTracker, type HandShapeEstimate } from './tracker';

interface Clip {
  step: string;
  truth: ShapeTruth;
  start: number; // 区間の最初の撮影時刻
  results: HandShapeEstimate[]; // 案内の側の結果（手が割り当たったフレーム）
  hands: number; // 案内の側に手が割り当たったフレーム
  frames: number;
}

function replay(mirror: boolean): Clip[] {
  const association = createBodyAssociation({ mirror });
  const tracker = createHandShapeTracker({ mirror });
  const clips: Clip[] = [];
  for (const { step, truth, frame } of loadShapeFixture('at01-shapes.json')) {
    const out = association.update(frame);
    const results: Partial<Record<ArmSide, HandShapeEstimate>> = {};
    for (const side of ['L', 'R'] as const) {
      const hand = out.hands[side];
      if (hand) results[side] = tracker.update(side, hand);
    }
    let clip = clips.at(-1);
    if (clip?.step !== step) {
      clip = { step, truth, start: (frame.hands ?? frame.pose)!.time.capturedAt, results: [], hands: 0, frames: 0 };
      clips.push(clip);
    }
    clip.frames++;
    const own = truth.active[0] === 'right' ? (mirror ? 'L' : 'R') : mirror ? 'R' : 'L';
    const result = results[own];
    if (result && result.validity !== 'missing' && result.validity !== 'ambiguous') {
      clip.hands++;
      clip.results.push(result);
    }
  }
  return clips;
}

function summarize(clip: Clip) {
  const shape = clip.truth.shape!;
  const confirmedAt = clip.results.find((r) => r.confirmed === shape)?.time.capturedAt ?? null;
  const after = confirmedAt === null ? [] : clip.results.filter((r) => r.time.capturedAt >= confirmedAt);
  const points = clip.results.filter((r) => r.candidate.shape === 'point');
  return {
    hands: clip.hands,
    candidateHits: clip.results.filter((r) => r.candidate.shape === shape).length,
    wrongCandidates: clip.results.filter((r) => r.candidate.shape !== null && r.candidate.shape !== shape).length,
    delay: confirmedAt === null ? null : confirmedAt - clip.start, // 区間の最初から正しい形が確定するまで
    keptAfterConfirm: after.every((r) => r.confirmed === shape),
    axes: clip.results.filter((r) => r.candidate.palmAxis !== null).length,
    pointDirections: points.flatMap((r) => (r.pointDirection ? [r.pointDirection] : [])),
    pointCandidates: points.length,
  };
}

describe('実カメラの点列（AT-01 2回目）', () => {
  const clips = replay(true);
  const byStep = Object.fromEntries(clips.map((c) => [c.step, summarize(c)]));

  it('全ての区間で正しい形が250ms以内に確定し、区間の終わりまで変わらない', () => {
    expect(clips.map((c) => c.step)).toEqual([
      'wave-right',
      'wave-left',
      'point-up-right',
      'point-side-right',
      'point-diag-right',
      'point-side-left',
      'point-diag-left',
      'point-camera-right',
      'peace-face-right',
      'fist-right',
      'fist-left',
      'flip-right',
    ]);
    for (const clip of clips) {
      const s = byStep[clip.step]!;
      expect(s.delay, clip.step).not.toBeNull();
      expect(s.delay!, clip.step).toBeLessThanOrEqual(250);
      expect(s.keptAfterConfirm, clip.step).toBe(true);
    }
  });

  it('候補の正答率（案内の側の手が割り当たったフレーム）', () => {
    for (const clip of clips) {
      const s = byStep[clip.step]!;
      // カメラへ向けた指さしは弱い（人さし指が短く写り、SDK が手を見つけないフレームも多い。AT-07 報告）
      const minimum = clip.step === 'point-camera-right' ? 0.4 : 0.9;
      expect(s.candidateHits / s.hands, clip.step).toBeGreaterThanOrEqual(minimum);
    }
  });

  it('横・斜め・上の指さしの向き（肩の座標、外向き+x・下+y）', () => {
    const mean = (step: string) => {
      const d = byStep[step]!.pointDirections;
      const x = d.reduce((a, v) => a + v.x, 0) / d.length;
      const y = d.reduce((a, v) => a + v.y, 0) / d.length;
      return { x, y, n: d.length };
    };
    const up = mean('point-up-right');
    expect(up.y).toBeLessThan(-0.9);
    for (const step of ['point-side-right', 'point-side-left']) expect(mean(step).x, step).toBeGreaterThan(0.9);
    for (const step of ['point-diag-right', 'point-diag-left']) {
      const d = mean(step);
      expect(d.x, step).toBeGreaterThan(0.8);
      expect(d.y, step).toBeLessThan(-0.1);
    }
  });

  it('カメラへ向けた指さしでは、潰れた人さし指の向きを返さないフレームがある', () => {
    const s = byStep['point-camera-right']!;
    expect(s.pointDirections.length).toBeLessThan(s.pointCandidates);
  });

  it('ミラーを切っても同じ形が確定し、割り当たる側だけが入れ替わる', () => {
    const off = replay(false).map(summarize);
    const on = clips.map(summarize);
    expect(off.map((s) => [s.candidateHits, s.delay, s.keptAfterConfirm])).toEqual(
      on.map((s) => [s.candidateHits, s.delay, s.keptAfterConfirm]),
    );
  });
});
