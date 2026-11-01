// COの独立確認。ブラウザ・カメラは起動せず、公開start/stopの非同期境界だけを制御する。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ faceFactory: vi.fn() }));
vi.mock('@app/tracking/src/source/landmarker', () => ({
  createMediaPipeFaceLandmarker: mocks.faceFactory,
  defaultMediaPipeAssetUrls: () => ({}),
}));
vi.mock('./load', () => ({ createRenderLoad: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const stopTrack = vi.fn();
const media = vi.fn();
const play = vi.fn();
const stream = {
  getTracks: () => [{ stop: stopTrack }],
  getVideoTracks: () => [
    { label: 'CO fixture', stop: stopTrack, getSettings: () => ({ width: 640, height: 480, frameRate: 30 }) },
  ],
};
let app: typeof import('./main') | null = null;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  media.mockResolvedValue(stream);
  play.mockResolvedValue(undefined);
  mocks.faceFactory.mockResolvedValue({ detectForVideo: () => ({ facialTransformationMatrixes: [] }) });
  const control = { addEventListener: vi.fn(), replaceChildren: vi.fn(), value: '', textContent: '' };
  vi.stubGlobal('document', {
    baseURI: 'http://localhost/at01-test/',
    addEventListener: vi.fn(),
    body: { appendChild: vi.fn() },
    getElementById: () => control,
    createElement: () => ({
      style: {},
      play,
      pause: vi.fn(),
      remove: vi.fn(),
      requestVideoFrameCallback: () => 1,
      cancelVideoFrameCallback: vi.fn(),
    }),
  });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: media, enumerateDevices: async () => [] } });
  vi.stubGlobal('window', {});
  vi.stubGlobal('Option', class {});
  vi.stubGlobal('requestAnimationFrame', vi.fn());
});
afterEach(() => {
  app?.stop();
  app = null;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const config = { face: false, pose: false, hands: false };
describe('AT-01 CO独立確認: 開始・停止と取得済みストリームの解放', () => {
  it('正常に開始して停止するとカメラを解放する（試験環境の対照）', async () => {
    app = await import('./main');
    await app.start(config);
    expect(app.status().running).toBe(true);
    app.stop();
    expect(app.status().running).toBe(false);
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });
  it('カメラ取得を待っている間の停止で、後から開始しない', async () => {
    app = await import('./main');
    const pending = deferred<typeof stream>();
    media.mockReturnValueOnce(pending.promise);
    const started = app.start(config).catch(() => undefined);
    app.stop();
    pending.resolve(stream);
    await started;
    expect(app.status().running).toBe(false);
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });
  it('映像のplayを待っている間の停止でも、後から開始しない', async () => {
    app = await import('./main');
    const pending = deferred<void>();
    play.mockReturnValueOnce(pending.promise);
    const started = app.start(config).catch(() => undefined);
    await vi.waitFor(() => expect(play).toHaveBeenCalled());
    app.stop();
    pending.resolve(undefined);
    await started;
    expect(app.status().running).toBe(false);
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });
  it('顔推定器の初期化が失敗しても、取得できたカメラを解放する', async () => {
    app = await import('./main');
    mocks.faceFactory.mockRejectedValueOnce(new Error('CO simulated face initialization failure'));
    await expect(app.start({ ...config, face: true })).rejects.toThrow('CO simulated');
    expect(app.status().running).toBe(false);
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });
});
