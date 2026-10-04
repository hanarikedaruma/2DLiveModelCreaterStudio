// Spout2 の出力（OutputSink の本物）。Tauri のコマンド（src-tauri/src/output/mod.rs）へバイナリで送る。
// - start: 送信のスレッド・D3D11・共有テクスチャ・送り手（名前は「2D Liver」）を作る。止めずに呼び直すと作り直す
// - setTextures: 素材の PNG。前に送ったものと同じ参照の素材は送らない（変わった・増えた・消えたものだけ）。
//   start で作り直したときは、覚えているものをすべて送り直す
// - submit: fps に合わせて間引き、送っている途中なら最新のフレームだけを残す
// - 背景の画像（ImageBitmap）は、乗算していない RGBA にしてテクスチャとして送る（画像が替わったときだけ）
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { Background, DeformedModel, OutputSink, ViewTransform } from '@app/contracts';
import { isTauri } from '../../platform/tauri';
import { cssColorToRgba } from './color';
import { encodeFrame, encodeTextures, IdTable, type WireBackground, type WireTexture } from './wire';

export const SPOUT_SENDER_NAME = '2D Liver';
export const COMMAND_START = 'spout_start';
export const COMMAND_SET_TEXTURES = 'spout_set_textures';
export const COMMAND_SUBMIT = 'spout_submit';
export const COMMAND_STOP = 'spout_stop';
const MAX_BACKGROUND_SIZE = 4096; // 背景の画像はこの大きさまで縮めて送る

export type Invoke = (command: string, args?: Record<string, unknown> | Uint8Array) => Promise<unknown>;

export interface RawImage {
  width: number;
  height: number;
  data: Uint8Array; // 乗算していない RGBA8
}

export interface SpoutSinkOptions {
  invoke?: Invoke; // テストで差し替える。無ければ Tauri の invoke（Tauri の外では start が失敗する）
  now?: () => number;
  readImage?: (image: ImageBitmap) => RawImage | null; // 背景の画像を RGBA にする
}

export interface SpoutStartResult {
  senderName: string; // 同じ名前の送り手があると「2D Liver_1」などになる
  msaaSamples: number;
}

export interface SpoutSink extends OutputSink {
  running(): boolean;
  started(): SpoutStartResult | null;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function defaultInvoke(): Invoke {
  return (command, args) => {
    if (!isTauri()) return Promise.reject(new Error('Spout2 の出力は Windows のアプリでだけ使える'));
    return tauriInvoke(command, args);
  };
}

// ImageBitmap を乗算していない RGBA にする（大きすぎるものは縮める）
export function readImageWithCanvas(image: ImageBitmap): RawImage | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const k = Math.min(1, MAX_BACKGROUND_SIZE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * k));
  const height = Math.max(1, Math.round(image.height * k));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  return { width, height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

export function createSpoutSink(options: SpoutSinkOptions = {}): SpoutSink {
  const invoke = options.invoke ?? defaultInvoke();
  const now = options.now ?? (() => performance.now());
  const readImage = options.readImage ?? readImageWithCanvas;

  const textureIds = new IdTable(); // assetId → テクスチャの番号
  const partIds = new IdTable();
  let pngs: Record<string, Uint8Array> = {}; // 最後に渡された素材
  const sent = new Map<string, Uint8Array>(); // 送り先にある素材（同じ参照なら送らない）
  let background: { image: ImageBitmap; id: number } | null = null;
  const colors = new Map<string, WireBackground>();

  let started: SpoutStartResult | null = null;
  let attempted = false; // stop していない start がある（Rust の側が動いているかもしれない）
  let generation = 0; // start・stop のたびに増やす（古い送信の結果を捨てる）
  // start・stop・テクスチャの送信は順に行う（start の途中の stop で Rust の側が残らないように）
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(op: () => Promise<T>): Promise<T> {
    const p = queue.then(op, op);
    queue = p.catch(() => {});
    return p;
  }
  let interval = 1000 / 60;
  let nextDue = -Infinity;
  let inFlight = false;
  let pending: Uint8Array | null = null;
  let reported = false;

  function reportOnce(message: string, e: unknown) {
    if (reported) return;
    reported = true;
    console.error(message, errorText(e));
  }

  // 前に送ったものとの差を送る
  async function syncTextures(): Promise<void> {
    const upserts: WireTexture[] = [];
    const removals: number[] = [];
    for (const [assetId, bytes] of Object.entries(pngs)) {
      if (sent.get(assetId) === bytes) continue;
      upserts.push({ id: textureIds.ensure(assetId), kind: 'png', bytes });
      sent.set(assetId, bytes);
    }
    for (const assetId of [...sent.keys()]) {
      if (assetId in pngs) continue;
      sent.delete(assetId);
      const id = textureIds.delete(assetId);
      if (id !== undefined) removals.push(id);
    }
    if (upserts.length === 0 && removals.length === 0) return;
    await sendTextures(upserts, removals);
  }

  async function sendTextures(upserts: WireTexture[], removals: number[]): Promise<void> {
    const warnings = await invoke(COMMAND_SET_TEXTURES, encodeTextures(upserts, removals));
    if (Array.isArray(warnings)) for (const w of warnings) console.warn(`Spout2 の出力: ${String(w)}`);
  }

  // フレームの途中で見つけた背景の画像を、start・stop と順番をそろえて送る
  function sendTexturesNow(upserts: WireTexture[], removals: number[]) {
    const g = generation;
    enqueue(async () => {
      if (g === generation && started) await sendTextures(upserts, removals);
    }).catch((e: unknown) => reportOnce('Spout2 の出力に背景の画像を送れない', e));
  }

  function wireBackground(bg: Background): WireBackground {
    if (bg.type === 'transparent') return { type: 'transparent' };
    if (bg.type === 'color') {
      let wire = colors.get(bg.color);
      if (!wire) {
        wire = { type: 'color', rgba: cssColorToRgba(bg.color) };
        if (colors.size > 64) colors.clear();
        colors.set(bg.color, wire);
      }
      return wire;
    }
    // 画像: 今の背景の画像と違えば送り、前の背景の画像を消す（色や透明に替えても、最後の画像は残しておく）
    if (background?.image !== bg.image) {
      const removals = background ? [background.id] : [];
      const id = textureIds.allocate();
      const raw = readImage(bg.image);
      if (raw) {
        sendTexturesNow([{ id, kind: 'rgba', width: raw.width, height: raw.height, bytes: raw.data }], removals);
      } else {
        console.warn('Spout2 の出力: 背景の画像を読めないので透明にする');
        if (removals.length > 0) sendTexturesNow([], removals);
      }
      background = { image: bg.image, id };
    }
    return { type: 'image', texture: background.id };
  }

  function send(bytes: Uint8Array) {
    if (inFlight) {
      pending = bytes; // 送っている途中なら最新のものだけを残す
      return;
    }
    inFlight = true;
    const g = generation;
    invoke(COMMAND_SUBMIT, bytes)
      .catch((e: unknown) => reportOnce('Spout2 にフレームを送れない', e))
      .finally(() => {
        inFlight = false;
        const next = pending;
        pending = null;
        if (next && g === generation && started) send(next);
      });
  }

  function reset() {
    generation += 1;
    sent.clear();
    background = null;
    pending = null;
    nextDue = -Infinity;
  }

  return {
    start(o) {
      return enqueue(async () => {
        reset();
        started = null;
        attempted = true;
        const result = (await invoke(COMMAND_START, { width: o.width, height: o.height, fps: o.fps })) as
          Partial<SpoutStartResult> | null | undefined;
        started = {
          senderName: typeof result?.senderName === 'string' ? result.senderName : SPOUT_SENDER_NAME,
          msaaSamples: typeof result?.msaaSamples === 'number' ? result.msaaSamples : 1,
        };
        interval = o.fps > 0 ? 1000 / o.fps : 1000 / 60;
        reported = false;
        await syncTextures();
      });
    },
    setTextures(next) {
      pngs = { ...next };
      return enqueue(async () => {
        if (started) await syncTextures();
      });
    },
    submit(model: DeformedModel, view: ViewTransform, bg: Background) {
      if (!started) return;
      // fps に合わせて間引く（表示のリフレッシュレートが高くても決めた fps で送る）
      // 次に送る時刻より少し（2ms）前なら送る。大きく遅れたら（最初も）今から数え直す
      const t = now();
      if (t < nextDue - 2) return;
      nextDue = t - nextDue > interval ? t + interval : nextDue + interval;
      const bytes = encodeFrame(model, view, wireBackground(bg), {
        part: (id) => partIds.ensure(id),
        texture: (assetId) => textureIds.get(assetId),
      });
      send(bytes);
    },
    stop() {
      // 送信をすぐ止め、順番が来たら Rust の側も止める
      reset();
      started = null;
      return enqueue(async () => {
        if (!attempted) return;
        attempted = false;
        started = null;
        await invoke(COMMAND_STOP);
      });
    },
    running: () => started !== null,
    started: () => started,
  };
}
