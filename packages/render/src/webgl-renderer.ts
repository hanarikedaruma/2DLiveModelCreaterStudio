import type { Background, DeformedModel, DrawItem, Renderer, ViewTransform } from '@app/contracts';
import { applyBlend } from './blend';
import { resolveCssColor } from './color';
import {
  coverUv,
  cssToPixelRatio,
  drawingBufferSize,
  fitTextureSize,
  maskKey,
  viewToClip,
  type Size,
  type UvRect,
} from './geometry';
import { createProgram, DRAW_FRAGMENT_SHADER, MASK_FRAGMENT_SHADER, VERTEX_SHADER } from './shaders';

// WebGL2 のレンダラー（カード12）。
// - 色はすべて乗算済みアルファで扱う。setTextures と背景の ImageBitmap は乗算済み
//   （createImageBitmap の premultiplyAlpha: 'premultiply'。createAssetRepository の画像はこれ）を前提にする。
//   ImageBitmap のアップロードには UNPACK_PREMULTIPLY_ALPHA_WEBGL が効かず、作ったときの値のまま上がるため。
//   'none' で作った ImageBitmap を渡すと縁が明るくなる（見分けられない）
// - 描画バッファは render のたびに CSS の大きさ × devicePixelRatio に合わせる。view は CSS ピクセル
// - コンテキストを失っている間の render は何もしない。復帰したら GL のものとテクスチャを作り直し、最後のフレームを描き直す

export interface WebGLRendererOptions {
  // テクスチャの一辺の上限。MAX_TEXTURE_SIZE より小さい値だけが効く（縮小を試すためのもの）
  maxTextureSize?: number;
}

export function createWebGLRenderer(options: WebGLRendererOptions = {}): Renderer {
  return new WebGLRenderer(options);
}

const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: true,
  depth: false,
  stencil: false,
};

const FLOATS_PER_VERTEX = 4; // x, y, u, v
const MASK_NONE = 0;
const MASK_NORMAL = 1;
const MASK_INVERTED = 2;

interface TextureEntry {
  source: ImageBitmap;
  texture: WebGLTexture | null; // 空・閉じた画像は null（描かない）
  size: Size;
}

interface MaskTarget {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

interface ProgramInfo {
  program: WebGLProgram;
  scale: WebGLUniformLocation | null;
  offset: WebGLUniformLocation | null;
  opacity: WebGLUniformLocation | null;
  maskMode: WebGLUniformLocation | null;
}

// 1つのコンテキストに属する GL のもの。コンテキストを失ったら丸ごと捨てて作り直す
interface Gpu {
  gl: WebGL2RenderingContext;
  draw: ProgramInfo;
  mask: ProgramInfo;
  vao: WebGLVertexArrayObject;
  vertexBuffer: WebGLBuffer;
  indexBuffer: WebGLBuffer;
  noMask: WebGLTexture; // マスクを使わない描画で unit 1 に置いておく 1×1 のテクスチャ
  textures: Map<string, TextureEntry>; // assetId → テクスチャ
  background: TextureEntry | null;
  masks: MaskTarget[]; // 画面の大きさの1チャンネルのオフスクリーン。フレームをまたいで使い回す
  maskSize: Size;
  maxTextureSize: number;
}

// このフレームで描ける品目。first・count は索引のバッファの中の範囲
interface Prepared {
  item: DrawItem;
  texture: WebGLTexture;
  first: number;
  count: number;
  maskKey: string | null;
}

const clamp01 = (n: number) => (n > 0 ? (n < 1 ? n : 1) : 0);

class WebGLRenderer implements Renderer {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private gpu: Gpu | null = null;
  private images: Record<string, ImageBitmap> = {};
  private last: { model: DeformedModel; view: ViewTransform; background: Background } | null = null;
  private vertices = new Float32Array(4096);
  private indices = new Uint32Array(4096);
  private readonly warned = new Set<string>();

  constructor(private readonly options: WebGLRendererOptions) {}

  init(canvas: HTMLCanvasElement): void {
    if (this.canvas) this.dispose();
    const gl = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
    if (!gl) throw new Error('WebGL2 のコンテキストを作れない');
    this.canvas = canvas;
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    if (gl.isContextLost()) return; // 復帰を待つ
    try {
      this.gpu = this.createGpu(gl);
    } catch (e) {
      this.dispose();
      throw e;
    }
  }

  setTextures(images: Record<string, ImageBitmap>): void {
    this.images = { ...images };
    if (this.gpu) this.syncTextures(this.gpu);
  }

  render(model: DeformedModel, view: ViewTransform, background: Background): void {
    const canvas = this.canvas;
    if (!canvas) throw new Error('init の前に render を呼んだ');
    this.last = { model, view, background };
    const gpu = this.gpu;
    if (!gpu || gpu.gl.isContextLost()) return;
    const { gl } = gpu;

    // 描画バッファを CSS の大きさ × devicePixelRatio に合わせる
    const css = { width: canvas.clientWidth, height: canvas.clientHeight };
    const size = drawingBufferSize(css, globalThis.devicePixelRatio, { width: canvas.width, height: canvas.height });
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
    if (size.width <= 0 || size.height <= 0) return;
    // 大きすぎて縮められたときは、実際の描画バッファの大きさ（gl_FragCoord もこれ）を使う
    const buffer = { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight };
    const clip = viewToClip(view, cssToPixelRatio(css, size), size);

    const bg = this.backgroundTexture(gpu, background);
    const items = this.uploadGeometry(gpu, model.items, bg ? coverUv(bg.size, size) : null);
    const masks = this.renderMasks(gpu, items, clip, buffer);

    // 背景 → items の順に描く
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, buffer.width, buffer.height);
    const [r, g, b, a] = background.type === 'color' ? resolveCssColor(background.color) : [0, 0, 0, 0];
    gl.clearColor(r * a, g * a, b * a, a); // 描画バッファは乗算済み
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(gpu.draw.program);
    gl.bindVertexArray(gpu.vao);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, gpu.noMask);
    let maskMode = MASK_NONE;
    gl.uniform1i(gpu.draw.maskMode, maskMode);
    if (bg?.texture) {
      // 背景の四角形はクリップ座標のまま
      gl.uniform2f(gpu.draw.scale, 1, 1);
      gl.uniform2f(gpu.draw.offset, 0, 0);
      gl.uniform1f(gpu.draw.opacity, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bg.texture);
      applyBlend(gl, 'normal');
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0);
    }
    gl.uniform2f(gpu.draw.scale, clip.scale[0], clip.scale[1]);
    gl.uniform2f(gpu.draw.offset, clip.offset[0], clip.offset[1]);
    for (const p of items) {
      const opacity = clamp01(p.item.opacity);
      if (opacity <= 0) continue;
      let mode = MASK_NONE;
      if (p.item.mask && p.maskKey !== null) {
        const target = masks.get(p.maskKey);
        if (target) {
          mode = p.item.mask.inverted ? MASK_INVERTED : MASK_NORMAL;
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, target.texture);
        } else if (!p.item.mask.inverted) {
          continue; // 空のマスク（マスク元がどれも無い）。反転なら 1 − 0 = 1 でそのまま描く
        }
      }
      if (mode !== maskMode) {
        gl.uniform1i(gpu.draw.maskMode, mode);
        maskMode = mode;
      }
      gl.uniform1f(gpu.draw.opacity, opacity);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, p.texture);
      applyBlend(gl, p.item.blendMode);
      gl.drawElements(gl.TRIANGLES, p.count, gl.UNSIGNED_INT, p.first * 4);
    }
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const canvas = this.canvas;
    if (canvas) {
      canvas.removeEventListener('webglcontextlost', this.onContextLost);
      canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    }
    // コンテキスト自体は失わせない（同じ canvas で init し直せるように）
    if (this.gpu && !this.gpu.gl.isContextLost()) deleteGpu(this.gpu);
    this.canvas = null;
    this.gl = null;
    this.gpu = null;
    this.images = {};
    this.last = null;
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault(); // 復帰できるようにする
    this.gpu = null; // 失ったコンテキストのものは使えない（消す必要もない）
  };

  private readonly onContextRestored = (): void => {
    const gl = this.gl;
    if (!gl) return;
    try {
      this.gpu = this.createGpu(gl);
    } catch (e) {
      console.error('WebGL のコンテキストの復帰に失敗した', e);
      return;
    }
    const last = this.last;
    if (last) this.render(last.model, last.view, last.background);
  };

  private createGpu(gl: WebGL2RenderingContext): Gpu {
    const draw = programInfo(gl, DRAW_FRAGMENT_SHADER);
    const mask = programInfo(gl, MASK_FRAGMENT_SHADER);
    gl.useProgram(draw.program);
    gl.uniform1i(gl.getUniformLocation(draw.program, 'u_texture'), 0);
    gl.uniform1i(gl.getUniformLocation(draw.program, 'u_mask'), 1);
    gl.useProgram(mask.program);
    gl.uniform1i(gl.getUniformLocation(mask.program, 'u_texture'), 0);

    const vao = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bindVertexArray(null);

    const noMask = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, noMask);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, 1, 1);
    setNearest(gl);

    const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const gpu: Gpu = {
      gl,
      draw,
      mask,
      vao,
      vertexBuffer,
      indexBuffer,
      noMask,
      textures: new Map(),
      background: null,
      masks: [],
      maskSize: { width: 0, height: 0 },
      maxTextureSize: Math.min(limit, this.options.maxTextureSize ?? limit),
    };
    this.syncTextures(gpu);
    return gpu;
  }

  // 渡された画像とテクスチャを揃える。同じ ImageBitmap のものは作り直さない
  private syncTextures(gpu: Gpu): void {
    const { gl, textures } = gpu;
    for (const [assetId, entry] of textures) {
      if (this.images[assetId] === entry.source) continue;
      if (entry.texture) gl.deleteTexture(entry.texture);
      textures.delete(assetId);
    }
    for (const [assetId, image] of Object.entries(this.images)) {
      if (textures.has(assetId)) continue;
      textures.set(assetId, this.createTexture(gpu, image, `素材 ${assetId}`));
    }
  }

  private backgroundTexture(gpu: Gpu, background: Background): TextureEntry | null {
    if (background.type !== 'image') {
      if (gpu.background?.texture) gpu.gl.deleteTexture(gpu.background.texture);
      gpu.background = null;
      return null;
    }
    if (gpu.background?.source !== background.image) {
      if (gpu.background?.texture) gpu.gl.deleteTexture(gpu.background.texture);
      gpu.background = this.createTexture(gpu, background.image, '背景の画像');
    }
    return gpu.background;
  }

  // 乗算済みアルファのテクスチャを作る。ミップマップを作り LINEAR_MIPMAP_LINEAR で引く。上限を超える画像は縮小する
  private createTexture(gpu: Gpu, image: ImageBitmap, label: string): TextureEntry {
    const size = { width: image.width, height: image.height };
    const entry: TextureEntry = { source: image, texture: null, size };
    if (!(size.width > 0 && size.height > 0)) {
      this.warnOnce(`empty:${label}`, `画像が空か閉じられているので描かない: ${label}`);
      return entry;
    }
    const { gl } = gpu;
    let source: TexImageSource = image;
    const fit = fitTextureSize(size, gpu.maxTextureSize);
    if (fit.width !== size.width || fit.height !== size.height) {
      console.warn(
        `画像がテクスチャの上限（${gpu.maxTextureSize}px）を超えるので縮小した: ${label}（${size.width}×${size.height} → ${fit.width}×${fit.height}）`,
      );
      const scaled = scaleImage(image, fit);
      if (!scaled) return entry;
      source = scaled;
    }
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // canvas（縮小したもの）は乗算して上げる。ImageBitmap にはこの設定が効かない（作ったときの premultiplyAlpha のまま）
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // uv の (0, 0) が画像の左上
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch (e) {
      gl.deleteTexture(texture);
      this.warnOnce(`upload:${label}`, `画像をテクスチャにできないので描かない: ${label}（${String(e)}）`);
      return entry;
    }
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    entry.texture = texture;
    return entry;
  }

  // 背景の四角形と、描ける品目の頂点を1つのバッファにまとめて上げる（索引は品目の先頭の頂点の番号を足して直す）
  private uploadGeometry(gpu: Gpu, items: readonly DrawItem[], backgroundUv: UvRect | null): Prepared[] {
    let vertexCount = 4;
    let indexCount = 6;
    for (const item of items) {
      vertexCount += item.positions.length >> 1;
      indexCount += item.indices.length;
    }
    this.reserve(vertexCount * FLOATS_PER_VERTEX, indexCount);
    const v = this.vertices;
    const ix = this.indices;
    const uv = backgroundUv ?? { u0: 0, v0: 0, u1: 1, v1: 1 };
    // 背景の四角形（クリップ座標）。左上・右上・右下・左下
    v.set([-1, 1, uv.u0, uv.v0, 1, 1, uv.u1, uv.v0, 1, -1, uv.u1, uv.v1, -1, -1, uv.u0, uv.v1], 0);
    ix.set([0, 1, 2, 0, 2, 3], 0);
    let vo = 4;
    let io = 6;
    const prepared: Prepared[] = [];
    for (const item of items) {
      const texture = gpu.textures.get(item.assetId)?.texture;
      if (!texture) continue; // 画像がまだ無い品目は描かない
      const n = Math.min(item.positions.length, item.uvs.length) >> 1;
      const count = item.indices.length - (item.indices.length % 3);
      if (n === 0 || count === 0) continue;
      let valid = true;
      for (let i = 0; i < count; i++) {
        const k = item.indices[i]!;
        if (k >= n) {
          valid = false;
          break;
        }
        ix[io + i] = k + vo;
      }
      if (!valid) {
        this.warnOnce(`indices:${item.partId}`, `頂点の数を超える索引があるので描かない: ${item.partId}`);
        continue;
      }
      const { positions, uvs } = item;
      for (let i = 0, o = vo * FLOATS_PER_VERTEX; i < n; i++, o += FLOATS_PER_VERTEX) {
        v[o] = positions[2 * i]!;
        v[o + 1] = positions[2 * i + 1]!;
        v[o + 2] = uvs[2 * i]!;
        v[o + 3] = uvs[2 * i + 1]!;
      }
      prepared.push({ item, texture, first: io, count, maskKey: item.mask ? maskKey(item.mask.sourcePartIds) : null });
      vo += n;
      io += count;
    }
    const { gl } = gpu;
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.DYNAMIC_DRAW, 0, vo * FLOATS_PER_VERTEX);
    gl.bindVertexArray(gpu.vao);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ix, gl.DYNAMIC_DRAW, 0, io);
    gl.bindVertexArray(null);
    return prepared;
  }

  // マスク元の組ごとに、マスク元のアルファ × 不透明度を最大値で描く（＝範囲の和）。
  // マスク元自身のマスクは掛けない。同じ組はフレームの中で1回だけ作る。マスク元がどれも無い組は入れない（空のマスク）
  private renderMasks(
    gpu: Gpu,
    items: readonly Prepared[],
    clip: { scale: [number, number]; offset: [number, number] },
    buffer: Size,
  ): Map<string, MaskTarget> {
    const result = new Map<string, MaskTarget>();
    const seen = new Set<string>();
    let byPartId: Map<string, Prepared> | null = null;
    let used = 0;
    const { gl } = gpu;
    for (const p of items) {
      const mask = p.item.mask;
      if (!mask || p.maskKey === null || seen.has(p.maskKey)) continue;
      seen.add(p.maskKey);
      if (!byPartId) {
        byPartId = new Map();
        for (const q of items) if (!byPartId.has(q.item.partId)) byPartId.set(q.item.partId, q);
      }
      const sources: Prepared[] = [];
      for (const id of new Set(mask.sourcePartIds)) {
        const s = byPartId.get(id);
        if (s && clamp01(s.item.opacity) > 0) sources.push(s);
      }
      if (sources.length === 0) continue;
      if (used === 0) {
        gl.useProgram(gpu.mask.program);
        gl.bindVertexArray(gpu.vao);
        gl.uniform2f(gpu.mask.scale, clip.scale[0], clip.scale[1]);
        gl.uniform2f(gpu.mask.offset, clip.offset[0], clip.offset[1]);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, gpu.noMask); // 描き込み先のマスクを読み込み側に残さない
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.MAX);
        gl.viewport(0, 0, buffer.width, buffer.height);
        gl.clearColor(0, 0, 0, 0);
      }
      const target = maskTarget(gpu, used++, buffer);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0);
      for (const s of sources) {
        gl.uniform1f(gpu.mask.opacity, clamp01(s.item.opacity));
        gl.bindTexture(gl.TEXTURE_2D, s.texture);
        gl.drawElements(gl.TRIANGLES, s.count, gl.UNSIGNED_INT, s.first * 4);
      }
      result.set(p.maskKey, target);
    }
    if (used > 0) {
      gl.blendEquation(gl.FUNC_ADD);
      gl.bindVertexArray(null);
    }
    return result;
  }

  private reserve(floats: number, indices: number): void {
    if (this.vertices.length < floats) this.vertices = new Float32Array(grow(this.vertices.length, floats));
    if (this.indices.length < indices) this.indices = new Uint32Array(grow(this.indices.length, indices));
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(message);
  }
}

function grow(current: number, needed: number): number {
  let n = Math.max(current, 1024);
  while (n < needed) n *= 2;
  return n;
}

function programInfo(gl: WebGL2RenderingContext, fragment: string): ProgramInfo {
  const program = createProgram(gl, VERTEX_SHADER, fragment);
  return {
    program,
    scale: gl.getUniformLocation(program, 'u_scale'),
    offset: gl.getUniformLocation(program, 'u_offset'),
    opacity: gl.getUniformLocation(program, 'u_opacity'),
    maskMode: gl.getUniformLocation(program, 'u_maskMode'),
  };
}

function setNearest(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

// index 番目のマスクの描き先。描画バッファの大きさが変わったら作り直す
function maskTarget(gpu: Gpu, index: number, size: Size): MaskTarget {
  const { gl } = gpu;
  if (gpu.maskSize.width !== size.width || gpu.maskSize.height !== size.height) {
    for (const m of gpu.masks) deleteMaskTarget(gl, m);
    gpu.masks = [];
    gpu.maskSize = size;
  }
  const existing = gpu.masks[index];
  if (existing) return existing;
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, size.width, size.height);
  setNearest(gl);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const target = { texture, framebuffer };
  gpu.masks[index] = target;
  return target;
}

function deleteMaskTarget(gl: WebGL2RenderingContext, m: MaskTarget): void {
  gl.deleteFramebuffer(m.framebuffer);
  gl.deleteTexture(m.texture);
}

function deleteGpu(gpu: Gpu): void {
  const { gl } = gpu;
  gl.deleteProgram(gpu.draw.program);
  gl.deleteProgram(gpu.mask.program);
  gl.deleteVertexArray(gpu.vao);
  gl.deleteBuffer(gpu.vertexBuffer);
  gl.deleteBuffer(gpu.indexBuffer);
  gl.deleteTexture(gpu.noMask);
  for (const entry of gpu.textures.values()) if (entry.texture) gl.deleteTexture(entry.texture);
  gpu.textures.clear();
  if (gpu.background?.texture) gl.deleteTexture(gpu.background.texture);
  gpu.background = null;
  for (const m of gpu.masks) deleteMaskTarget(gl, m);
  gpu.masks = [];
}

// 上限を超える画像を 2D の canvas で縮める（canvas の中身は乗算済み。アップロードで乗算済みのまま上がる）
function scaleImage(image: ImageBitmap, size: Size): OffscreenCanvas | HTMLCanvasElement | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    drawScaled(ctx, image, size);
    return canvas;
  }
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawScaled(ctx, image, size);
  return canvas;
}

function drawScaled(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  image: ImageBitmap,
  size: Size,
): void {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, size.width, size.height);
}
