import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyScene, loadProjectJson } from '@app/schema';
import {
  FakePipeline,
  FakeTrackingLayer,
  FakeTrackingSource,
  type Background,
  type DeformedModel,
  type Renderer,
  type Services,
  type TargetDeltas,
  type ViewTransform,
} from '@app/contracts';
import { createFakeServices } from '../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../shell/environment';
import { registry } from '../../shell/registry';
import { Shell } from '../../shell/Shell';
import { createOutputApp } from '../../output/app';
import { outputWindow } from '../../output/controller';
import { createMemoryOutputPair } from '../../output/transport';
import { register, setProjectDirResolver } from './index';
import { register as registerScenes } from './scenes'; // 背景の切り替えはシーンの編集（カード39）にある
import { activeScene } from './scene';
import { selectSceneCommand } from './scenes/commands';
import { animationFrameScheduler, studioRuntime } from './runtime';

const sampleJson = Object.values(
  import.meta.glob<string>('../../../../../fixtures/sample-model/project.json', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)[0]!;

class RecordingRenderer implements Renderer {
  renders: { model: DeformedModel; view: ViewTransform; background: Background }[] = [];
  textures: Record<string, ImageBitmap> = {};
  disposed = false;
  init() {}
  setTextures(images: Record<string, ImageBitmap>) {
    this.textures = images;
  }
  render(model: DeformedModel, view: ViewTransform, background: Background) {
    this.renders.push({ model, view, background });
  }
  dispose() {
    this.disposed = true;
  }
  last() {
    return this.renders.at(-1)!;
  }
}

// FaceAngleX の値だけ、すべてのパーツを右へずらす（仮実装の evaluator・pipeline は動かないので、テスト用に作る）
function movingServices(): Services {
  const base = createFakeServices();
  const fakePipeline = new FakePipeline(() => base.store.get().assets);
  return {
    ...base,
    evaluator: {
      evaluate(model, params): TargetDeltas {
        const x = params.FaceAngleX ?? 0;
        const transforms = Object.fromEntries(
          model.parts.map((p) => [p.id, { position: { x, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: 1 }]),
        );
        return { transforms, vertices: {}, warpPoints: {} };
      },
    },
    pipeline: {
      deform(model, deltas) {
        const out = fakePipeline.deform(model, deltas);
        const items = out.items.map((item) => {
          const dx = deltas.transforms[item.partId]?.position.x ?? 0;
          const positions = item.positions.map((v, i) => (i % 2 === 0 ? v + dx : v));
          return { ...item, positions };
        });
        return { items, byPartId: Object.fromEntries(items.map((i) => [i.partId, i])) };
      },
    },
  };
}

function stubSize(width: number, height: number) {
  const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height });
  return () => {
    if (w) Object.defineProperty(HTMLElement.prototype, 'clientWidth', w);
    if (h) Object.defineProperty(HTMLElement.prototype, 'clientHeight', h);
  };
}

async function setup(options: { tracking?: FakeTrackingSource; trackingLayer?: FakeTrackingLayer } = {}) {
  const renderer = new RecordingRenderer();
  const services: Services = { ...movingServices(), createRenderer: () => renderer };
  services.tracking = options.tracking ?? new FakeTrackingSource(() => Date.now());
  services.trackingLayer = options.trackingLayer ?? new FakeTrackingLayer();
  const storage = memoryEnvironmentStorage(null);
  const environment = createEnvironmentStore(storage);
  const utils = render(<Shell services={services} environment={environment} />);
  await act(async () => {
    services.store.load(loadProjectJson(sampleJson));
    services.editor.set({ mode: 'studio' });
  });
  return { services, renderer, storage, environment, ...utils };
}

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const scene = (services: Services) => activeScene(services.store.get())!;

let restoreSize: () => void = () => {};
beforeEach(() => {
  vi.useFakeTimers();
  registry.reset();
  register();
  registerScenes();
  restoreSize = stubSize(800, 600);
  // 毎フレームを setTimeout にして、偽のタイマーで進める
  studioRuntime.setScheduler({
    request(cb) {
      const id = setTimeout(() => cb(Date.now()), 16);
      return () => clearTimeout(id);
    },
  });
});
afterEach(() => {
  outputWindow.close();
  studioRuntime.stopTracking();
  restoreSize();
  vi.useRealTimers();
  studioRuntime.setScheduler(animationFrameScheduler());
});

describe('スタジオの画面', () => {
  it('仮実装のトラッキングでプレビューが動き、外れている状態が表示される', async () => {
    const { renderer } = await setup();
    expect(screen.getByText('スタジオの設定')).toBeTruthy();
    expect(screen.getByLabelText('トラッキングの状態').textContent).toBe('停止中');
    await advance(50);
    const still = renderer.last().model.items[0]!.positions[0]!;
    expect(renderer.last().model.items).toHaveLength(28);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '開始' }));
    });
    await advance(1000); // 1秒後は右いっぱい（20度）に近い
    const moved = renderer.last().model.items[0]!.positions[0]!;
    expect(moved - still).toBeGreaterThan(15);
    expect(studioRuntime.lastFrame()!.params.FaceAngleX).toBeGreaterThan(15);
    expect(screen.getByLabelText('トラッキングの状態').textContent).toBe('検出中');
    await advance(1000); // 2秒後は中央に戻る
    expect(Math.abs(renderer.last().model.items[0]!.positions[0]! - still)).toBeLessThan(2);
    expect(screen.queryByText('顔が外れている')).toBeNull();

    await advance(16_500); // 18秒を過ぎると2秒間外れる
    expect(screen.getByLabelText('トラッキングの状態').textContent).toBe('外れている');
    expect(screen.getByText('顔が外れている')).toBeTruthy();
    await advance(2000);
    expect(screen.getByLabelText('トラッキングの状態').textContent).toBe('検出中');
    expect(screen.queryByText('顔が外れている')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(screen.getByLabelText('トラッキングの状態').textContent).toBe('停止中');
  });

  it('プレビューは出力画面の縦横比で、view を縮めて描く', async () => {
    const { renderer } = await setup();
    await advance(20);
    const canvas = screen.getByTestId('studio-preview');
    // 1920×1080 を 800×600 に収める → 800×450（上下に 75 の余白）
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.top).toBe('75px');
    const frame = studioRuntime.lastFrame()!;
    const k = 800 / 1920;
    expect(renderer.last().view.scale).toBeCloseTo(frame.view.scale * k);
    expect(renderer.last().view.offset.x).toBeCloseTo(frame.view.offset.x * k);
  });

  it('カメラとミラーを Environment に保存する', async () => {
    const tracking = new FakeTrackingSource(() => Date.now());
    vi.spyOn(tracking, 'listDevices').mockResolvedValue([
      { id: 'cam-a', label: 'カメラA' },
      { id: 'cam-b', label: 'カメラB' },
    ]);
    const start = vi.spyOn(tracking, 'start');
    const trackingLayer = new FakeTrackingLayer();
    const setMirror = vi.spyOn(trackingLayer, 'setMirror');
    const { storage, environment } = await setup({ tracking, trackingLayer });
    await act(async () => {});
    expect(setMirror).toHaveBeenLastCalledWith(true);

    const mirror = screen.getByRole('checkbox', { name: 'ミラー' }) as HTMLInputElement;
    expect(mirror.checked).toBe(true); // 初期値はオン
    fireEvent.click(mirror);
    expect(environment.get().mirror).toBe(false);
    expect(setMirror).toHaveBeenLastCalledWith(false);

    const select = screen.getByRole('combobox', { name: 'カメラ' }) as HTMLSelectElement;
    expect(select.value).toBe('cam-a');
    fireEvent.change(select, { target: { value: 'cam-b' } });
    expect(environment.get().cameraDeviceId).toBe('cam-b');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '開始' }));
    });
    expect(start).toHaveBeenLastCalledWith('cam-b');

    await environment.flush();
    expect(JSON.parse(storage.text!)).toMatchObject({ mirror: false, cameraDeviceId: 'cam-b' });
  });

  it('カメラの手動指定を保存・復元し、動作中も新しい設定を反映する（I-001）', async () => {
    const tracking = new FakeTrackingSource(() => Date.now());
    const configure = vi.spyOn(tracking, 'configureCapture');
    const { environment, storage } = await setup({ tracking });
    fireEvent.click(screen.getByRole('button', { name: '手動' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'カメラの解像度' }), { target: { value: '1920x1080' } });
    const fps = screen.getByRole('spinbutton', { name: 'カメラの要求fps' });
    fireEvent.change(fps, { target: { value: '30' } });
    fireEvent.blur(fps);
    const settings = { mode: 'manual', width: 1920, height: 1080, fps: 30 };
    expect(environment.get().cameraCapture).toEqual(settings);
    expect(configure).toHaveBeenLastCalledWith(settings);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '開始' }));
    });
    expect(screen.getByLabelText('カメラの実測').textContent).toContain('1920×1080');
    fireEvent.change(fps, { target: { value: '60' } });
    fireEvent.blur(fps);
    expect(configure).toHaveBeenLastCalledWith({ ...settings, fps: 60 });
    await environment.flush();
    const restored = createEnvironmentStore(storage);
    await restored.load();
    expect(restored.get().cameraCapture).toEqual({ ...settings, fps: 60 });
    fireEvent.click(screen.getByRole('button', { name: '自動' }));
    expect(screen.queryByRole('spinbutton', { name: 'カメラの要求fps' })).toBeNull();
    expect(environment.get().cameraCapture).toEqual({ ...settings, fps: 60, mode: 'auto' });
  });

  it('受信fpsと推定fps・機器上限を区別して表示する（I-002）', async () => {
    const tracking = new FakeTrackingSource(() => Date.now());
    vi.spyOn(tracking, 'captureStats').mockReturnValue({
      mode: 'auto',
      state: 'ready',
      width: 640,
      height: 480,
      requestedFps: 60,
      nominalFps: 30,
      maxFps: 60,
      cameraFps: 29.5,
      trackingFps: 14.2,
      warning: '要求fps未達',
    });
    await setup({ tracking });
    const stats = screen.getByLabelText('カメラの実測');
    expect(stats.textContent).toContain('受信fps29.5');
    expect(stats.textContent).toContain('推定fps14.2');
    expect(stats.textContent).toContain('動作設定30 fps');
    expect(stats.textContent).toContain('機器上限60 fps');
    expect(screen.getByText('要求fps未達')).toBeTruthy();
  });

  it('背景の切り替えがシーンに保存され、プレビューにも出る', async () => {
    const { services, renderer } = await setup();
    fireEvent.click(screen.getByRole('button', { name: '緑' }));
    expect(scene(services).background).toEqual({ type: 'color', color: '#00ff00' });
    await advance(20);
    expect(renderer.last().background).toEqual({ type: 'color', color: '#00ff00' });
    expect(screen.getByRole('button', { name: '緑' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '青' }));
    expect(scene(services).background).toEqual({ type: 'color', color: '#0000ff' });

    // 任意の色は、決めたとき（change）に保存する
    fireEvent.change(screen.getByLabelText('任意の色を選ぶ'), { target: { value: '#123456' } });
    expect(scene(services).background).toEqual({ type: 'color', color: '#123456' });
    expect(screen.getByLabelText('いまの背景').textContent).toContain('#123456');

    fireEvent.click(screen.getByRole('button', { name: '透明' }));
    expect(scene(services).background).toEqual({ type: 'transparent' });
    act(() => services.store.undo());
    expect(scene(services).background).toEqual({ type: 'color', color: '#123456' });
  });

  it('背景の画像を選ぶと backgrounds/ のパスがシーンに入り、フォルダがあれば写す', async () => {
    const { services } = await setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); // jsdom には createImageBitmap が無い
    const input = screen.getByTestId('studio-background-file') as HTMLInputElement;
    const pick = async (name: string, bytes: number[]) => {
      const file = new File([new Uint8Array(bytes)], name, { type: 'image/png' });
      await act(async () => {
        fireEvent.change(input, { target: { files: [file] } });
      });
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
    };

    // フォルダがまだ無い（保存の結合はカード23）
    await pick('room.png', [1, 2, 3]);
    const bg = scene(services).background;
    expect(bg.type).toBe('image');
    const path = bg.type === 'image' ? bg.path : '';
    expect(path).toMatch(/^backgrounds\/.+\.png$/);
    expect(screen.getByText(/保存するときに backgrounds\/ へ写す/)).toBeTruthy();

    // フォルダがあれば、そこへ写す
    setProjectDirResolver(() => '/projects/demo');
    await pick('sky.png', [4, 5]);
    const bg2 = scene(services).background;
    const path2 = bg2.type === 'image' ? bg2.path : '';
    expect(path2).not.toBe(path);
    expect(await services.fs.readBinary(`/projects/demo/${path2}`)).toEqual(new Uint8Array([4, 5]));
    expect(screen.queryByText(/保存するときに backgrounds\/ へ写す/)).toBeNull();
    expect(screen.getByText(/画像として読めない/)).toBeTruthy();
    setProjectDirResolver(() => null);
    warn.mockRestore();
  });

  it('ドラッグでモデルの位置、ホイールで大きさを変えてシーンに保存する', async () => {
    const { services, renderer } = await setup();
    await advance(20);
    const canvas = screen.getByTestId('studio-preview');
    const k = 800 / 1920;
    const before = studioRuntime.lastFrame()!.view;

    fireEvent.pointerDown(canvas, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(canvas, { button: 0, clientX: 150, clientY: 80, pointerId: 1 });
    await advance(20);
    // ドラッグ中もプレビューは動くが、まだ保存しない
    expect(studioRuntime.lastFrame()!.view.offset.x - before.offset.x).toBeCloseTo(50 / k);
    expect(renderer.last().view.offset.x - before.offset.x * k).toBeCloseTo(50);
    expect(scene(services).modelTransform.position).toEqual({ x: 0, y: 0 });
    fireEvent.pointerUp(canvas, { button: 0, clientX: 150, clientY: 80, pointerId: 1 });
    expect(scene(services).modelTransform.position.x).toBeCloseTo(50 / k);
    expect(scene(services).modelTransform.position.y).toBeCloseTo(-20 / k);

    // 出力画面の中央でホイール → 位置はそのままで大きくなる。止まってから保存する
    fireEvent.wheel(canvas, { deltaY: -200, clientX: 400, clientY: 225 });
    await advance(100);
    expect(scene(services).modelTransform.scale).toBe(1);
    expect(studioRuntime.modelTransform().scale).toBeCloseTo(Math.exp(0.3));
    await advance(300);
    expect(scene(services).modelTransform.scale).toBeCloseTo(Math.exp(0.3));

    // Undo で戻る。[配置を戻す] で最初の配置に戻す
    act(() => services.store.undo());
    expect(scene(services).modelTransform.scale).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: '配置を戻す' }));
    expect(scene(services).modelTransform).toEqual({ position: { x: 0, y: 0 }, scale: 1 });
  });

  it.each(['ドラッグ', 'ホイール'])(
    '%s の途中でシーンを切り替えても、別のシーンの配置を変えない',
    async (operation) => {
      const { services } = await setup();
      const original = scene(services);
      const other = {
        ...createEmptyScene('別のシーン'),
        modelTransform: { position: { x: 20, y: 40 }, scale: 0.7 },
      };
      const project = services.store.get();
      act(() =>
        services.store.load({
          ...project,
          studio: { ...project.studio, scenes: [original, other], activeSceneId: original.id },
        }),
      );
      const canvas = screen.getByTestId('studio-preview');
      if (operation === 'ドラッグ') {
        fireEvent.pointerDown(canvas, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: 150, clientY: 80, pointerId: 1 });
      } else {
        fireEvent.wheel(canvas, { deltaY: -200, clientX: 400, clientY: 225 });
      }
      expect(studioRuntime.modelTransform()).not.toEqual(original.modelTransform);

      // React の再描画を待たずに、切り替え先の配置へ戻す
      act(() => {
        services.store.dispatch(selectSceneCommand(other.id));
        expect(studioRuntime.modelTransform()).toEqual(other.modelTransform);
      });
      fireEvent.pointerMove(canvas, { clientX: 200, clientY: 180, pointerId: 1 });
      fireEvent.pointerUp(canvas, { button: 0, pointerId: 1 });
      await advance(400);
      expect(services.store.get().studio.scenes).toEqual([original, other]);

      // 余分な配置の履歴がなく、1回の Undo で切り替え前に戻る
      act(() => services.store.undo());
      expect(scene(services).id).toBe(original.id);
      expect(studioRuntime.modelTransform()).toEqual(original.modelTransform);
      expect(services.store.canUndo()).toBe(false);
      act(() => services.store.redo());
      expect(scene(services).id).toBe(other.id);

      // 切り替え後も、新しく始めた配置の操作は保存できる
      fireEvent.wheel(canvas, { deltaY: -200, clientX: 400, clientY: 225 });
      await advance(400);
      expect(scene(services).modelTransform.scale).toBeCloseTo(other.modelTransform.scale * Math.exp(0.3));
      expect(services.store.get().studio.scenes[0]).toEqual(original);
    },
  );
});

describe('出力', () => {
  it('解像度を選ぶと Environment に保存し、任意の大きさも入れられる', async () => {
    const { environment } = await setup();
    const select = screen.getByRole('combobox', { name: '解像度' }) as HTMLSelectElement;
    expect(select.value).toBe('1920x1080');
    fireEvent.change(select, { target: { value: '1280x720' } });
    expect(environment.get().output).toMatchObject({ width: 1280, height: 720 });
    expect(studioRuntime.getOutputSize()).toEqual({ width: 1280, height: 720 });
    expect(screen.getByLabelText('出力の解像度').textContent).toBe('1280×720');

    fireEvent.change(select, { target: { value: 'custom' } });
    const width = screen.getByRole('spinbutton', { name: '幅' });
    fireEvent.change(width, { target: { value: '1080' } });
    fireEvent.blur(width);
    const height = screen.getByRole('spinbutton', { name: '高さ' });
    fireEvent.change(height, { target: { value: '1920' } });
    fireEvent.keyDown(height, { key: 'Enter' });
    expect(environment.get().output).toMatchObject({ width: 1080, height: 1920 });

    // 範囲の外は戻す
    fireEvent.change(width, { target: { value: '3' } });
    fireEvent.blur(width);
    expect(environment.get().output.width).toBe(1080);
    expect((screen.getByRole('spinbutton', { name: '幅' }) as HTMLInputElement).value).toBe('1080');
  });

  it('出力ウィンドウを選んだ解像度で開き、プレビューと同じ動きで描く', async () => {
    const pair = createMemoryOutputPair();
    outputWindow.setHostFactory(() => pair.host);
    const { renderer, environment } = await setup();
    act(() => environment.set({ output: { ...environment.get().output, width: 1280, height: 720 } }));
    fireEvent.click(screen.getByRole('button', { name: '緑' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '出力ウィンドウを開く' }));
    });
    expect(pair.opened).toEqual([{ width: 1280, height: 720 }]);
    expect(screen.getByRole('button', { name: '閉じる' })).toBeTruthy();

    // 出力ウィンドウ（別の services・同じ実装の evaluator・pipeline・renderer）
    const outputRenderer = new RecordingRenderer();
    const outputServices: Services = { ...movingServices(), createRenderer: () => outputRenderer };
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = createOutputApp(root, { services: outputServices, client: pair.client, schedule: (cb) => cb() });
    await act(async () => {
      await app.ready;
    });
    expect(pair.sent[0]?.type).toBe('project');
    expect(outputServices.store.get().model.parts).toHaveLength(28);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '開始' }));
    });
    await advance(700);
    const preview = renderer.last();
    const out = outputRenderer.last();
    // 同じフレームの値から描くので、モデルの形は同じ
    expect(out.model.items.map((i) => Array.from(i.positions))).toEqual(
      preview.model.items.map((i) => Array.from(i.positions)),
    );
    expect(out.background).toEqual({ type: 'color', color: '#00ff00' });
    // view は同じフレームの view を、それぞれの大きさに縮めたもの（プレビュー 800/1280、出力 800/1280）
    const frame = studioRuntime.lastFrame()!;
    expect(out.view.scale).toBeCloseTo(frame.view.scale * (800 / 1280));
    expect(preview.view.scale).toBeCloseTo(frame.view.scale * (800 / 1280));

    // 配置を変えると出力も同じに動く
    const canvas = screen.getByTestId('studio-preview');
    fireEvent.pointerDown(canvas, { button: 0, clientX: 0, clientY: 0, pointerId: 2 });
    fireEvent.pointerMove(canvas, { button: 0, clientX: 40, clientY: 0, pointerId: 2 });
    await advance(20);
    expect(outputRenderer.last().view.offset.x).toBeCloseTo(renderer.last().view.offset.x);
    fireEvent.pointerUp(canvas, { button: 0, clientX: 40, clientY: 0, pointerId: 2 });

    // 解像度を変えると出力ウィンドウの大きさも変える
    fireEvent.change(screen.getByRole('combobox', { name: '解像度' }), { target: { value: '1920x1080' } });
    expect(pair.resized).toEqual([{ width: 1920, height: 1080 }]);

    // ユーザーが出力ウィンドウを閉じた
    act(() => pair.closeFromOutput());
    expect(screen.queryByRole('button', { name: '閉じる' })).toBeNull();
    app.dispose();
    root.remove();
  });
});
