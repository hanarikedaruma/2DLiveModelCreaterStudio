import { describe, expect, it, vi } from 'vitest';
import { cameraConstraints, createDomCameraVideo, stopStream } from './camera';

// 文書と <video> の仮のもの（使うところだけ）
function fakeDocument(withFrameCallback = true) {
  const callbacks = new Map<number, (now: number, metadata: { presentedFrames: number }) => void>();
  let next = 1;
  const appended: unknown[] = [];
  const video = {
    muted: false,
    playsInline: false,
    autoplay: true,
    isConnected: false,
    srcObject: null as unknown,
    style: { cssText: '' },
    attributes: {} as Record<string, string>,
    paused: true,
    getVideoPlaybackQuality: () => ({ totalVideoFrames: 123 }),
    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    },
    play: vi.fn(async function (this: { paused: boolean }) {
      this.paused = false;
    }),
    pause() {
      this.paused = true;
    },
    remove() {
      this.isConnected = false;
    },
    requestVideoFrameCallback: withFrameCallback
      ? (cb: (now: number, metadata: { presentedFrames: number }) => void) => {
          callbacks.set(next, cb);
          return next++;
        }
      : undefined,
    cancelVideoFrameCallback(handle: number) {
      callbacks.delete(handle);
    },
  };
  const doc = {
    createElement: () => video,
    body: {
      appendChild(el: typeof video) {
        appended.push(el);
        el.isConnected = true;
      },
    },
  };
  return { doc: doc as unknown as Document, video, callbacks, appended };
}

const stream = { getTracks: () => [], getVideoTracks: () => [] };

describe('createDomCameraVideo', () => {
  it('音を出さず、見えない形で文書に入れてから流す', async () => {
    const { doc, video, appended } = fakeDocument();
    const camera = createDomCameraVideo(doc);
    expect(camera.image).toBe(video);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.style.cssText).toContain('opacity:0');
    await camera.play(stream);
    expect(appended).toEqual([video]);
    expect(video.srcObject).toBe(stream);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(camera.frameCount()).toBe(123);
  });

  it('onNextFrame は requestVideoFrameCallback で予約し、戻り値で取り消す', async () => {
    const { doc, callbacks } = fakeDocument();
    const camera = createDomCameraVideo(doc);
    const seen: [number, number][] = [];
    const cancel = camera.onNextFrame((now, info) => seen.push([now, info.presentedFrames]));
    expect(callbacks.size).toBe(1);
    callbacks.get(1)!(16, { presentedFrames: 3 });
    expect(seen).toEqual([[16, 3]]);
    camera.onNextFrame(() => {});
    cancel();
    expect([callbacks.has(1), callbacks.has(2)]).toEqual([false, true]);
  });

  it('release で止めて、映像を外し、文書から取り除く', async () => {
    const { doc, video } = fakeDocument();
    const camera = createDomCameraVideo(doc);
    await camera.play(stream);
    camera.release();
    expect(video.paused).toBe(true);
    expect(video.srcObject).toBeNull();
    expect(video.isConnected).toBe(false);
  });

  it('requestVideoFrameCallback が無い環境では play が失敗する', async () => {
    const { doc } = fakeDocument(false);
    await expect(createDomCameraVideo(doc).play(stream)).rejects.toThrow('requestVideoFrameCallback');
  });
});

describe('cameraConstraints・stopStream', () => {
  it('機器の指定は exact にする', () => {
    expect(cameraConstraints('x').video).toMatchObject({ deviceId: { exact: 'x' } });
    expect(cameraConstraints('').video).not.toHaveProperty('deviceId');
  });
  it('自動は小さい映像と60fpsを優先し、手動は指定した解像度を要求する', () => {
    expect(cameraConstraints().video).toMatchObject({
      width: { ideal: 640, max: 640 },
      height: { ideal: 480, max: 480 },
      frameRate: { ideal: 60 },
    });
    expect(cameraConstraints('x', { mode: 'manual', width: 1920, height: 1080, fps: 30 }).video).toMatchObject({
      width: { exact: 1920 },
      height: { exact: 1080 },
      frameRate: { ideal: 30 },
    });
  });

  it('stopStream はすべてのトラックを止める', () => {
    const stops = [vi.fn(), vi.fn()];
    stopStream({ getTracks: () => stops.map((stop) => ({ stop })) });
    expect(stops.map((s) => s.mock.calls.length)).toEqual([1, 1]);
  });
});
