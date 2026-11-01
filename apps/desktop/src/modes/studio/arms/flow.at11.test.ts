import type { ArmDiagnostics } from '@app/contracts';
import { FakeArmService } from '@app/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArmCalibrationFlow } from './flow';
import { actorSideOf, displayPoint, modelSideOf } from './points';

// CO独立入力。画面用TestArmServiceではなく、共通契約のFakeを使う。
function diagnostics(): ArmDiagnostics {
  const p = { x: 0.5, y: 0.5, visibility: 1 };
  return {
    time: 100,
    image: { width: 640, height: 480 },
    pose: { left: { shoulder: p, elbow: p, wrist: p }, right: { shoulder: p, elbow: p, wrist: p } },
    hands: [],
    sides: {},
  };
}
afterEach(() => vi.useRealTimers());

describe('AT-11 CO独立確認', () => {
  it('キャンセル後に旧サービスの撮影が完了しても、開始し直した校正を先へ進めない', async () => {
    vi.useFakeTimers();
    const flow = createArmCalibrationFlow(),
      first = new FakeArmService(),
      second = new FakeArmService();
    first.setDiagnostics(diagnostics());
    second.setDiagnostics(diagnostics());
    let finish: () => void = () => {};
    first.captureCalibration = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const capture = vi.spyOn(second, 'captureCalibration');
    flow.start(first);
    await vi.advanceTimersByTimeAsync(3000);
    expect(flow.state()).toMatchObject({ kind: 'capturing', step: 0 });
    flow.cancel();
    flow.start(second);
    finish();
    await Promise.resolve();
    expect(flow.state()).toEqual({ kind: 'countdown', step: 0, count: 3 });
    expect(capture).not.toHaveBeenCalled();
    flow.cancel();
    await vi.advanceTimersByTimeAsync(5000);
    expect(capture).not.toHaveBeenCalled();
    expect(flow.state()).toEqual({ kind: 'idle' });
  });

  it('低いvisibilityや画像外の肩では開始せず、キャンセル後の診断通知でも再開しない', async () => {
    vi.useFakeTimers();
    const flow = createArmCalibrationFlow(),
      service = new FakeArmService(),
      d = diagnostics();
    d.pose!.left.shoulder!.visibility = 0.49;
    const right = { ...d.pose!.right.shoulder!, x: 1.01 };
    d.pose!.right.shoulder = right;
    service.setDiagnostics(d);
    const capture = vi.spyOn(service, 'captureCalibration');
    flow.start(service);
    expect(flow.state()).toMatchObject({ kind: 'waiting', step: 0, missing: ['leftShoulder', 'rightShoulder'] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(capture).not.toHaveBeenCalled();
    flow.cancel();
    service.setDiagnostics(diagnostics());
    await vi.advanceTimersByTimeAsync(5000);
    expect(flow.state()).toEqual({ kind: 'idle' });
    expect(capture).not.toHaveBeenCalled();
  });

  it('640×480の画面座標でミラーを一度だけ反転し、演者とモデルの左右対応が往復できる', () => {
    expect(displayPoint({ x: 0.2, y: 0.75 }, false, { width: 640, height: 480 })).toEqual({ x: 128, y: 360 });
    expect(displayPoint({ x: 0.2, y: 0.75 }, true, { width: 640, height: 480 })).toEqual({ x: 512, y: 360 });
    for (const mirror of [true, false])
      for (const actor of ['left', 'right'] as const) {
        const side = modelSideOf(actor, mirror);
        expect(actorSideOf(side, mirror)).toBe(actor);
        expect(side).toBe((actor === 'right') === mirror ? 'L' : 'R');
      }
  });
});
