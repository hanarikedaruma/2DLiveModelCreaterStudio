// 腕・手を使う間の解像度の自動選択（AT-04）。手が小さくなりすぎるので、幅640未満の候補を試さない
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraVideo } from '../camera';
import { CaptureSession } from '../capture';

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

function setup(preferLarge: boolean) {
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
  const session = new CaptureSession(
    track,
    video,
    AUTO,
    () => {},
    () => Date.now(),
    () => preferLarge,
  );
  sessions.push(session);
  session.start();
  const window = async (cameraFps: number, trackingFps: number) => {
    frames += cameraFps;
    for (let i = 0; i < trackingFps; i++) session.estimated();
    await vi.advanceTimersByTimeAsync(1000);
  };
  return { session, track, window };
}

describe('腕・手を使う間の解像度の自動選択', () => {
  it('640×480 が遅くても 320×240 は試さず、1280×720 と比べて良い方にする', async () => {
    const { session, track, window } = setup(true);
    await window(15, 12);
    await window(15, 12);
    expect(session.stats().width).toBe(1280);
    await window(30, 20);
    await window(30, 20);
    expect(session.stats()).toMatchObject({ width: 1280, height: 720, state: 'ready' });
    expect(track.applyConstraints).toHaveBeenCalledTimes(1);
    expect(track.applyConstraints.mock.calls.every(([c]) => (c.width as ConstrainULongRange).ideal !== 320)).toBe(true);
  });

  it('腕・手を使わないときは従来どおり 320×240 も試す', async () => {
    const { session, window } = setup(false);
    await window(15, 12);
    await window(15, 12);
    expect(session.stats().width).toBe(320);
  });
});
