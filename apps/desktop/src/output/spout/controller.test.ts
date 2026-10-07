import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultEnvironment, createEmptyProject, type Asset, type Environment, type Project } from '@app/schema';
import {
  createAssetRepository,
  type Background,
  type DeformedModel,
  type OutputSink,
  type Services,
  type ViewTransform,
} from '@app/contracts';
import { createFakeServices } from '../../services';
import { createStudioRuntime, type FrameScheduler } from '../../modes/studio/runtime';
import { setBackgroundCommand } from '../../modes/studio/scene';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../shell/environment';
import { bindSpoutOutput, createSpoutOutputController, fitView, projectPngs } from './controller';
import type { SpoutTelemetry } from './sink';

const idle: FrameScheduler = { request: () => () => {} }; // 自動では回さない（tick で進める）

// 呼ばれたことを記録する OutputSink
class RecordingSink implements OutputSink {
  log: string[] = [];
  textures: Record<string, Uint8Array>[] = [];
  frames: { model: DeformedModel; view: ViewTransform; background: Background }[] = [];
  failStart: string | null = null;

  async start(o: { width: number; height: number; fps: number }) {
    this.log.push(`start ${o.width}x${o.height}@${o.fps}`);
    if (this.failStart) throw new Error(this.failStart);
  }
  async setTextures(pngs: Record<string, Uint8Array>) {
    this.log.push(`textures ${Object.keys(pngs).sort().join(',')}`);
    this.textures.push(pngs);
  }
  submit(model: DeformedModel, view: ViewTransform, background: Background) {
    this.frames.push({ model, view, background });
  }
  async stop() {
    this.log.push('stop');
  }
  started() {
    return { senderName: '2D Liver_1' };
  }
}

function asset(id: string): Asset {
  return {
    id,
    path: `assets/${id}.png`,
    hash: id,
    width: 10,
    height: 10,
    offset: { x: 0, y: 0 },
    canvasSize: { width: 100, height: 100 },
    source: { kind: 'png', file: `${id}.png` },
    sourceBlendMode: 'normal',
    sourceOpacity: 1,
  };
}

const output = (patch: Partial<Environment['output']> = {}): Environment['output'] => ({
  method: 'spout2',
  width: 1920,
  height: 1080,
  fps: 60,
  adapterId: null,
  ...patch,
});

async function setup() {
  const runtime = createStudioRuntime({ scheduler: idle, decodeImage: async () => ({}) as ImageBitmap });
  const sink = new RecordingSink();
  const services: Services = {
    ...createFakeServices(),
    assets: createAssetRepository({
      decode: async () => ({ image: {} as ImageBitmap, imageData: {} as ImageData }),
    }),
    spout: sink,
  };
  const project: Project = { ...createEmptyProject('Spout2'), assets: [asset('a1'), asset('a2')] };
  services.store.load(project);
  await services.assets.put('a1', new Uint8Array([1]));
  await services.assets.put('a2', new Uint8Array([2]));
  await services.assets.put('other', new Uint8Array([9])); // プロジェクトが使っていない素材は送らない
  const controller = createSpoutOutputController({ runtime, batchMs: 300 });
  return { runtime, services, sink, controller };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Spout2 の出力の制御', () => {
  it('方式がウィンドウなら何もしない', async () => {
    const { services, sink, controller } = await setup();
    controller.sync(services, output({ method: 'window' }));
    await controller.whenIdle();
    expect(sink.log).toEqual([]);
    expect(controller.status()).toEqual({ state: 'off' });
  });

  it('Spout2 なら解像度と fps で始め、使っている素材を送り、毎フレーム submit する', async () => {
    const { runtime, services, sink, controller } = await setup();
    runtime.setOutputSize({ width: 1920, height: 1080 });
    controller.sync(services, output());
    expect(controller.status()).toEqual({ state: 'starting' });
    await controller.whenIdle();
    expect(sink.log).toEqual(['start 1920x1080@60', 'textures a1,a2']);
    expect(controller.status()).toEqual({
      state: 'running',
      width: 1920,
      height: 1080,
      fps: 60,
      senderName: '2D Liver_1',
    });
    expect(runtime.getState().running).toBe(true); // スタジオの画面を離れても回す

    services.store.dispatch(setBackgroundCommand({ type: 'color', color: '#00ff00' }));
    const frame = runtime.tick(16)!;
    expect(sink.frames).toHaveLength(1);
    expect(sink.frames[0]!.model).toBe(frame.model);
    expect(sink.frames[0]!.view).toEqual(frame.view);
    expect(sink.frames[0]!.background).toEqual({ type: 'color', color: '#00ff00' });

    // 同じ設定なら作り直さない
    controller.sync(services, output());
    await controller.whenIdle();
    expect(sink.log).toHaveLength(2);
  });

  it('素材が変わったら、まとめて送り直す', async () => {
    const { services, sink, controller } = await setup();
    controller.sync(services, output());
    await controller.whenIdle();
    const a1 = new Uint8Array([5]);
    await services.assets.put('a1', a1);
    await services.assets.put('a2', new Uint8Array([6]));
    expect(sink.textures).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(sink.textures).toHaveLength(2);
    expect(sink.textures[1]!.a1).toBe(a1);
  });

  it('解像度・fps が変わったら作り直し、ウィンドウに戻したら止める', async () => {
    const { runtime, services, sink, controller } = await setup();
    controller.sync(services, output());
    await controller.whenIdle();
    controller.sync(services, output({ fps: 30 }));
    await controller.whenIdle();
    expect(sink.log.slice(2)).toEqual(['stop', 'start 1920x1080@30', 'textures a1,a2']);
    controller.sync(services, output({ method: 'window', fps: 30 }));
    await controller.whenIdle();
    expect(sink.log.at(-1)).toBe('stop');
    expect(controller.status()).toEqual({ state: 'off' });
    expect(runtime.getState().running).toBe(false);
    runtime.tick(16);
    const count = sink.frames.length;
    runtime.tick(32);
    expect(sink.frames).toHaveLength(count);
  });

  it('始められなければ状態にエラーを出し、同じ設定では繰り返さない（やり直しはできる）', async () => {
    const { services, sink, controller } = await setup();
    sink.failStart = 'D3D11 のデバイスを作れない';
    controller.sync(services, output());
    await controller.whenIdle();
    expect(controller.status()).toEqual({ state: 'error', message: 'D3D11 のデバイスを作れない' });
    expect(sink.log).toEqual(['start 1920x1080@60', 'stop']);

    controller.sync(services, output({ method: 'window' }));
    controller.sync(services, output()); // 同じ設定に戻っても、失敗したものは繰り返さない
    await controller.whenIdle();
    expect(sink.log).toHaveLength(2);
    expect(controller.status()).toEqual({ state: 'error', message: 'D3D11 のデバイスを作れない' });

    sink.failStart = null;
    controller.retry();
    await controller.whenIdle();
    expect(controller.status()).toMatchObject({ state: 'running' });
  });

  it('実行部の出力画面の大きさと違えば、縦横比を保って収める', () => {
    const view = { scale: 2, offset: { x: 100, y: 50 } };
    expect(fitView(view, { width: 1920, height: 1080 }, { width: 1920, height: 1080 })).toBe(view);
    // 半分の大きさ
    expect(fitView(view, { width: 1920, height: 1080 }, { width: 960, height: 540 })).toEqual({
      scale: 1,
      offset: { x: 50, y: 25 },
    });
    // 縦長の出力では上下に余白
    expect(fitView(view, { width: 200, height: 100 }, { width: 100, height: 100 })).toEqual({
      scale: 1,
      offset: { x: 50, y: 25 + 25 },
    });
  });

  it('使っている素材だけを集める', async () => {
    const { services } = await setup();
    expect(Object.keys(projectPngs(services)).sort()).toEqual(['a1', 'a2']);
  });
  it('復旧中と実際の送信数を毎秒表示し、停止したら状態の読み取りも止める', async () => {
    const { controller, services, sink } = await setup();
    let telemetry: SpoutTelemetry = {
      state: 'recovering',
      message: 'デバイスが失われた',
      sentFrames: 12,
      failures: 1,
      recoveries: 0,
      elapsedSeconds: 2,
      sendFps: 6,
      senderName: '2D Liver_1',
      adapterId: 'gpu',
      adapterFallback: false,
    };
    const read = vi.fn(async () => telemetry);
    Object.assign(sink, { telemetry: read });
    controller.sync(services, output());
    await controller.whenIdle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.status()).toMatchObject({ state: 'recovering', telemetry: { failures: 1, sentFrames: 12 } });
    telemetry = { ...telemetry, state: 'running', message: null, recoveries: 1, sentFrames: 72, sendFps: 24 };
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.status()).toMatchObject({ state: 'running', telemetry: { recoveries: 1, sentFrames: 72 } });
    await controller.stop();
    const reads = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(read).toHaveBeenCalledTimes(reads);
    expect(controller.status()).toEqual({ state: 'off' });
  });

  it('bindSpoutOutput は環境設定を見張って sync する', async () => {
    const { services, sink, controller } = await setup();
    const environment = createEnvironmentStore(memoryEnvironmentStorage());
    await environment.load();
    const off = bindSpoutOutput(services, environment, controller);
    await controller.whenIdle();
    expect(sink.log).toEqual([]);
    environment.set({ output: { ...createDefaultEnvironment().output, method: 'spout2', width: 1280, height: 720 } });
    await controller.whenIdle();
    expect(sink.log[0]).toBe('start 1280x720@60');
    off();
    await controller.stop();
    expect(sink.log.at(-1)).toBe('stop');
  });

  it('状態の読み取りに失敗した後も、やり直すと古い送信を閉じて始め直す', async () => {
    const { controller, services, sink } = await setup();
    Object.assign(sink, { telemetry: vi.fn().mockRejectedValue(new Error('状態を取得できない')) });
    controller.sync(services, output());
    await controller.whenIdle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.status()).toMatchObject({ state: 'error' });
    controller.retry();
    await controller.whenIdle();
    expect(sink.log.slice(2)).toEqual(['stop', 'start 1920x1080@60', 'textures a1,a2']);
    expect(controller.status()).toMatchObject({ state: 'running' });
    await controller.stop();
  });
});
