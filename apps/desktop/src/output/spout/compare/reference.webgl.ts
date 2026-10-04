// プレビュー（WebGL のレンダラー）と Spout2 の出力（Rust の D3D11）の見た目を比べるための見本を作る。
// 同じ DeformedModel を WebGL で描いた絵（乗算済みの RGBA を PNG に入れたもの）と、本物の createSpoutSink が Rust へ送る
// バイナリ（フレーム・テクスチャ）を src-tauri/src/output/testdata に書く。比べるのは Rust のテスト（gpu_tests.rs）。
// ブラウザ（Edge のヘッドレス）で動かす:
//   pnpm --filter @app/desktop exec vitest run --config src/output/spout/compare/vitest.webgl.config.ts
import { commands } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import {
  createAssetRepository,
  type Background,
  type DeformedModel,
  type DrawItem,
  type ViewTransform,
} from '@app/contracts';
import { createBindingEvaluator, createDeformPipeline, createMeshGenerator } from '@app/core';
import { createWebGLRenderer } from '@app/render';
import { loadProjectJson, type Mesh, type Project } from '@app/schema';
import { DEFAULT_MODEL_TRANSFORM, modelRect, outputView, type ModelTransform } from '../../../modes/studio/placement';
import { COMMAND_SET_TEXTURES, COMMAND_START, COMMAND_SUBMIT, createSpoutSink } from '../sink';
import { encodePng } from './png';

// ファイルの読み書きのパスは root（apps/desktop）からの相対
const TESTDATA = 'src-tauri/src/output/testdata/';
const SAMPLE_MODEL = '../../fixtures/sample-model/';

interface Scene {
  name: string;
  width: number;
  height: number;
  model: DeformedModel;
  view: ViewTransform;
  background: Background;
  pngs: Record<string, Uint8Array>; // assetId → PNG
}

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const readBytes = async (path: string) => fromBase64(await commands.readFile(path, 'base64'));
const writeBytes = (path: string, bytes: Uint8Array) => commands.writeFile(path, toBase64(bytes), 'base64');

// ---- 素材を作る道具 ----

type Rgba = [number, number, number, number];

function pixels(width: number, height: number, f: (x: number, y: number) => Rgba): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++)
      out.set(
        f(x, y).map((v) => Math.round(Math.min(255, Math.max(0, v)))),
        (y * width + x) * 4,
      );
  }
  return out;
}

const png = (width: number, height: number, f: (x: number, y: number) => Rgba) =>
  encodePng(width, height, pixels(width, height, f));

function item(
  partId: string,
  assetId: string,
  positions: number[],
  uvs: number[],
  indices: number[],
  extra: Partial<DrawItem> = {},
): DrawItem {
  return {
    partId,
    assetId,
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    opacity: 1,
    blendMode: 'normal',
    mask: null,
    ...extra,
  };
}

const quad = (
  partId: string,
  assetId: string,
  [x0, y0, x1, y1]: [number, number, number, number],
  extra: Partial<DrawItem> = {},
) => item(partId, assetId, [x0, y0, x1, y0, x1, y1, x0, y1], [0, 0, 1, 0, 1, 1, 0, 1], [0, 1, 2, 0, 2, 3], extra);

// 中心 (cx, cy)・大きさ size の格子を、angle だけ回し、波で歪ませる
function grid(
  partId: string,
  assetId: string,
  cx: number,
  cy: number,
  size: number,
  angle: number,
  wave: number,
  n = 8,
  extra: Partial<DrawItem> = {},
): DrawItem {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const v = j / n;
      const x = (u - 0.5) * size + Math.sin(v * Math.PI * 2) * wave;
      const y = (v - 0.5) * size + Math.sin(u * Math.PI * 2) * wave;
      positions.push(cx + x * c - y * s, cy + x * s + y * c);
      uvs.push(u, v);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      indices.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
    }
  }
  return item(partId, assetId, positions, uvs, indices, extra);
}

const deformed = (...items: DrawItem[]): DeformedModel => ({
  items,
  byPartId: Object.fromEntries(items.map((i) => [i.partId, i])),
});

// ---- サンプルモデル ----

// サンプルは割り当てだけ済んだ状態でメッシュが無いので、開発用の「サンプルモデルを開く」（dev/sampleModel.ts）と同じく作る
async function loadSampleModel(): Promise<{ project: Project; pngs: Record<string, Uint8Array> }> {
  const loaded = loadProjectJson(await commands.readFile(`${SAMPLE_MODEL}project.json`));
  const assets = createAssetRepository();
  const pngs: Record<string, Uint8Array> = {};
  for (const asset of loaded.assets) {
    pngs[asset.id] = await readBytes(`${SAMPLE_MODEL}${asset.path}`);
    await assets.put(asset.id, pngs[asset.id]!);
  }
  const generator = createMeshGenerator();
  const meshes: Mesh[] = [...loaded.model.meshes];
  const parts = loaded.model.parts.map((part) => {
    const asset = loaded.assets.find((a) => a.id === part.assetId);
    const alpha = part.assetId ? assets.getImageData(part.assetId) : undefined;
    if (part.kind !== 'image' || part.meshId || !asset || !alpha) return part;
    const mesh: Mesh = {
      id: `mesh-${part.id}`,
      ...generator.generate(alpha, asset.offset, 'standard'),
      density: 'standard',
      edited: false,
    };
    meshes.push(mesh);
    return { ...part, meshId: mesh.id };
  });
  return { project: { ...loaded, model: { ...loaded.model, parts, meshes } }, pngs };
}

function deformSample(project: Project, overrides: Record<string, number>): DeformedModel {
  const params: Record<string, number> = {};
  for (const p of project.model.parameters) params[p.id] = p.default;
  Object.assign(params, overrides);
  const evaluator = createBindingEvaluator();
  const pipeline = createDeformPipeline();
  return pipeline.deform(project.model, evaluator.evaluate(project.model, params));
}

function sampleView(
  project: Project,
  size: { width: number; height: number },
  t: ModelTransform = DEFAULT_MODEL_TRANSFORM,
) {
  return outputView(modelRect(project), t, size);
}

// マスク・反転マスク・乗算・スクリーン・加算・不透明度を、サンプルモデルの品目に付ける
function withEffects(model: DeformedModel): DeformedModel {
  const patch: Record<string, Partial<DrawItem>> = {
    'part-irisL': { mask: { sourcePartIds: ['part-eyeWhiteL'], inverted: false } },
    'part-irisR': { mask: { sourcePartIds: ['part-eyeWhiteR'], inverted: false } },
    'part-highlightL': { blendMode: 'add' },
    'part-highlightR': { blendMode: 'add', opacity: 0.6 },
    'part-browL': { blendMode: 'multiply', opacity: 0.8 },
    'part-browR': { blendMode: 'multiply' },
    'part-frontHair': { blendMode: 'screen', opacity: 0.7 },
    'part-sideHairL': { mask: { sourcePartIds: ['part-face', 'part-neck'], inverted: true } },
    'part-sideHairR': { mask: { sourcePartIds: ['part-neck', 'part-face', 'part-face'], inverted: false } },
    'part-torso': { opacity: 0.5 },
  };
  const items = model.items.map((i) => (patch[i.partId] ? { ...i, ...patch[i.partId] } : i));
  return deformed(...items);
}

// ---- 作るもの ----

async function scenes(): Promise<Scene[]> {
  const { project, pngs } = await loadSampleModel();
  const full = { width: 1920, height: 1080 };
  const hd = { width: 1280, height: 720 };
  const list: Scene[] = [
    {
      name: 'sample-model',
      ...full,
      model: deformSample(project, {}),
      view: sampleView(project, full),
      background: { type: 'transparent' },
      pngs,
    },
    {
      name: 'sample-model-posed',
      ...hd,
      model: deformSample(project, {
        FaceAngleX: 20,
        FaceAngleY: -10,
        FaceAngleZ: 8,
        EyeOpenL: 0.3,
        EyeBallX: 0.6,
        EyeBallY: -0.4,
        MouthOpen: 0.8,
      }),
      view: sampleView(project, hd, { position: { x: 60, y: 120 }, scale: 1.4 }),
      background: { type: 'color', color: '#3a6ea5' },
      pngs,
    },
    {
      name: 'sample-model-effects',
      ...hd,
      model: withEffects(deformSample(project, { FaceAngleX: -12, MouthOpen: 0.5 })),
      view: sampleView(project, hd),
      background: { type: 'transparent' },
      pngs,
    },
  ];

  // 作った素材: 半透明のグラデーション・縮小（ミップマップ）を見る市松模様・縁のぼけた円・半透明の下地
  const synthetic: Record<string, Uint8Array> = {
    grad: await png(64, 64, (x, y) => [x * 4, y * 4, 128, (x + y) * 2]),
    checker: await png(256, 256, (x, y) =>
      ((x >> 3) + (y >> 3)) % 2 === 0 ? [250, 250, 250, 255] : [20, 30, 40, 255],
    ),
    disc: await png(128, 128, (x, y) => {
      const d = Math.hypot(x - 63.5, y - 63.5);
      return [230, 60, 40, 255 * Math.min(1, Math.max(0, (60 - d) / 6))];
    }),
    backdrop: await png(32, 32, (x, y) => [40 + x * 6, 120, 200 - y * 4, 180]),
  };
  list.push({
    name: 'synthetic',
    width: 512,
    height: 512,
    model: deformed(
      quad('grad', 'grad', [16, 16, 240, 240]),
      quad('checker', 'checker', [272, 16, 336, 80]),
      quad('checker-small', 'checker', [352, 16, 384, 48], { opacity: 0.75 }),
      grid('wave', 'grad', 400, 160, 180, 0.4, 12),
      grid('disc-rotated', 'disc', 128, 380, 200, Math.PI / 6, 0, 1),
      quad('backdrop', 'backdrop', [256, 272, 496, 496]),
      quad('multiply', 'disc', [256, 272, 360, 376], { blendMode: 'multiply' }),
      quad('screen', 'disc', [392, 272, 496, 376], { blendMode: 'screen' }),
      quad('add', 'disc', [256, 392, 360, 496], { blendMode: 'add', opacity: 0.8 }),
      quad('masked', 'checker', [380, 380, 500, 500], { mask: { sourcePartIds: ['add', 'screen'], inverted: false } }),
      quad('inverted', 'grad', [300, 300, 470, 470], {
        opacity: 0.6,
        mask: { sourcePartIds: ['multiply'], inverted: true },
      }),
    ),
    view: { scale: 1, offset: { x: 0, y: 0 } },
    background: { type: 'transparent' },
    pngs: synthetic,
  });
  list.push({
    name: 'synthetic-color',
    width: 400,
    height: 300,
    model: deformed(
      grid('wave', 'grad', 200, 150, 260, -0.3, 20, 12),
      quad('disc', 'disc', [60, 60, 180, 180], { blendMode: 'screen' }),
      quad('disc2', 'disc', [220, 120, 340, 240], { blendMode: 'multiply', opacity: 0.9 }),
    ),
    view: { scale: 0.8, offset: { x: 40, y: 30 } },
    background: { type: 'color', color: 'rgba(255, 200, 0, 0.5)' },
    pngs: synthetic,
  });

  // 背景の画像（スタジオの背景と同じく、オプションなしの createImageBitmap で作る）
  const background = await createImageBitmap(
    new ImageData(new Uint8ClampedArray(pixels(240, 180, (x, y) => [x, y * 1.4, 255 - x * 0.7, 255])), 240, 180),
  );
  list.push({
    name: 'background-image',
    width: 640,
    height: 360,
    model: deformed(
      quad('disc', 'disc', [200, 80, 440, 320], { opacity: 0.85 }),
      quad('grad', 'grad', [20, 20, 180, 180]),
    ),
    view: { scale: 1, offset: { x: 0, y: 0 } },
    background: { type: 'image', image: background },
    pngs: synthetic,
  });
  return list;
}

// WebGL のレンダラー（プレビューと同じもの）で描き、描画バッファを上の行から読む（乗算済み）
async function renderWebGL(scene: Scene): Promise<Uint8Array> {
  const assets = createAssetRepository(); // 素材の画像はアプリと同じ作り方（乗算済み・色空間を変えない）
  const images: Record<string, ImageBitmap> = {};
  for (const [id, bytes] of Object.entries(scene.pngs)) {
    await assets.put(id, bytes);
    images[id] = assets.getImage(id)!;
  }
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `display:block;width:${scene.width}px;height:${scene.height}px`;
  document.body.appendChild(canvas);
  const renderer = createWebGLRenderer();
  renderer.init(canvas);
  renderer.setTextures(images);
  renderer.render(scene.model, scene.view, scene.background);
  expect([canvas.width, canvas.height]).toEqual([scene.width, scene.height]); // devicePixelRatio は 1
  const gl = canvas.getContext('webgl2')!;
  const flipped = new Uint8Array(scene.width * scene.height * 4);
  gl.readPixels(0, 0, scene.width, scene.height, gl.RGBA, gl.UNSIGNED_BYTE, flipped);
  const row = scene.width * 4;
  const out = new Uint8Array(flipped.length);
  for (let y = 0; y < scene.height; y++)
    out.set(flipped.subarray((scene.height - 1 - y) * row, (scene.height - y) * row), y * row);
  renderer.dispose();
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  canvas.remove();
  return out;
}

// 本物の createSpoutSink が Rust へ送るもの（テクスチャのメッセージは送った順）
async function encodeForRust(scene: Scene): Promise<{ frame: Uint8Array; textures: Uint8Array[] }> {
  const sent: { command: string; bytes: Uint8Array }[] = [];
  const sink = createSpoutSink({
    invoke: async (command, args) => {
      if (args instanceof Uint8Array) sent.push({ command, bytes: args });
      return command === COMMAND_START ? { senderName: '2D Liver', msaaSamples: 4 } : [];
    },
    now: () => 1000,
  });
  await sink.setTextures(scene.pngs);
  await sink.start({ width: scene.width, height: scene.height, fps: 60 });
  sink.submit(scene.model, scene.view, scene.background);
  await sink.setTextures(scene.pngs); // 背景の画像の送信（順番待ち）が終わるのを待つ
  await sink.stop();
  const frames = sent.filter((s) => s.command === COMMAND_SUBMIT);
  expect(frames).toHaveLength(1);
  return {
    frame: frames[0]!.bytes,
    textures: sent.filter((s) => s.command === COMMAND_SET_TEXTURES).map((s) => s.bytes),
  };
}

describe('Spout2 の比べ合わせの見本', () => {
  it('WebGL で描いた絵と、Rust へ送るバイナリを書く', async () => {
    for (const scene of await scenes()) {
      const webgl = await renderWebGL(scene);
      const { frame, textures } = await encodeForRust(scene);
      await writeBytes(`${TESTDATA}${scene.name}.webgl.png`, await encodePng(scene.width, scene.height, webgl));
      await writeBytes(`${TESTDATA}${scene.name}.frame.bin`, frame);
      for (const [i, t] of textures.entries()) await writeBytes(`${TESTDATA}${scene.name}.textures-${i}.bin`, t);
      // 何も描かれていない絵にはしない
      expect(webgl.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
    }
  });
});
