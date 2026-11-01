import { describe, expect, it, vi } from 'vitest';
import type { FromBodyWorker, InitMessage } from './protocol';
import { createBodyWorkerCore, type GestureTaskLike, type PoseTaskLike, type TaskFactory } from './workerCore';

const urls = { wasmLoader: 'l', wasmBinary: 'b', pose: 'p', gesture: 'g' };
const init = (patch: Partial<InitMessage> = {}): InitMessage => ({
  type: 'init',
  pageTimeOrigin: 1000,
  hands: true,
  handIntervalMs: 0,
  urls,
  ...patch,
});

function poseTask(): PoseTaskLike & { times: number[]; closed: boolean } {
  return {
    times: [],
    closed: false,
    detectForVideo(_image, timestamp) {
      this.times.push(timestamp);
      return {
        landmarks: [[{ x: 0.1, y: 0.2, z: 0, visibility: 0.9 }]],
        worldLandmarks: [[{ x: 1, y: 2, z: 3, visibility: 0.5 }]],
      };
    },
    close() {
      this.closed = true;
    },
  };
}
function gestureTask(): GestureTaskLike & { calls: number; closed: boolean } {
  return {
    calls: 0,
    closed: false,
    recognizeForVideo() {
      this.calls++;
      return {
        landmarks: [[{ x: 0.3, y: 0.4, z: 0, visibility: 0 }]],
        worldLandmarks: [[{ x: 0, y: 0, z: 0 }]],
        handedness: [[{ categoryName: 'Right', score: 0.9 }]],
        gestures: [[{ categoryName: 'Victory', score: 0.8 }]],
      };
    },
    close() {
      this.closed = true;
    },
  };
}
const frame = (frameId: number, capturedAt: number) => {
  const image = { displayWidth: 640, displayHeight: 480, close: vi.fn() } as unknown as VideoFrame;
  return {
    message: {
      type: 'frame' as const,
      generation: 1,
      frameId,
      capturedAt,
      captureSource: 'captureTime' as const,
      image,
    },
    image,
  };
};

function setup(factory: Partial<TaskFactory> = {}) {
  const posted: FromBodyWorker[] = [];
  const pose = poseTask();
  const gesture = gestureTask();
  const core = createBodyWorkerCore({
    post: (m) => posted.push(m),
    now: () => 50,
    timeOrigin: 1010, // Worker の起点はページより 10ms 後
    tasks: () => ({ pose: async () => pose, gesture: async () => gesture, ...factory }),
  });
  return { core, posted, pose, gesture };
}

describe('createBodyWorkerCore', () => {
  it('Pose を先に、手を後に送り、最後に done。画像を閉じる。時刻はページの時計へ直す', async () => {
    const { core, posted } = setup();
    await core.handle(init());
    expect(posted[0]).toEqual({
      type: 'ready',
      pose: { delegate: 'GPU', errors: [] },
      hands: { delegate: 'GPU', errors: [] },
    });
    const { message, image } = frame(1, 500);
    core.handle(message);
    expect(posted.slice(1).map((m) => m.type)).toEqual(['pose', 'hands', 'done']);
    const pose = posted[1] as Extract<FromBodyWorker, { type: 'pose' }>;
    expect(pose.completedAt).toBe(60); // Worker の 50 + 起点の差 10
    expect(pose.value).toEqual({
      landmarks: [{ x: 0.1, y: 0.2, z: 0, visibility: 0.9 }],
      worldLandmarks: [{ x: 1, y: 2, z: 3 }],
    });
    const hands = posted[2] as Extract<FromBodyWorker, { type: 'hands' }>;
    // 手の点の visibility は入れない。左右は演者自身の側の小文字
    expect(hands.value).toEqual([
      {
        landmarks: [{ x: 0.3, y: 0.4, z: 0 }],
        worldLandmarks: [{ x: 0, y: 0, z: 0 }],
        handedness: { side: 'right', score: 0.9 },
        gesture: { name: 'Victory', score: 0.8 },
      },
    ]);
    expect([pose.width, pose.height]).toEqual([640, 480]);
    expect(image.close).toHaveBeenCalledTimes(1);
  });

  it('GPU で作れない推定器は CPU で作り直し、理由を残す', async () => {
    const { core, posted } = setup({
      pose: async (delegate) => {
        if (delegate === 'GPU') throw new Error('kGpuService');
        return poseTask();
      },
    });
    await core.handle(init());
    expect(posted[0]).toMatchObject({ pose: { delegate: 'CPU', errors: ['GPU: kGpuService'] } });
  });

  it('手を推定しない設定では手の推定器を作らず、手の結果を送らない', async () => {
    const gesture = vi.fn();
    const { core, posted } = setup({ gesture });
    await core.handle(init({ hands: false }));
    expect(gesture).not.toHaveBeenCalled();
    expect(posted[0]).toMatchObject({ hands: null });
    core.handle(frame(1, 500).message);
    expect(posted.slice(1).map((m) => m.type)).toEqual(['pose', 'done']);
  });

  it('軽量（手 15fps）は撮影時刻で間引く。間隔の揺れを 3/4 まで許す', async () => {
    const { core, posted, gesture } = setup();
    await core.handle(init({ handIntervalMs: 1000 / 15 }));
    // 30fps で 28ms・38ms と揺れる撮影
    let t = 0;
    for (const [i, gap] of [28, 38, 28, 38, 28, 38].entries()) {
      t += gap;
      core.handle(frame(i + 1, t).message);
    }
    expect(gesture.calls).toBe(3);
    expect(posted.filter((m) => m.type === 'pose').length).toBe(6);
  });

  it('推定の例外は、その部位を「失敗（値なし）」で送り、次のフレームへ進む', async () => {
    const { core, posted } = setup({
      pose: async () => ({
        detectForVideo: () => {
          throw new Error('壊れた');
        },
        close: () => {},
      }),
    });
    await core.handle(init({ hands: false }));
    const { message, image } = frame(1, 500);
    core.handle(message);
    expect(posted[1]).toMatchObject({ type: 'pose', value: null, error: '壊れた' });
    expect(posted[2]).toMatchObject({ type: 'done' });
    expect(image.close).toHaveBeenCalled();
  });

  it('準備の前・止めた後の画像は推定せず閉じて done。止めると推定器を閉じる', async () => {
    const { core, posted, pose, gesture } = setup();
    const early = frame(1, 100);
    core.handle(early.message);
    expect(early.image.close).toHaveBeenCalled();
    expect(posted).toEqual([{ type: 'done', generation: 1, frameId: 1 }]);
    await core.handle(init());
    core.handle({ type: 'stop' });
    expect(pose.closed && gesture.closed).toBe(true);
    const late = frame(2, 200);
    core.handle(late.message);
    expect(late.image.close).toHaveBeenCalled();
    expect(posted.at(-1)).toEqual({ type: 'done', generation: 1, frameId: 2 });
  });

  it('推定器に渡す時刻は増え続ける（同じ撮影時刻でも）', async () => {
    const { core, pose } = setup();
    await core.handle(init({ hands: false }));
    core.handle(frame(1, 500).message);
    core.handle(frame(2, 500).message);
    expect(pose.times[1]!).toBeGreaterThan(pose.times[0]!);
  });
});
