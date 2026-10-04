import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type Asset, type Project } from '@app/schema';
import { createAssetRepository, type Services } from '@app/contracts';
import { createFakeServices } from '../services';
import { createStudioRuntime, type FrameScheduler } from '../modes/studio/runtime';
import { setBackgroundCommand } from '../modes/studio/scene';
import { createOutputController } from './controller';
import type { FrameMessage, ProjectMessage } from './protocol';
import { createMemoryOutputPair, type OutputHost } from './transport';

const idle: FrameScheduler = { request: () => () => {} }; // 自動では回さない（tick で進める）

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

async function setup() {
  const runtime = createStudioRuntime({ scheduler: idle, decodeImage: async () => ({}) as ImageBitmap });
  const services: Services = {
    ...createFakeServices(),
    assets: createAssetRepository({
      decode: async () => ({ image: {} as ImageBitmap, imageData: {} as ImageData }),
    }),
  };
  const project: Project = { ...createEmptyProject('出力'), assets: [asset('a1'), asset('a2')] };
  services.store.load(project);
  await services.assets.put('a1', new Uint8Array([1]));
  await services.assets.put('a2', new Uint8Array([2]));
  const pair = createMemoryOutputPair();
  const controller = createOutputController({ runtime, createHost: () => pair.host, batchMs: 500 });
  return { runtime, services, pair, controller };
}

const projects = (sent: unknown[]) => sent.filter((m): m is ProjectMessage => (m as ProjectMessage).type === 'project');
const frames = (sent: unknown[]) => sent.filter((m): m is FrameMessage => (m as FrameMessage).type === 'frame');

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('出力ウィンドウの制御（メイン側）', () => {
  it('選んだ解像度で開き、ready を受けたらプロジェクトとすべての素材を送り、以後は毎フレーム送る', async () => {
    const { runtime, services, pair, controller } = await setup();
    runtime.setOutputSize({ width: 1280, height: 720 });
    runtime.backgrounds.put('backgrounds/bg.png', new Uint8Array([7]));
    services.store.dispatch(setBackgroundCommand({ type: 'image', path: 'backgrounds/bg.png' }));
    await controller.open(services);
    expect(pair.opened).toEqual([{ width: 1280, height: 720 }]);
    expect(controller.isOpen()).toBe(true);
    expect(runtime.getState().running).toBe(true); // スタジオの画面を離れても回す

    runtime.tick(1);
    expect(pair.sent).toEqual([]); // ready の前は送らない

    pair.client.send({ type: 'ready' });
    const [first] = projects(pair.sent);
    expect(first!.project).toBe(services.store.get());
    expect(first!.assets).toEqual({ a1: new Uint8Array([1]), a2: new Uint8Array([2]) });
    expect(first!.backgrounds).toEqual({ 'backgrounds/bg.png': new Uint8Array([7]) });

    runtime.tick(2);
    runtime.tick(3);
    const sentFrames = frames(pair.sent);
    expect(sentFrames.map((f) => f.now)).toEqual([2, 3]);
    expect(sentFrames[1]).toMatchObject({
      params: runtime.lastFrame()!.params,
      view: runtime.lastFrame()!.view,
      background: { type: 'image', path: 'backgrounds/bg.png' },
      size: { width: 1280, height: 720 },
    });
  });

  it('プロジェクトの変更は 0.5 秒ごとにまとめて送り、変わった素材だけを入れる', async () => {
    const { services, pair, controller } = await setup();
    await controller.open(services);
    pair.client.send({ type: 'ready' });
    expect(projects(pair.sent)).toHaveLength(1);

    services.store.dispatch({ label: '名前', apply: (p) => ({ ...p, name: 'A' }) });
    vi.advanceTimersByTime(200);
    services.store.dispatch({ label: '名前', apply: (p) => ({ ...p, name: 'B' }) });
    vi.advanceTimersByTime(200);
    expect(projects(pair.sent)).toHaveLength(1);
    vi.advanceTimersByTime(100);
    const batched = projects(pair.sent);
    expect(batched).toHaveLength(2);
    expect(batched[1]!.project.name).toBe('B');
    expect(batched[1]!.assets).toEqual({});

    // 素材を差し替えると、その素材だけを送る
    await services.assets.put('a2', new Uint8Array([22]));
    vi.advanceTimersByTime(500);
    expect(projects(pair.sent)[2]!.assets).toEqual({ a2: new Uint8Array([22]) });

    // 出力ウィンドウを読み込み直したら（ready）、すべてを送り直す
    pair.client.send({ type: 'ready' });
    expect(Object.keys(projects(pair.sent)[3]!.assets).sort()).toEqual(['a1', 'a2']);
  });

  it('出力の大きさが変わったらウィンドウの大きさを変える', async () => {
    const { runtime, services, pair, controller } = await setup();
    await controller.open(services);
    runtime.setOutputSize({ width: 1280, height: 720 });
    expect(pair.resized).toEqual([{ width: 1280, height: 720 }]);
  });

  it('ユーザーが閉じたら送るのをやめ、実行部から外れる', async () => {
    const { runtime, services, pair, controller } = await setup();
    const changes = vi.fn();
    controller.subscribe(changes);
    await controller.open(services);
    pair.client.send({ type: 'ready' });
    pair.closeFromOutput();
    expect(controller.isOpen()).toBe(false);
    expect(changes).toHaveBeenCalledTimes(2);
    expect(runtime.getState().running).toBe(false);
    const count = pair.sent.length;
    runtime.tick(10);
    services.store.dispatch({ label: '名前', apply: (p) => ({ ...p, name: 'C' }) });
    vi.advanceTimersByTime(1000);
    expect(pair.sent).toHaveLength(count);
  });

  it('開いていれば前に出す。続けて押しても1つだけ開く。閉じるボタンで閉じる', async () => {
    const { services, pair, controller } = await setup();
    await Promise.all([controller.open(services), controller.open(services)]);
    expect(pair.opened).toHaveLength(1);
    await controller.open(services);
    expect(pair.focused).toBe(1);
    controller.close();
    expect(pair.isOpen).toBe(false);
    expect(controller.isOpen()).toBe(false);

    // 閉じた後にもう一度開ける。送り直しは1回だけ（受け取りが重ならない）
    await controller.open(services);
    expect(pair.opened).toHaveLength(2);
    pair.client.send({ type: 'ready' });
    expect(projects(pair.sent)).toHaveLength(1);
  });

  it('開けなかったら例外を返し、開いていない状態のまま', async () => {
    const { runtime, services } = await setup();
    const failing: OutputHost = {
      ...createMemoryOutputPair().host,
      open: () => Promise.reject(new Error('ポップアップが止められている')),
    };
    const controller = createOutputController({ runtime, createHost: () => failing });
    await expect(controller.open(services)).rejects.toThrow('ポップアップ');
    expect(controller.isOpen()).toBe(false);
    expect(runtime.getState().running).toBe(false);
  });
});
