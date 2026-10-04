import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type Project } from '@app/schema';
import {
  createAssetRepository,
  type Background,
  type DeformedModel,
  type Renderer,
  type Services,
  type ViewTransform,
} from '@app/contracts';
import { createFakeServices } from '../services';
import { createBackgroundImages } from '../modes/studio/backgrounds';
import { createOutputApp } from './app';
import type { FrameMessage, FromOutput, ToOutput } from './protocol';
import type { OutputClient } from './transport';

class RecordingRenderer implements Renderer {
  renders: { model: DeformedModel; view: ViewTransform; background: Background }[] = [];
  textures: Record<string, ImageBitmap> = {};
  canvas: HTMLCanvasElement | null = null;
  disposed = false;
  init(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }
  setTextures(images: Record<string, ImageBitmap>) {
    this.textures = images;
  }
  render(model: DeformedModel, view: ViewTransform, background: Background) {
    this.renders.push({ model, view, background });
  }
  dispose() {
    this.disposed = true;
  }
}

function memoryClient() {
  let listener: ((m: ToOutput) => void) | null = null;
  const sent: FromOutput[] = [];
  const client: OutputClient = {
    async listen(l) {
      listener = l;
      return () => {
        listener = null;
      };
    },
    send: (m) => sent.push(m),
  };
  return { client, sent, deliver: (m: ToOutput) => listener?.(m), listening: () => listener !== null };
}

function projectWithPart(): Project {
  const p = createEmptyProject('出力');
  return {
    ...p,
    assets: [
      {
        id: 'a1',
        path: 'assets/a1.png',
        hash: 'h',
        width: 100,
        height: 50,
        offset: { x: 10, y: 20 },
        canvasSize: { width: 1000, height: 1000 },
        source: { kind: 'png', file: 'a1.png' },
        sourceBlendMode: 'normal',
        sourceOpacity: 1,
      },
    ],
    model: {
      ...p.model,
      parts: [
        {
          id: 'p1',
          name: '顔',
          kind: 'image',
          standardType: 'face',
          assetId: 'a1',
          meshId: null,
          parentId: null,
          position: { x: 0, y: 0 },
          rotation: 0,
          scale: { x: 1, y: 1 },
          pivot: { x: 0, y: 0 },
          opacity: 1,
          blendMode: 'normal',
          depth: 0,
          mask: null,
          physicsId: null,
          visible: true,
          locked: false,
        },
      ],
      drawOrder: ['p1'],
    },
  };
}

const frame = (over: Partial<FrameMessage> = {}): FrameMessage => ({
  type: 'frame',
  params: { FaceAngleX: 12 },
  view: { scale: 0.5, offset: { x: 100, y: 40 } },
  background: { type: 'color', color: '#00ff00' },
  size: { width: 1920, height: 1080 },
  now: 1,
  ...over,
});

let restore: (() => void) | null = null;
function stubRootSize(width: number, height: number) {
  const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height });
  restore = () => {
    if (w) Object.defineProperty(HTMLElement.prototype, 'clientWidth', w);
    if (h) Object.defineProperty(HTMLElement.prototype, 'clientHeight', h);
  };
}
afterEach(() => {
  restore?.();
  restore = null;
});

function setup() {
  const renderer = new RecordingRenderer();
  const services: Services = {
    ...createFakeServices(),
    createRenderer: () => renderer,
    assets: createAssetRepository({
      decode: async (png) => ({ image: { width: png[0] } as ImageBitmap, imageData: {} as ImageData }),
    }),
  };
  const images = createBackgroundImages({ decode: async (b) => ({ width: b[0] }) as ImageBitmap });
  const root = document.createElement('div');
  const { client, sent, deliver, listening } = memoryClient();
  const app = createOutputApp(root, { services, client, images, schedule: (cb) => cb() });
  return { renderer, services, root, app, sent, deliver, listening };
}

describe('出力ウィンドウ', () => {
  it('受け取りを始めてから ready を送る。UI は出さずキャンバスだけ', async () => {
    const { app, sent, listening, root, renderer } = setup();
    await app.ready;
    expect(listening()).toBe(true);
    expect(sent).toEqual([{ type: 'ready' }]);
    expect(root.children).toHaveLength(1);
    expect(root.firstElementChild).toBe(renderer.canvas);
  });

  it('プロジェクトと素材を受け取り、毎フレームの ParamValues を同じ evaluator・pipeline で描く', async () => {
    stubRootSize(960, 540);
    const { app, deliver, renderer, services } = setup();
    await app.ready;
    const evaluate = vi.spyOn(services.evaluator, 'evaluate');
    deliver(frame()); // プロジェクトの前のフレームは描かない
    expect(renderer.renders).toHaveLength(0);

    const project = projectWithPart();
    deliver({ type: 'project', project, assets: { a1: new Uint8Array([5]) }, backgrounds: {} });
    await Promise.resolve();
    await Promise.resolve();
    expect(renderer.textures).toEqual({ a1: { width: 5 } });
    deliver(frame({ params: { FaceAngleX: 20 } }));
    const last = renderer.renders.at(-1)!;
    expect(evaluate).toHaveBeenLastCalledWith(project.model, { FaceAngleX: 20 });
    expect(Array.from(last.model.items[0]!.positions)).toEqual([10, 20, 110, 20, 110, 70, 10, 70]);
    // 1920×1080 を 960×540 のウィンドウに描く → 0.5 倍
    expect(last.view).toEqual({ scale: 0.25, offset: { x: 50, y: 20 } });
    expect(last.background).toEqual({ type: 'color', color: '#00ff00' });
  });

  it('縦横比が違うウィンドウでは、出力画面の縦横比のまま中央に置く', async () => {
    stubRootSize(1000, 1000);
    const { app, deliver, renderer, root } = setup();
    await app.ready;
    deliver({ type: 'project', project: projectWithPart(), assets: {}, backgrounds: {} });
    deliver(frame({ size: { width: 1000, height: 500 } }));
    const canvas = root.querySelector('canvas')!;
    expect(canvas.style.top).toBe('250px');
    expect(canvas.style.width).toBe('1000px');
    expect(renderer.renders.at(-1)!.view.scale).toBeCloseTo(0.5);
  });

  it('背景の画像を受け取って描く', async () => {
    stubRootSize(1920, 1080);
    const { app, deliver, renderer } = setup();
    await app.ready;
    deliver({
      type: 'project',
      project: projectWithPart(),
      assets: {},
      backgrounds: { 'backgrounds/bg.png': new Uint8Array([3]) },
    });
    await Promise.resolve();
    deliver(frame({ background: { type: 'image', path: 'backgrounds/bg.png' } }));
    expect(renderer.renders.at(-1)!.background).toEqual({ type: 'image', image: { width: 3 } });
  });

  it('片付けるとレンダラーを捨て、受け取りをやめる', async () => {
    const { app, listening, renderer } = setup();
    await app.ready;
    app.dispose();
    expect(renderer.disposed).toBe(true);
    expect(listening()).toBe(false);
  });
});
