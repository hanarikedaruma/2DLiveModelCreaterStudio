// 出力ウィンドウの中身（UI なし）。受け取ったプロジェクトと毎フレームの ParamValues を、
// メインと同じ evaluator・pipeline・renderer（createServices の実装）で描く
import type { Renderer, Services } from '@app/contracts';
import { createBackgroundImages, type BackgroundImages } from '../modes/studio/backgrounds';
import { fitFrame, scaleView } from '../modes/studio/placement';
import type { FrameMessage, ToOutput } from './protocol';
import type { OutputClient } from './transport';

export interface OutputAppOptions {
  services: Services;
  client: OutputClient;
  images?: BackgroundImages;
  schedule?: (cb: () => void) => void; // 描くタイミング（既定は requestAnimationFrame）
}

export interface OutputApp {
  ready: Promise<void>; // 受け取りを始めて ready を送ったら resolve する
  dispose(): void;
}

const defaultSchedule: (cb: () => void) => void =
  typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(() => cb()) : (cb) => setTimeout(cb, 16);

export function createOutputApp(root: HTMLElement, options: OutputAppOptions): OutputApp {
  const { services, client } = options;
  const images = options.images ?? createBackgroundImages();
  const schedule = options.schedule ?? defaultSchedule;

  root.classList.add('output-root');
  const canvas = document.createElement('canvas');
  canvas.className = 'output-canvas';
  canvas.dataset.testid = 'output-canvas';
  root.replaceChildren(canvas);

  const renderer: Renderer = services.createRenderer();
  renderer.init(canvas);

  let frame: FrameMessage | null = null;
  let hasProject = false;
  let scheduled = false;
  let disposed = false;

  function layout(f: FrameMessage) {
    // 出力画面の縦横比のまま、ウィンドウに収める
    const fit = fitFrame(f.size, root.clientWidth, root.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    const style = canvas.style;
    style.left = `${fit.x}px`;
    style.top = `${fit.y}px`;
    style.width = `${fit.width}px`;
    style.height = `${fit.height}px`;
    const w = Math.max(1, Math.round(fit.width * dpr));
    const h = Math.max(1, Math.round(fit.height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    return fit.scale;
  }

  function draw() {
    scheduled = false;
    if (disposed || !frame || !hasProject) return;
    const f = frame;
    const k = layout(f);
    if (k <= 0) return;
    const project = services.store.get();
    const deformed = services.pipeline.deform(project.model, services.evaluator.evaluate(project.model, f.params));
    renderer.render(deformed, scaleView(f.view, k), images.resolve(f.background));
  }

  function requestDraw() {
    if (scheduled || disposed) return;
    scheduled = true;
    schedule(draw);
  }

  function updateTextures() {
    const textures: Record<string, ImageBitmap> = {};
    for (const id of Object.keys(services.assets.all())) {
      const image = services.assets.getImage(id);
      if (image) textures[id] = image;
    }
    renderer.setTextures(textures);
    requestDraw();
  }

  function onMessage(m: ToOutput) {
    if (m.type === 'frame') {
      frame = m;
      requestDraw();
      return;
    }
    services.store.load(m.project);
    for (const [id, png] of Object.entries(m.assets)) {
      services.assets.put(id, png).catch((e: unknown) => console.error(`素材を読めない: ${id}`, e));
    }
    for (const [path, bytes] of Object.entries(m.backgrounds)) images.put(path, bytes);
    hasProject = true;
    requestDraw();
  }

  const offs: (() => void)[] = [services.assets.subscribe(updateTextures), images.subscribe(requestDraw)];
  const onResize = () => requestDraw();
  window.addEventListener('resize', onResize);
  offs.push(() => window.removeEventListener('resize', onResize));
  updateTextures();

  const ready = client.listen(onMessage).then((off) => {
    if (disposed) {
      off();
      return;
    }
    offs.push(off);
    client.send({ type: 'ready' });
  });

  return {
    ready,
    dispose() {
      disposed = true;
      for (const off of offs.splice(0)) off();
      renderer.dispose();
    },
  };
}
