import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type Project } from '@app/schema';
import {
  FakeTrackingLayer,
  FakeTrackingSource,
  type FrameContext,
  type LayerProducer,
  type Services,
  type TargetDeltas,
} from '@app/contracts';
import { createParameterMixer } from '@app/core';
import { createTrackingLayerProducer } from '@app/tracking';
import { createFakeServices } from '../../services';
import { createStudioRuntime, type FrameScheduler, type StudioFrame } from './runtime';
import { setBackgroundCommand, setModelTransformCommand } from './scene';

// 手で進めるスケジューラー
function manualScheduler() {
  let pending: ((now: number) => void)[] = [];
  const scheduler: FrameScheduler & { step(now: number): void; size(): number } = {
    request(cb) {
      pending.push(cb);
      return () => {
        pending = pending.filter((x) => x !== cb);
      };
    },
    step(now) {
      const run = pending;
      pending = [];
      for (const cb of run) cb(now);
    },
    size: () => pending.length,
  };
  return scheduler;
}

function projectWithAsset(): Project {
  const p = createEmptyProject('テスト');
  return {
    ...p,
    assets: [
      {
        id: 'a1',
        path: 'assets/a1.png',
        hash: 'x',
        width: 100,
        height: 100,
        offset: { x: 0, y: 0 },
        canvasSize: { width: 1000, height: 2000 },
        source: { kind: 'png', file: 'a1.png' },
        sourceBlendMode: 'normal',
        sourceOpacity: 1,
      },
    ],
  };
}

function setup(project: Project = createEmptyProject('テスト')) {
  const scheduler = manualScheduler();
  const runtime = createStudioRuntime({ scheduler, decodeImage: async () => ({ width: 1 }) as ImageBitmap });
  const services: Services = { ...createFakeServices() };
  services.store.load(project);
  return { scheduler, runtime, services };
}

describe('1フレームの処理', () => {
  it('顔を見失って3秒後もまばたきが残り、表情の閉じ目が優先される（I-030）', async () => {
    const { runtime, services } = setup();
    services.mixer = createParameterMixer();
    services.autoBlink = { tick: () => ({ EyeOpenL: 0.25, EyeOpenR: 0.75 }) };
    // 自動まばたきは実行部の自動の層が services.autoBlink から出す（STEP3 のカード66）
    services.trackingLayer = createTrackingLayerProducer(services.store.get().model.parameters);
    const detach = runtime.attach(services);
    expect(runtime.tick(0)!.params).toMatchObject({ FaceAngleX: 0, EyeOpenL: 0.25, EyeOpenR: 0.75 });
    vi.spyOn(services.tracking, 'start').mockResolvedValue();
    await runtime.startTracking();
    services.trackingLayer.update({
      time: 0,
      detected: true,
      faceYaw: 20,
      facePitch: 0,
      faceRoll: 0,
      eyeOpenL: 1,
      eyeOpenR: 1,
      eyeBallX: 0,
      eyeBallY: 0,
      mouthOpen: 0,
    });
    expect(runtime.tick(300)!.params.FaceAngleX).toBeCloseTo(20);
    expect(runtime.tick(3000)!.params).toMatchObject({ FaceAngleX: 0, EyeOpenL: 0.25, EyeOpenR: 0.75 });
    const off = runtime.registerLayerProducer({
      id: 'expression',
      produce: () => ({ id: 'expression', weight: 1, values: { EyeOpenL: 0 } }),
    });
    expect(runtime.tick(3100)!.params.EyeOpenL).toBe(0);
    off();
    runtime.stopTracking();
    expect(runtime.tick(3200)!.params).toMatchObject({ FaceAngleX: 0, EyeOpenL: 0.25, EyeOpenR: 0.75 });
    detach();
  });
  it('producer を LAYER_ORDER の順に呼び、呼ぶたびに mixedSoFar を更新する', () => {
    const { runtime, services } = setup();
    const calls: { id: string; mixedSoFar: Record<string, number>; flags: FrameContext['flags'] }[] = [];
    const producer = (id: LayerProducer['id'], values: Record<string, number>, weight = 1): LayerProducer => ({
      id,
      produce(ctx) {
        calls.push({ id, mixedSoFar: { ...ctx.mixedSoFar }, flags: { ...ctx.flags } });
        return { id, weight, values };
      },
    });
    // わざと逆の順で登録する
    runtime.registerLayerProducer(producer('physics', { MouthOpen: 0.25 }));
    runtime.registerLayerProducer({
      id: 'lipSync',
      produce(ctx) {
        calls.push({ id: 'lipSync', mixedSoFar: { ...ctx.mixedSoFar }, flags: { ...ctx.flags } });
        ctx.flags.physicsActive = false; // 後のレイヤーへ伝える
        return null; // null は合成に入れない
      },
    });
    runtime.registerLayerProducer(producer('expression', { MouthOpen: 1 }));
    runtime.registerLayerProducer(producer('bodyFollow', { FaceAngleX: 10 }));
    runtime.registerLayerProducer(producer('expression', { EyeOpenL: 0 })); // 同じ id は登録した順

    runtime.attach(services);
    const frame = runtime.tick(1000)!;

    expect(calls.map((c) => c.id)).toEqual(['bodyFollow', 'expression', 'expression', 'lipSync', 'physics']);
    expect(calls[0]!.mixedSoFar.FaceAngleX).toBe(0); // 最初はデフォルト値
    expect(calls[1]!.mixedSoFar.FaceAngleX).toBe(10);
    expect(calls[2]!.mixedSoFar.MouthOpen).toBe(1);
    expect(calls[3]!.mixedSoFar).toMatchObject({ FaceAngleX: 10, MouthOpen: 1, EyeOpenL: 0 });
    expect(calls[0]!.flags).toEqual({ lipSyncWeight: 1, physicsActive: true });
    expect(calls[4]!.flags.physicsActive).toBe(false);
    expect(frame.params).toMatchObject({ FaceAngleX: 10, MouthOpen: 0.25, EyeOpenL: 0 });
    expect(frame.now).toBe(1000);
  });

  it('配列を返す producer のレイヤーは、配列の順に合成する（カード45）', () => {
    const { runtime, services } = setup();
    services.mixer = createParameterMixer();
    const seen: Record<string, number>[] = [];
    runtime.registerLayerProducer({
      id: 'animation',
      // 上書きのあとに足す。逆の順なら 10 になる
      produce: () => [
        { id: 'animation', weight: 1, values: { FaceAngleX: 10 } },
        { id: 'animation', weight: 1, values: { FaceAngleX: 5 }, blend: { FaceAngleX: 'add' } },
      ],
    });
    runtime.registerLayerProducer({ id: 'lipSync', produce: () => [] }); // 空の配列は何も足さない
    runtime.registerLayerProducer({
      id: 'periodic',
      produce(ctx) {
        seen.push({ ...ctx.mixedSoFar });
        return [{ id: 'periodic', weight: 1, values: { MouthOpen: 0.5 } }];
      },
    });

    runtime.attach(services);
    const frame = runtime.tick(1000)!;

    expect(seen[0]!.FaceAngleX).toBe(15); // 後の producer は配列の全部を合成した値を受け取る
    expect(frame.params).toMatchObject({ FaceAngleX: 15, MouthOpen: 0.5 });
  });

  it('now と dt（ミリ秒）と project を渡す', () => {
    const { runtime, services } = setup();
    const contexts: FrameContext[] = [];
    runtime.registerLayerProducer({ id: 'animation', produce: (ctx) => (contexts.push(ctx), null) });
    runtime.attach(services);
    runtime.tick(1000);
    runtime.tick(1016);
    expect(contexts.map((c) => [c.now, c.dt])).toEqual([
      [1000, 0],
      [1016, 16],
    ]);
    expect(contexts[0]!.project).toBe(services.store.get());
  });

  it('mixer.mix → evaluator → pipeline の結果を sink とプレビューへ渡す', () => {
    const { runtime, services } = setup(projectWithAsset());
    const deltas: TargetDeltas = { transforms: {}, vertices: {}, warpPoints: {} };
    const evaluate = vi.spyOn(services.evaluator, 'evaluate').mockReturnValue(deltas);
    const deform = vi.spyOn(services.pipeline, 'deform');
    runtime.registerLayerProducer({
      id: 'expression',
      produce: () => ({ id: 'expression', weight: 1, values: { MouthOpen: 0.5 } }),
    });
    const frames: StudioFrame[] = [];
    const previews: StudioFrame[] = [];
    const off = runtime.registerFrameSink((f) => frames.push(f));
    runtime.setPreview((f) => previews.push(f));
    runtime.attach(services);

    runtime.tick(5);
    const project = services.store.get();
    expect(evaluate).toHaveBeenCalledWith(project.model, frames[0]!.params);
    expect(frames[0]!.params.MouthOpen).toBe(0.5);
    expect(deform).toHaveBeenCalledWith(project.model, deltas);
    expect(frames[0]!.model).toBe(deform.mock.results[0]!.value);
    expect(previews[0]).toBe(frames[0]);
    expect(runtime.lastFrame()).toBe(frames[0]);

    off();
    runtime.tick(6);
    expect(frames).toHaveLength(1);
    expect(previews).toHaveLength(2);
  });

  it('producer・sink が例外を出しても、ほかは動き続ける', () => {
    const { runtime, services } = setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    runtime.registerLayerProducer({
      id: 'expression',
      produce: () => {
        throw new Error('壊れた');
      },
    });
    runtime.registerLayerProducer({
      id: 'animation',
      produce: () => ({ id: 'animation', weight: 1, values: { EyeOpenL: 0 } }),
    });
    runtime.registerFrameSink(() => {
      throw new Error('壊れた sink');
    });
    const frames: StudioFrame[] = [];
    runtime.registerFrameSink((f) => frames.push(f));
    runtime.attach(services);
    runtime.tick(1);
    runtime.tick(2);
    expect(frames.map((f) => f.params.EyeOpenL)).toEqual([0, 0]);
    expect(error).toHaveBeenCalledTimes(2); // 同じものは1回だけ知らせる
    error.mockRestore();
  });

  it('外した producer は呼ばない', () => {
    const { runtime, services } = setup();
    const produce = vi.fn(() => null);
    const off = runtime.registerLayerProducer({ id: 'periodic', produce });
    runtime.attach(services);
    runtime.tick(1);
    off();
    runtime.tick(2);
    expect(produce).toHaveBeenCalledTimes(1);
  });
});

describe('毎フレームの繰り返し', () => {
  it('attach の間だけ回る。running が変わる', () => {
    const { runtime, services, scheduler } = setup();
    const frames: number[] = [];
    runtime.registerFrameSink((f) => frames.push(f.now));
    expect(runtime.getState().running).toBe(false);
    const detach = runtime.attach(services);
    const detach2 = runtime.attach(services);
    expect(runtime.getState().running).toBe(true);
    scheduler.step(16);
    scheduler.step(32);
    expect(frames).toEqual([16, 32]);
    detach();
    scheduler.step(48);
    expect(frames).toEqual([16, 32, 48]); // まだ1つつながっている
    detach2();
    detach2(); // 2回呼んでも数えない
    expect(runtime.getState().running).toBe(false);
    expect(scheduler.size()).toBe(0);
    scheduler.step(64);
    expect(frames).toEqual([16, 32, 48]);
  });
});

describe('トラッキング', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('仮実装のトラッキングで値が変わり、外れている状態になり、停止できる', async () => {
    const { runtime, services } = setup();
    services.tracking = new FakeTrackingSource(() => Date.now());
    services.trackingLayer = new FakeTrackingLayer();
    const start = vi.spyOn(services.tracking, 'start');
    runtime.attach(services);
    expect(runtime.tick(0)!.params.FaceAngleX).toBe(0);
    expect(runtime.getState().status).toBe('stopped');

    await runtime.startTracking('fake-camera');
    expect(start).toHaveBeenCalledWith('fake-camera');
    vi.advanceTimersByTime(1000); // 4秒周期で左右に振る（1秒後は右いっぱい）
    const frame = runtime.tick(Date.now())!;
    expect(frame.params.FaceAngleX).toBeGreaterThan(15);
    expect(runtime.getState().status).toBe('tracking');

    vi.advanceTimersByTime(17_500); // 18秒を過ぎると2秒間外れる
    runtime.tick(Date.now());
    expect(runtime.getState().status).toBe('lost');

    runtime.stopTracking();
    expect(runtime.getState().status).toBe('stopped');
    expect(runtime.tick(Date.now())!.params.FaceAngleX).toBe(0); // 止めたらトラッキングのレイヤーは出さない
  });

  it('カメラを開始できなければ止まった状態に戻して例外を返す', async () => {
    const { runtime, services } = setup();
    vi.spyOn(services.tracking, 'start').mockRejectedValue(new Error('カメラが使えない'));
    runtime.attach(services);
    await expect(runtime.startTracking(null)).rejects.toThrow('カメラが使えない');
    expect(runtime.getState().status).toBe('stopped');
  });
});

describe('シーン', () => {
  it('シーンの配置と背景を使い、途中の配置（override）があればそちらを使う', async () => {
    const { runtime, services } = setup(projectWithAsset());
    runtime.attach(services);
    runtime.setOutputSize({ width: 1000, height: 1000 });
    // 1000×2000 を 1000×1000 に余白 5% で収める → 0.45 倍
    let frame = runtime.tick(1)!;
    expect(frame.view.scale).toBeCloseTo(0.45);
    expect(frame.view.offset.x).toBeCloseTo(500 - 500 * 0.45);
    expect(frame.background).toEqual({ type: 'transparent' });

    services.store.dispatch(setModelTransformCommand({ position: { x: 100, y: -50 }, scale: 2 }));
    services.store.dispatch(setBackgroundCommand({ type: 'color', color: '#00ff00' }));
    frame = runtime.tick(2)!;
    expect(frame.view.scale).toBeCloseTo(0.9);
    expect(frame.view.offset.x).toBeCloseTo(500 + 100 - 500 * 0.9);
    expect(frame.view.offset.y).toBeCloseTo(500 - 50 - 1000 * 0.9);
    expect(frame.background).toEqual({ type: 'color', color: '#00ff00' });

    runtime.setModelTransformOverride({ position: { x: 0, y: 0 }, scale: 1 });
    expect(runtime.tick(3)!.view.scale).toBeCloseTo(0.45);
    expect(runtime.modelTransform()).toEqual({ position: { x: 0, y: 0 }, scale: 1 });
    runtime.setModelTransformOverride(null);
    expect(runtime.modelTransform()).toEqual({ position: { x: 100, y: -50 }, scale: 2 });

    // 画像の背景は、読めるまで透明
    runtime.backgrounds.put('backgrounds/a.png', new Uint8Array([1]));
    services.store.dispatch(setBackgroundCommand({ type: 'image', path: 'backgrounds/a.png' }));
    expect(runtime.tick(4)!.background).toEqual({ type: 'transparent' });
    await Promise.resolve();
    expect(runtime.tick(5)!.background).toEqual({ type: 'image', image: { width: 1 } });
  });

  it('出力の大きさが変わったら知らせる', () => {
    const { runtime } = setup();
    const sizes: { width: number; height: number }[] = [];
    runtime.subscribeOutputSize((s) => sizes.push(s));
    runtime.setOutputSize({ width: 1280, height: 720 });
    runtime.setOutputSize({ width: 1280, height: 720 });
    expect(sizes).toEqual([{ width: 1280, height: 720 }]);
    expect(runtime.getOutputSize()).toEqual({ width: 1280, height: 720 });
  });
});
