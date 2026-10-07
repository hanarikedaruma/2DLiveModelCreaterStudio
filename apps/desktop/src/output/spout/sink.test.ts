import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Background, DeformedModel, DrawItem } from '@app/contracts';
import {
  COMMAND_SET_TEXTURES,
  COMMAND_START,
  COMMAND_STOP,
  COMMAND_SUBMIT,
  createSpoutSink,
  type Invoke,
  type RawImage,
} from './sink';
import { FRAME_MAGIC, NO_TEXTURE, TEXTURES_MAGIC } from './wire';

interface Call {
  command: string;
  args: unknown;
}

describe('GPUと送信の状態', () => {
  it('選んだGPUを開始のコマンドへ渡し、Rustで実際に送れた数を読む', async () => {
    const fake = fakeInvoke();
    const sink = createSpoutSink({ invoke: fake.invoke });
    sink.configureAdapter('gpu-1');
    await sink.start({ width: 64, height: 64, fps: 60 });
    expect(fake.calls.find((c) => c.command === COMMAND_START)?.args).toMatchObject({ adapterId: 'gpu-1' });
    await sink.telemetry();
    expect(fake.calls.at(-1)?.command).toBe('spout_status');
  });
});

// 呼ばれたコマンドを記録する invoke。submit は hold で止めておける
function fakeInvoke(options: { failStart?: string } = {}) {
  const calls: Call[] = [];
  let held: (() => void)[] | null = null;
  const invoke: Invoke = (command, args) => {
    calls.push({ command, args });
    if (command === COMMAND_START) {
      if (options.failStart) return Promise.reject(new Error(options.failStart));
      return Promise.resolve({ senderName: '2D Liver', msaaSamples: 4 });
    }
    if (command === COMMAND_SET_TEXTURES) return Promise.resolve([]);
    if (command === COMMAND_SUBMIT && held) {
      const queue = held;
      return new Promise<void>((resolve) => queue.push(resolve));
    }
    return Promise.resolve(null);
  };
  return {
    invoke,
    calls,
    of: (command: string) => calls.filter((c) => c.command === command),
    hold() {
      held = [];
    },
    release() {
      const queue = held ?? [];
      held = null;
      for (const r of queue) r();
    },
  };
}

const u32 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(at, true);
const f32 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset).getFloat32(at, true);

// テクスチャのメッセージの [番号, 種類, バイト数] と、消す番号
function readTextures(bytes: Uint8Array): { upserts: [number, number, number][]; removals: number[] } {
  expect(u32(bytes, 0)).toBe(TEXTURES_MAGIC);
  const n = u32(bytes, 4);
  let at = 8;
  const upserts: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const len = u32(bytes, at + 16);
    upserts.push([u32(bytes, at), u32(bytes, at + 4), len]);
    at += 20 + len + ((4 - (len % 4)) % 4);
  }
  const k = u32(bytes, at);
  const removals = Array.from({ length: k }, (_, i) => u32(bytes, at + 4 + i * 4));
  return { upserts, removals };
}

function item(partId: string, assetId: string): DrawItem {
  return {
    partId,
    assetId,
    positions: new Float32Array([0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    opacity: 1,
    blendMode: 'normal',
    mask: null,
  };
}
const model = (...items: DrawItem[]): DeformedModel => ({
  items,
  byPartId: Object.fromEntries(items.map((i) => [i.partId, i])),
});
const view = { scale: 1, offset: { x: 0, y: 0 } };
// 終わった invoke の後始末（finally・順番待ち）を進める
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createSpoutSink', () => {
  it('start で解像度と fps を渡し、先に渡された素材を送る', async () => {
    const fake = fakeInvoke();
    const sink = createSpoutSink({ invoke: fake.invoke });
    const a = new Uint8Array([1, 2, 3]);
    await sink.setTextures({ a }); // 始める前は覚えるだけ
    expect(fake.calls).toEqual([]);
    await sink.start({ width: 1920, height: 1080, fps: 60 });
    expect(fake.of(COMMAND_START)[0]?.args).toEqual({ width: 1920, height: 1080, fps: 60, adapterId: null });
    expect(sink.running()).toBe(true);
    expect(sink.started()).toEqual({ senderName: '2D Liver', msaaSamples: 4 });
    const sent = fake.of(COMMAND_SET_TEXTURES);
    expect(sent).toHaveLength(1);
    expect(readTextures(sent[0]!.args as Uint8Array)).toEqual({ upserts: [[0, 0, 3]], removals: [] });
  });

  it('素材は変わったもの・増えたものだけを送り、消えたものは番号を消す', async () => {
    const fake = fakeInvoke();
    const sink = createSpoutSink({ invoke: fake.invoke });
    await sink.start({ width: 64, height: 64, fps: 60 });
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2]);
    await sink.setTextures({ a, b });
    await sink.setTextures({ a, b }); // 同じ参照なら送らない
    const b2 = new Uint8Array([3, 4]);
    await sink.setTextures({ b: b2 });
    const messages = fake.of(COMMAND_SET_TEXTURES).map((c) => readTextures(c.args as Uint8Array));
    expect(messages).toEqual([
      {
        upserts: [
          [0, 0, 1],
          [1, 0, 1],
        ],
        removals: [],
      },
      { upserts: [[1, 0, 2]], removals: [0] },
    ]);
  });

  it('作り直したら素材をすべて送り直す', async () => {
    const fake = fakeInvoke();
    const sink = createSpoutSink({ invoke: fake.invoke });
    await sink.setTextures({ a: new Uint8Array([1]) });
    await sink.start({ width: 64, height: 64, fps: 60 });
    await sink.start({ width: 128, height: 64, fps: 30 });
    expect(fake.of(COMMAND_SET_TEXTURES)).toHaveLength(2);
  });

  it('submit はフレームをバイナリで送り、送っていない素材の品目は番号なしにする', async () => {
    const fake = fakeInvoke();
    let now = 0;
    const sink = createSpoutSink({ invoke: fake.invoke, now: () => now });
    sink.submit(model(item('p', 'a')), view, { type: 'transparent' }); // 始める前は送らない
    await sink.setTextures({ a: new Uint8Array([1]) });
    await sink.start({ width: 64, height: 64, fps: 60 });
    now = 100;
    sink.submit(model(item('p', 'a'), item('q', 'missing')), view, { type: 'color', color: '#ff000080' });
    const frames = fake.of(COMMAND_SUBMIT);
    expect(frames).toHaveLength(1);
    const bytes = frames[0]!.args as Uint8Array;
    expect(u32(bytes, 0)).toBe(FRAME_MAGIC);
    expect(u32(bytes, 16)).toBe(1); // 色
    expect([f32(bytes, 20), f32(bytes, 24), f32(bytes, 28)]).toEqual([1, 0, 0]);
    expect(f32(bytes, 32)).toBeCloseTo(128 / 255);
    expect(u32(bytes, 36)).toBe(2); // 品目数
    expect([u32(bytes, 40), u32(bytes, 44)]).toEqual([0, 0]);
    const second = 40 + 16 + 3 * 16 + 3 * 4 + 16;
    expect([u32(bytes, second), u32(bytes, second + 4)]).toEqual([1, NO_TEXTURE]);
  });

  it('fps に合わせて間引く（144Hz の表示でも 60fps で送る）', async () => {
    const fake = fakeInvoke();
    let now = 0;
    const sink = createSpoutSink({ invoke: fake.invoke, now: () => now });
    await sink.start({ width: 64, height: 64, fps: 60 });
    for (let i = 0; i < 144; i++) {
      now = 1000 + (i * 1000) / 144;
      sink.submit(model(), view, { type: 'transparent' });
      await flush();
    }
    const sent = fake.of(COMMAND_SUBMIT).length;
    expect(sent).toBeGreaterThanOrEqual(58);
    expect(sent).toBeLessThanOrEqual(61);
  });

  it('30fps なら 60Hz の表示の半分だけ送る', async () => {
    const fake = fakeInvoke();
    let now = 0;
    const sink = createSpoutSink({ invoke: fake.invoke, now: () => now });
    await sink.start({ width: 64, height: 64, fps: 30 });
    for (let i = 0; i < 60; i++) {
      now = 1000 + (i * 1000) / 60;
      sink.submit(model(), view, { type: 'transparent' });
      await flush();
    }
    expect(fake.of(COMMAND_SUBMIT)).toHaveLength(30);
  });

  it('送っている途中のフレームがあれば、最新のものだけを残して後で送る', async () => {
    const fake = fakeInvoke();
    let now = 0;
    const sink = createSpoutSink({ invoke: fake.invoke, now: () => now });
    await sink.start({ width: 64, height: 64, fps: 60 });
    fake.hold();
    for (let i = 1; i <= 3; i++) {
      now = i * 100;
      sink.submit(model(), { scale: i, offset: { x: 0, y: 0 } }, { type: 'transparent' });
    }
    expect(fake.of(COMMAND_SUBMIT)).toHaveLength(1);
    fake.release();
    await flush();
    const scales = fake.of(COMMAND_SUBMIT).map((c) => f32(c.args as Uint8Array, 4));
    expect(scales).toEqual([1, 3]);
  });

  it('背景の画像は RGBA にして、替わったときだけ送り、前のものを消す', async () => {
    const fake = fakeInvoke();
    let now = 0;
    const read: ImageBitmap[] = [];
    const readImage = (image: ImageBitmap): RawImage => {
      read.push(image);
      return { width: 2, height: 1, data: new Uint8Array(8) };
    };
    const sink = createSpoutSink({ invoke: fake.invoke, now: () => now, readImage });
    await sink.start({ width: 64, height: 64, fps: 60 });
    const first = { width: 2, height: 1 } as ImageBitmap;
    const second = { width: 2, height: 1 } as ImageBitmap;
    const backgrounds: Background[] = [
      { type: 'image', image: first },
      { type: 'image', image: first },
      { type: 'color', color: '#000' }, // 色に替えても最後の画像は残す
      { type: 'image', image: first },
      { type: 'image', image: second },
      { type: 'image', image: first }, // 戻ったら送り直す（消したものを使わない）
    ];
    for (const background of backgrounds) {
      now += 100;
      sink.submit(model(), view, background);
      await flush();
    }
    expect(read).toEqual([first, second, first]);
    const textures = fake.of(COMMAND_SET_TEXTURES).map((c) => readTextures(c.args as Uint8Array));
    expect(textures).toEqual([
      { upserts: [[0, 1, 8]], removals: [] },
      { upserts: [[1, 1, 8]], removals: [0] },
      { upserts: [[2, 1, 8]], removals: [1] },
    ]);
    const sent = fake.of(COMMAND_SUBMIT).map((c) => [u32(c.args as Uint8Array, 16), u32(c.args as Uint8Array, 20)]);
    expect(sent.filter(([type]) => type === 2)).toEqual([
      [2, 0],
      [2, 0],
      [2, 0],
      [2, 1],
      [2, 2],
    ]);
  });

  it('stop のあとは送らない。始めていなければ Rust を呼ばない', async () => {
    const fake = fakeInvoke();
    const sink = createSpoutSink({ invoke: fake.invoke, now: () => 100 });
    await sink.stop();
    expect(fake.calls).toEqual([]);
    await sink.start({ width: 64, height: 64, fps: 60 });
    await sink.stop();
    expect(fake.of(COMMAND_STOP)).toHaveLength(1);
    expect(sink.running()).toBe(false);
    sink.submit(model(), view, { type: 'transparent' });
    expect(fake.of(COMMAND_SUBMIT)).toHaveLength(0);
  });

  it('始めている途中に止めても、始めてから止める（Rust の側を残さない）', async () => {
    const fake = fakeInvoke();
    const sink = createSpoutSink({ invoke: fake.invoke });
    const starting = sink.start({ width: 64, height: 64, fps: 60 });
    const stopping = sink.stop();
    await Promise.all([starting, stopping]);
    expect(fake.calls.map((c) => c.command)).toEqual([COMMAND_START, COMMAND_STOP]);
    expect(sink.running()).toBe(false);
  });

  it('始められなければ start が失敗し、送らない', async () => {
    const fake = fakeInvoke({ failStart: 'D3D11 のデバイスを作れない' });
    const sink = createSpoutSink({ invoke: fake.invoke });
    await expect(sink.start({ width: 64, height: 64, fps: 60 })).rejects.toThrow('D3D11');
    expect(sink.running()).toBe(false);
    sink.submit(model(), view, { type: 'transparent' });
    expect(fake.of(COMMAND_SUBMIT)).toHaveLength(0);
  });

  it('Tauri の外では start が分かる言葉で失敗する', async () => {
    const sink = createSpoutSink();
    await expect(sink.start({ width: 64, height: 64, fps: 60 })).rejects.toThrow('Windows のアプリでだけ');
  });

  it('テクスチャを読めなかった知らせは警告に出す', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const invoke: Invoke = async (command) =>
      command === COMMAND_SET_TEXTURES ? ['テクスチャ 0: PNG を読めない'] : null;
    const sink = createSpoutSink({ invoke });
    await sink.start({ width: 64, height: 64, fps: 60 });
    await sink.setTextures({ a: new Uint8Array([1]) });
    expect(warn).toHaveBeenCalledWith('Spout2 の出力: テクスチャ 0: PNG を読めない');
  });
});
