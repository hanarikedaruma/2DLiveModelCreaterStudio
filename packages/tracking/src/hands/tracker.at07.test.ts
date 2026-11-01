import type { AssociatedHand } from '@app/contracts';
import type { HandShape } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { createHandShapeTracker } from './tracker';

// CO独立入力。SDKラベルや実装の特徴抽出器を使わず、手首からの距離で4本の指を作る。
function hand(shape: HandShape | null, at: number, rotation = 0, generation = 1): AssociatedHand {
  const extended: Record<HandShape, number[]> = { open: [0, 1, 2, 3], fist: [], point: [0], peace: [0, 1] };
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const c = Math.cos(rotation),
    s = Math.sin(rotation);
  for (let finger = 0; finger < 4; finger++) {
    const x = (finger - 1.5) * 0.08,
      y = -0.25;
    const ratio = shape === null ? 1.27 : extended[shape].includes(finger) ? 1.8 : 0.8;
    const mcp = 5 + finger * 4;
    for (let joint = 0; joint < 4; joint++) {
      const k = 1 + ((ratio - 1) * joint) / 3;
      points[mcp + joint] = { x: (x * c - y * s) * k, y: (x * s + y * c) * k, z: 0 };
    }
  }
  return {
    time: {
      generation,
      frameId: at + 1,
      capturedAt: at,
      completedAt: at + 10,
      receivedAt: at + 20,
      captureSource: 'captureTime',
    },
    validity: 'valid',
    landmarks: points,
    worldLandmarks: structuredClone(points),
    gesture: null,
  };
}

describe('AT-07 CO独立確認', () => {
  it.each(['open', 'fist', 'point', 'peace'] as const)(
    '%sを上・右・下・左向きでも同じ形と判定し、撮影120ms後に確定する',
    (shape) => {
      for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const t = createHandShapeTracker();
        expect(t.update('L', hand(shape, 0, angle)).confirmed).toBeNull();
        expect(t.update('L', hand(shape, 119, angle)).confirmed).toBeNull();
        const result = t.update('L', hand(shape, 120, angle));
        expect(result.confirmed).toBe(shape);
        expect(result.confirmedAt).toBe(120);
        expect(result.side).toBe('L');
        if (shape === 'point') {
          expect(result.pointDirection?.x).toBeCloseTo(
            (-0.12 * Math.cos(angle) + 0.25 * Math.sin(angle)) / Math.hypot(0.12, 0.25),
          );
        }
      }
    },
  );

  it('unknownやmissingで確定形の撮影時刻を延命せず、左右の履歴を混ぜない', () => {
    const t = createHandShapeTracker();
    t.update('L', hand('peace', 0));
    t.update('L', hand('peace', 120));
    t.update('R', hand('fist', 130));
    expect(t.update('L', hand(null, 160)).confirmedAt).toBe(120);
    const missing = { ...hand(null, 190), validity: 'missing' as const, landmarks: [], worldLandmarks: [] };
    expect(t.update('L', missing)).toMatchObject({ confirmed: 'peace', confirmedAt: 120, axisObservedAt: 160 });
    expect(t.result('R')?.confirmed).toBeNull();
  });

  it.each([15, 30, 60])('%ifpsでも120ms以上続くまで確定しない', (fps) => {
    const t = createHandShapeTracker();
    let confirmedAt: number | null = null;
    for (let i = 0; i < 12; i++) {
      const at = (i * 1000) / fps;
      const result = t.update('R', hand('peace', at));
      if (result.confirmed) {
        confirmedAt = at;
        break;
      }
      expect(at).toBeLessThan(120);
    }
    expect(confirmedAt).toBeGreaterThanOrEqual(120);
    expect(confirmedAt).toBeLessThan(120 + 1000 / fps);
  });

  it('掌の投影が潰れても手形を判定し、掌軸の鮮度だけは更新しない', () => {
    const t = createHandShapeTracker();
    t.update('L', hand('fist', 0));
    t.update('L', hand('fist', 120));
    const edge = hand('fist', 160);
    edge.landmarks = edge.landmarks.map((p) => ({ ...p, x: p.x * 0.01, y: p.y * 0.01 }));
    expect(t.update('L', edge)).toMatchObject({
      confirmed: 'fist',
      confirmedAt: 160,
      axisObservedAt: 120,
      candidate: { palmAxis: null },
    });
  });

  it('新世代とミラー変更で確定形を捨て、旧世代の結果で巻き戻らない', () => {
    const t = createHandShapeTracker({ mirror: true });
    t.update('L', hand('peace', 0));
    t.update('L', hand('peace', 120));
    expect(t.update('R', hand('fist', 200, 0, 2)).confirmed).toBeNull();
    expect(t.result('L')).toBeNull();
    t.update('R', hand('fist', 320, 0, 2));
    expect(t.update('R', hand('open', 400, 0, 1)).confirmed).toBe('fist');
    expect(t.result('R')?.time.generation).toBe(2);
    t.configure({ mirror: false });
    expect(t.result('R')).toBeNull();
  });
});
