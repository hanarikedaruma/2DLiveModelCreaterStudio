import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AudioWorkletGlobalScope の代わり（registerProcessor・AudioWorkletProcessor・currentFrame）
interface Posted {
  message: { samples: Float32Array; startFrame: number };
  transfer: Transferable[];
}
interface Processor {
  port: { posted: Posted[] };
  process(inputs: Float32Array[][]): boolean;
}
type ProcessorClass = new (options?: { processorOptions?: { chunkFrames?: unknown } }) => Processor;

const scope = globalThis as unknown as Record<string, unknown>;
const registered = new Map<string, ProcessorClass>();

beforeAll(async () => {
  scope.currentFrame = 0;
  scope.AudioWorkletProcessor = class {
    readonly port = {
      posted: [] as Posted[],
      postMessage(message: Posted['message'], transfer: Transferable[]) {
        this.posted.push({ message, transfer });
      },
    };
  };
  scope.registerProcessor = (name: string, ctor: ProcessorClass) => registered.set(name, ctor);
  await import('./levelWorklet.js');
});

afterAll(() => {
  delete scope.currentFrame;
  delete scope.AudioWorkletProcessor;
  delete scope.registerProcessor;
});

// 128 サンプルずつ process を呼ぶ（currentFrame はそのブロックの先頭）
function feed(processor: Processor, signal: Float32Array | null, blocks: number, startFrame = 0): void {
  for (let b = 0; b < blocks; b++) {
    scope.currentFrame = startFrame + b * 128;
    const input = signal ? [[signal.subarray(b * 128, (b + 1) * 128)]] : [[]];
    expect(processor.process(input)).toBe(true); // 止めない
  }
}

const ramp = (n: number) => Float32Array.from({ length: n }, (_, i) => i / n);

describe('levelWorklet.js（AudioWorklet）', () => {
  it("'level-tap' を登録する", () => {
    expect(registered.has('level-tap')).toBe(true);
  });

  it('chunkFrames ずつまとめて、先頭の通し番号とともにメインスレッドへ送る（バッファは渡す）', () => {
    const Ctor = registered.get('level-tap')!;
    const processor = new Ctor({ processorOptions: { chunkFrames: 480 } });
    const signal = ramp(128 * 15);
    feed(processor, signal, 15, 9600); // 1920 サンプル = 480 × 4
    const { posted } = processor.port;
    expect(posted.map((p) => p.message.startFrame)).toEqual([9600, 10080, 10560, 11040]);
    posted.forEach((p, i) => {
      expect(p.message.samples).toEqual(signal.subarray(i * 480, (i + 1) * 480));
      expect(p.transfer).toEqual([p.message.samples.buffer]);
    });
  });

  it('入力が無いブロックは無音として数える', () => {
    const Ctor = registered.get('level-tap')!;
    const processor = new Ctor({ processorOptions: { chunkFrames: 256 } });
    feed(processor, null, 2);
    expect(processor.port.posted).toHaveLength(1);
    expect(processor.port.posted[0]!.message.samples).toEqual(new Float32Array(256));
  });

  it('chunkFrames が正しくなければ 480 にする', () => {
    const Ctor = registered.get('level-tap')!;
    for (const chunkFrames of [undefined, 0, -1, 2.5, '480']) {
      const processor = new Ctor({ processorOptions: { chunkFrames } });
      feed(processor, ramp(128 * 4), 4);
      expect(processor.port.posted.map((p) => p.message.samples.length)).toEqual([480]);
    }
    const noOptions = new Ctor();
    feed(noOptions, ramp(128 * 4), 4);
    expect(noOptions.port.posted).toHaveLength(1);
  });
});
