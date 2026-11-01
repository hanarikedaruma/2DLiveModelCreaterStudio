import { describe, expect, it } from 'vitest';
import { actorSideOf, displayPoint, isVisible, missingParts, modelSideOf } from './points';
import { sampleDiagnostics } from './testService';

const box = { width: 320, height: 240 };

describe('骨格の座標とミラー', () => {
  it('ミラーONは鏡のように（演者の右肩が枠の右）、OFFはカメラから見たまま', () => {
    const rightShoulder = sampleDiagnostics().pose!.right.shoulder!; // 未反転の画像では左（x 0.4）
    expect(displayPoint(rightShoulder, true, box).x).toBeGreaterThan(box.width / 2);
    expect(displayPoint(rightShoulder, false, box).x).toBeLessThan(box.width / 2);
    expect(displayPoint(rightShoulder, true, box).y).toBe(displayPoint(rightShoulder, false, box).y);
  });

  it('枠の右に出る腕と、モデルの見る人から右の腕（モデルの左腕 L）が一致する', () => {
    for (const mirror of [true, false]) {
      const d = sampleDiagnostics();
      const onRight = (['left', 'right'] as const).find(
        (actor) => displayPoint(d.pose![actor].shoulder!, mirror, box).x > box.width / 2,
      )!;
      expect(modelSideOf(onRight, mirror)).toBe('L');
    }
  });

  it('モデルの側と演者の側は互いに逆の対応', () => {
    for (const mirror of [true, false])
      for (const side of ['L', 'R'] as const) expect(modelSideOf(actorSideOf(side, mirror), mirror)).toBe(side);
    expect(modelSideOf('right', true)).toBe('L');
    expect(modelSideOf('right', false)).toBe('R');
  });

  it('見えている点：visibility 0.5 以上で枠の中', () => {
    expect(isVisible({ x: 0.5, y: 0.5, visibility: 0.5 })).toBe(true);
    expect(isVisible({ x: 0.5, y: 0.5, visibility: 0.49 })).toBe(false);
    expect(isVisible({ x: 1.05, y: 0.5, visibility: 0.9 })).toBe(false);
    expect(isVisible({ x: Number.NaN, y: 0.5, visibility: 0.9 })).toBe(false);
    expect(isVisible(null)).toBe(false);
  });

  it('手順ごとに足りない点', () => {
    expect(missingParts('neutral', null)).toEqual(['leftShoulder', 'rightShoulder']);
    expect(missingParts('right', sampleDiagnostics(['leftShoulder', 'rightShoulder', 'leftWrist']))).toEqual([
      'rightWrist',
    ]);
    expect(missingParts('bend', sampleDiagnostics())).toEqual([]);
  });
});
