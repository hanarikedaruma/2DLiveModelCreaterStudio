import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Environment } from '@app/schema';
import type { CameraVideo } from './camera';
import { CaptureSession } from './capture';

const AUTO = { mode: 'auto', width: 640, height: 480, fps: 60 } as const;
const sessions: CaptureSession[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  for (const s of sessions.splice(0)) s.stop();
  vi.useRealTimers();
});

function setup(settings: Environment['cameraCapture'] = AUTO) {
  let frames = 0;
  const actual = { width: 640, height: 480, frameRate: 30 };
  const track = {
    getSettings: () => ({ ...actual }),
    getCapabilities: () => ({ frameRate: { min: 1, max: 60 } }),
    applyConstraints: vi.fn(async (c: MediaTrackConstraints) => {
      actual.width = (c.width as ConstrainULongRange).exact ?? (c.width as ConstrainULongRange).ideal!;
      actual.height = (c.height as ConstrainULongRange).exact ?? (c.height as ConstrainULongRange).ideal!;
    }),
  };
  const video: CameraVideo = {
    image: {} as HTMLVideoElement,
    frameCount: () => frames,
    play: async () => {},
    release() {},
    onNextFrame: () => () => {},
  };
  const changed = vi.fn();
  const session = new CaptureSession(track, video, settings, changed, () => Date.now());
  sessions.push(session);
  session.start();
  const window = async (cameraFps: number, trackingFps: number) => {
    frames += cameraFps;
    for (let i = 0; i < trackingFps; i++) session.estimated();
    await vi.advanceTimersByTimeAsync(1000);
  };
  return { session, track, actual, changed, window };
}

describe('カメラ設定の実測選択（I-001/002）', () => {
  it('カメラ映像と推定を別々に測り、映像が止まれば0を出す', async () => {
    const { session, window, track } = setup({ ...AUTO, mode: 'manual' });
    await window(30, 12);
    await window(30, 12);
    expect(session.stats()).toMatchObject({
      cameraFps: 30,
      trackingFps: 12,
      nominalFps: 30,
      requestedFps: 60,
      state: 'ready',
    });
    expect(session.stats().warning).toContain('要求60');
    await window(0, 0);
    expect(session.stats()).toMatchObject({ cameraFps: 0, trackingFps: 0 });
    expect(track.applyConstraints).not.toHaveBeenCalled();
  });

  it('初期設定で映像と推定が60fpsなら、再設定しない', async () => {
    const { session, window, track } = setup();
    await window(60, 60);
    await window(60, 60);
    expect(session.stats()).toMatchObject({ state: 'ready', cameraFps: 60, trackingFps: 60, maxFps: 60 });
    expect(track.applyConstraints).not.toHaveBeenCalled();
  });

  it('3つの解像度を実測し、映像の追従性が高い候補へ戻す', async () => {
    const { session, window, track } = setup();
    await window(15, 12);
    await window(15, 12);
    expect(session.stats().width).toBe(320);
    await window(30, 20);
    await window(30, 20);
    expect(session.stats().width).toBe(1280);
    await window(15, 10);
    await window(15, 10);
    expect(session.stats()).toMatchObject({ width: 320, height: 240, state: 'ready' });
    expect(track.applyConstraints).toHaveBeenCalledTimes(3);
  });

  it('同程度なら初期解像度を保持し、動かない候補は飛ばす', async () => {
    const { session, window, track } = setup();
    track.applyConstraints.mockRejectedValueOnce(new Error('320不可'));
    await window(30, 20);
    await window(30, 20);
    expect(session.stats().width).toBe(1280);
    await window(30, 20);
    await window(30, 20);
    expect(session.stats()).toMatchObject({ width: 640, height: 480, state: 'ready' });
  });

  it('映像だけ速い候補より、顔の推定まで追従できる候補を選ぶ', async () => {
    const { session, window } = setup();
    await window(60, 12);
    await window(60, 12);
    await window(30, 25);
    await window(30, 25);
    await window(60, 10);
    await window(60, 10);
    expect(session.stats()).toMatchObject({ width: 320, height: 240, state: 'ready' });
  });

  it('手動の不適合はエラーとして表示し、元の実動作を表示する', async () => {
    const { session, track } = setup();
    track.applyConstraints.mockRejectedValueOnce(new Error('1080p不可'));
    session.configure({ mode: 'manual', width: 1920, height: 1080, fps: 30 });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.stats()).toMatchObject({ width: 640, mode: 'manual', state: 'error' });
    expect(session.stats().warning).toContain('1080p不可');
  });

  it('連続変更は直列化し、古い変更の終了後にも最後の設定を適用する', async () => {
    const { session, track } = setup();
    let finish!: () => void;
    track.applyConstraints.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    session.configure({ mode: 'manual', width: 1920, height: 1080, fps: 30 });
    await vi.advanceTimersByTimeAsync(0);
    session.configure({ mode: 'manual', width: 1280, height: 720, fps: 60 });
    expect(track.applyConstraints).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(track.applyConstraints).toHaveBeenCalledTimes(2);
    expect(session.stats()).toMatchObject({ width: 1280, height: 720, requestedFps: 60, state: 'ready' });
  });

  it('適用待ちで停止したら、新しい候補・通知・計測は開始しない', async () => {
    const { session, track, changed } = setup();
    let finish!: () => void;
    track.applyConstraints.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    session.configure({ mode: 'manual', width: 1920, height: 1080, fps: 30 });
    await vi.advanceTimersByTimeAsync(0);
    session.stop();
    const calls = changed.mock.calls.length;
    finish();
    await vi.advanceTimersByTimeAsync(5000);
    expect(changed).toHaveBeenCalledTimes(calls);
    expect(track.applyConstraints).toHaveBeenCalledTimes(1);
  });
});
