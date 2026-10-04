import type { TrackingFrame } from '@app/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CameraVideo, MediaDevicesLike, MediaStreamLike, VideoFrameInfo } from './camera';
import type { LandmarkerResultLike } from './convert';
import type { FaceLandmarkerLike } from './landmarker';
import { createMediaPipeTrackingSource } from './source';

// ---- 仮のカメラ・映像・推定 ----

class FakeStream implements MediaStreamLike {
  stopped = 0;
  constructor(readonly deviceId: string | undefined) {}
  getTracks(): { stop(): void }[] {
    return [{ stop: () => void this.stopped++ }];
  }
}

class FakeMediaDevices implements MediaDevicesLike {
  readonly requests: MediaStreamConstraints[] = [];
  readonly streams: FakeStream[] = [];
  fail: Error | null = null;
  pending: { resolve: () => void } | null = null; // 置くと getUserMedia を待たせる
  devices = [
    { deviceId: 'mic', kind: 'audioinput', label: 'マイク' },
    { deviceId: 'cam-a', kind: 'videoinput', label: '内蔵カメラ' },
    { deviceId: 'cam-b', kind: 'videoinput', label: '' },
  ];

  async enumerateDevices(): Promise<{ deviceId: string; kind: string; label: string }[]> {
    return this.devices;
  }

  async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamLike> {
    this.requests.push(constraints);
    if (this.fail) throw this.fail;
    const video = constraints.video as MediaTrackConstraints;
    const stream = new FakeStream((video.deviceId as ConstrainDOMStringParameters | undefined)?.exact as string);
    this.streams.push(stream);
    if (this.pendingNext) {
      await new Promise<void>((resolve) => (this.pending = { resolve }));
    }
    return stream;
  }
  pendingNext = false;
}

class FakeVideo implements CameraVideo {
  readonly image = {} as HTMLVideoElement;
  stream: MediaStreamLike | null = null;
  released = false;
  callbacks = new Map<number, (now: number, info: VideoFrameInfo) => void>();
  private nextHandle = 1;

  async play(stream: MediaStreamLike): Promise<void> {
    this.stream = stream;
  }

  onNextFrame(callback: (now: number, info: VideoFrameInfo) => void): () => void {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return () => this.callbacks.delete(handle);
  }

  release(): void {
    this.released = true;
  }

  // 予約されている callback をすべて呼ぶ（ブラウザーが新しいフレームを出したとき）
  present(now: number, presentedFrames: number): void {
    const pending = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const cb of pending) cb(now, { presentedFrames });
  }
}

const FACE: LandmarkerResultLike = {
  faceBlendshapes: [{ categories: [{ categoryName: 'jawOpen', score: 0.4 }] }],
  facialTransformationMatrixes: [{ data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -50, 1] }],
};
const NO_FACE: LandmarkerResultLike = { faceBlendshapes: [], facialTransformationMatrixes: [] };

class FakeLandmarker implements FaceLandmarkerLike {
  readonly timestamps: number[] = [];
  result: LandmarkerResultLike = FACE;
  onDetect: (() => void) | null = null;
  throwNext = false;

  detectForVideo(_video: HTMLVideoElement, timestamp: number): LandmarkerResultLike {
    this.timestamps.push(timestamp);
    this.onDetect?.();
    if (this.throwNext) {
      this.throwNext = false;
      throw new Error('推定の失敗');
    }
    return this.result;
  }

  close(): void {}
}

function setup() {
  const devices = new FakeMediaDevices();
  const videos: FakeVideo[] = [];
  const landmarker = new FakeLandmarker();
  const createLandmarker = vi.fn(async () => landmarker);
  const source = createMediaPipeTrackingSource({
    mediaDevices: devices,
    createVideo: () => {
      const v = new FakeVideo();
      videos.push(v);
      return v;
    },
    createLandmarker,
  });
  const frames: TrackingFrame[] = [];
  source.onFrame((f) => frames.push(f));
  const video = (): FakeVideo => videos[videos.length - 1]!;
  return { devices, videos, video, landmarker, createLandmarker, source, frames };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createMediaPipeTrackingSource', () => {
  it('listDevices は videoinput だけを返し、名前が空なら番号を付ける', async () => {
    const { source } = setup();
    expect(await source.listDevices()).toEqual([
      { id: 'cam-a', label: '内蔵カメラ' },
      { id: 'cam-b', label: 'カメラ 2' },
    ]);
  });

  it('start は指定した機器を 1280×720・30fps 優先で開く。音は取らない', async () => {
    const { source, devices } = setup();
    await source.start('cam-b');
    expect(devices.requests[0]).toEqual({
      audio: false,
      video: { deviceId: { exact: 'cam-b' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
  });

  it('機器を指定しなければ deviceId の条件を付けない', async () => {
    const { source, devices } = setup();
    await source.start();
    expect(devices.requests[0]!.video).toEqual({
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    });
  });

  it('フレームごとに推定して TrackingFrame を出す', async () => {
    const { source, video, landmarker, frames } = setup();
    await source.start('cam-a');
    expect(video().stream).not.toBeNull();
    video().present(1000, 1);
    video().present(1033, 2);
    expect(landmarker.timestamps).toEqual([1000, 1033]);
    expect(frames.map((f) => [f.time, f.detected, f.mouthOpen])).toEqual([
      [1000, true, 0.4],
      [1033, true, 0.4],
    ]);
  });

  it('顔が無いフレームは detected false で、ほかの値は前回のまま', async () => {
    const { source, video, landmarker, frames } = setup();
    await source.start();
    video().present(10, 1);
    landmarker.result = NO_FACE;
    video().present(43, 2);
    expect(frames[1]).toEqual({ ...frames[0], time: 43, detected: false });
  });

  it('推定済みのフレームと、推定の途中に来たフレームは捨てる', async () => {
    const { source, video, landmarker, frames } = setup();
    await source.start();
    video().present(10, 1);
    video().present(20, 1); // 同じフレーム
    // 推定の途中に次のフレームの知らせが来た
    landmarker.onDetect = () => {
      landmarker.onDetect = null;
      video().present(45, 3);
    };
    video().present(40, 2);
    expect(landmarker.timestamps).toEqual([10, 40]);
    expect(frames).toHaveLength(2);
    // 推定が終われば次のフレームは推定する
    video().present(80, 4);
    expect(landmarker.timestamps).toEqual([10, 40, 80]);
  });

  it('detectForVideo に渡す時刻は、時刻が進まなくても止め直しても前より大きい', async () => {
    const { source, video, landmarker } = setup();
    await source.start();
    video().present(100, 1);
    video().present(100, 2);
    source.stop();
    await source.start();
    video().present(50, 1); // 新しい映像は通し番号が 1 から
    const ts = landmarker.timestamps;
    expect(ts).toHaveLength(3);
    expect(ts[1]!).toBeGreaterThan(ts[0]!);
    expect(ts[2]!).toBeGreaterThan(ts[1]!);
  });

  it('推定が例外を投げたフレームは detected false にして、次のフレームも推定する', async () => {
    const { source, video, landmarker, frames } = setup();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await source.start();
    video().present(10, 1);
    landmarker.throwNext = true;
    video().present(43, 2);
    video().present(76, 3);
    expect(frames.map((f) => f.detected)).toEqual([true, false, true]);
  });

  it('stop でカメラを閉じ、映像を片付け、それ以降は推定しない', async () => {
    const { source, video, devices, landmarker, frames } = setup();
    await source.start();
    const v = video();
    const stale = [...v.callbacks.values()];
    source.stop();
    expect(devices.streams[0]!.stopped).toBe(1);
    expect(v.released).toBe(true);
    expect(v.callbacks.size).toBe(0);
    for (const cb of stale) cb(100, { presentedFrames: 1 }); // 取り消しの前に積まれていたもの
    expect(landmarker.timestamps).toEqual([]);
    expect(frames).toEqual([]);
    source.stop(); // 2回目は何もしない
  });

  it('別の機器で start し直すと前のカメラを閉じる。推定の準備は1回だけ', async () => {
    const { source, devices, videos, createLandmarker } = setup();
    await source.start('cam-a');
    await source.start('cam-b');
    expect(devices.streams.map((s) => [s.deviceId, s.stopped])).toEqual([
      ['cam-a', 1],
      ['cam-b', 0],
    ]);
    expect(videos[0]!.released).toBe(true);
    expect(createLandmarker).toHaveBeenCalledTimes(1);
  });

  it('カメラを開くのを待つ間に stop されたら、開けたカメラをすぐ閉じる', async () => {
    const { source, devices, videos } = setup();
    devices.pendingNext = true;
    const starting = source.start();
    await vi.waitFor(() => expect(devices.pending).not.toBeNull());
    source.stop();
    devices.pending!.resolve();
    await starting;
    expect(devices.streams[0]!.stopped).toBe(1);
    expect(videos).toHaveLength(0);
  });

  it('カメラを開けなければ start が失敗し、もう一度 start できる', async () => {
    const { source, devices, video } = setup();
    devices.fail = new Error('NotAllowedError');
    await expect(source.start()).rejects.toThrow('NotAllowedError');
    devices.fail = null;
    await source.start();
    expect(video().stream).not.toBeNull();
  });

  it('推定の準備に失敗したらカメラを閉じて start が失敗し、次の start で作り直す', async () => {
    const devices = new FakeMediaDevices();
    const landmarker = new FakeLandmarker();
    const createLandmarker = vi
      .fn<() => Promise<FaceLandmarkerLike>>()
      .mockRejectedValueOnce(new Error('モデルを読めない'))
      .mockResolvedValue(landmarker);
    const source = createMediaPipeTrackingSource({
      mediaDevices: devices,
      createVideo: () => new FakeVideo(),
      createLandmarker,
    });
    await expect(source.start()).rejects.toThrow('モデルを読めない');
    expect(devices.streams[0]!.stopped).toBe(1);
    await source.start();
    expect(createLandmarker).toHaveBeenCalledTimes(2);
    expect(devices.streams[1]!.stopped).toBe(0);
  });

  it('onFrame の戻り値で受け取りをやめる。受け取り側の失敗はほかの受け取り側に響かない', async () => {
    const { source, video } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const a: number[] = [];
    const b: number[] = [];
    source.onFrame(() => {
      throw new Error('受け取り側の失敗');
    });
    const offA = source.onFrame((f) => a.push(f.time));
    source.onFrame((f) => b.push(f.time));
    await source.start();
    video().present(10, 1);
    offA();
    video().present(43, 2);
    expect(a).toEqual([10]);
    expect(b).toEqual([10, 43]);
  });
});
