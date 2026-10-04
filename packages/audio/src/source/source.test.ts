import type { AudioLevel } from '@app/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaptureChunkListener, CaptureGraph, CreateCaptureGraph, MediaStreamLike } from './graph';
import { MIN_LEVEL_DB } from './level';
import { type AudioMediaDevicesLike, createAudioSource, microphoneConstraints } from './source';

// ---- 仮のマイク・Web Audio ----

class FakeStream implements MediaStreamLike {
  stopped = 0;
  getTracks(): { stop(): void }[] {
    return [{ stop: () => void this.stopped++ }];
  }
}

class FakeMediaDevices implements AudioMediaDevicesLike {
  readonly requests: MediaStreamConstraints[] = [];
  readonly streams: FakeStream[] = [];
  fail: Error | null = null;
  hold: Promise<void> | null = null; // 置くと getUserMedia を待たせる
  devices = [
    { deviceId: 'cam', kind: 'videoinput', label: 'カメラ' },
    { deviceId: 'mic-a', kind: 'audioinput', label: '内蔵マイク' },
    { deviceId: 'mic-b', kind: 'audioinput', label: '' },
    { deviceId: 'spk', kind: 'audiooutput', label: 'スピーカー' },
  ];

  async enumerateDevices() {
    return this.devices;
  }

  async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamLike> {
    this.requests.push(constraints);
    if (this.hold) await this.hold;
    if (this.fail) throw this.fail;
    const stream = new FakeStream();
    this.streams.push(stream);
    return stream;
  }
}

class FakeGraphs {
  readonly graphs: (CaptureGraph & { closed: number; stream: MediaStreamLike; push: CaptureChunkListener })[] = [];
  fail: Error | null = null;
  sampleRate = 48000;
  readonly create: CreateCaptureGraph = async (stream, onChunk) => {
    if (this.fail) throw this.fail;
    const graph = {
      sampleRate: this.sampleRate,
      closed: 0,
      stream,
      push: onChunk,
      close: () => void graph.closed++,
    };
    this.graphs.push(graph);
    return graph;
  };
  get last() {
    return this.graphs[this.graphs.length - 1]!;
  }
}

// 実効値が db の矩形波（どこで区切っても実効値がちょうど db になる）
const square = (db: number, frames: number) =>
  Float32Array.from({ length: frames }, (_, i) => (i % 2 ? -1 : 1) * 10 ** (db / 20));

function setup() {
  const devices = new FakeMediaDevices();
  const graphs = new FakeGraphs();
  let now = 1000;
  const source = createAudioSource({ mediaDevices: devices, createGraph: graphs.create, clock: () => now });
  const levels: AudioLevel[] = [];
  source.onLevel((l) => levels.push(l));
  return {
    devices,
    graphs,
    source,
    levels,
    setNow: (t: number) => {
      now = t;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('microphoneConstraints', () => {
  it('音声だけ。加工（エコー除去・雑音除去・自動の音量調整）はすべて切る', () => {
    expect(microphoneConstraints()).toEqual({
      video: false,
      audio: { channelCount: { ideal: 1 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    expect(microphoneConstraints('mic-a').audio).toMatchObject({ deviceId: { exact: 'mic-a' } });
  });
});

describe('createAudioSource', () => {
  it('マイクだけを一覧にする。名前が空なら番号で呼ぶ', async () => {
    const { source } = setup();
    expect(await source.listDevices()).toEqual([
      { id: 'mic-a', label: '内蔵マイク' },
      { id: 'mic-b', label: 'マイク 2' },
    ]);
  });

  it('開始すると選んだマイクを開き、10ms ごとに音量（dBFS）を出す', async () => {
    const { source, devices, graphs, levels } = setup();
    await source.start('mic-b');
    expect(devices.requests).toEqual([microphoneConstraints('mic-b')]);
    expect(graphs.last.stream).toBe(devices.streams[0]);

    // AudioWorklet から 10ms（480）ずつ届く。最初に届いた波形の終わりを「いま」（1000ms）とみなす
    graphs.last.push(square(-20, 480), 0);
    graphs.last.push(square(-35, 480), 480);
    graphs.last.push(new Float32Array(480), 960);
    expect(levels).toHaveLength(3);
    expect(levels.map((l) => l.time)).toEqual([1000, 1010, 1020]);
    expect(levels[0]!.rmsDb).toBeCloseTo(-20, 4);
    expect(levels[1]!.rmsDb).toBeCloseTo(-35, 4);
    expect(levels[2]!.rmsDb).toBe(MIN_LEVEL_DB);
  });

  it('届く長さがばらばらでも 10ms ごと。時刻は音声の時計で進める（届いた時刻のずれに左右されない）', async () => {
    const { source, graphs, levels, setNow } = setup();
    await source.start();
    setNow(5000);
    graphs.last.push(square(-30, 128), 48000); // 1秒たってから最初の波形が届いた
    setNow(9999); // あとで届いた時刻は使わない
    for (let start = 48128; start < 48000 + 1280; start += 128) graphs.last.push(square(-30, 128), start);
    expect(levels).toHaveLength(2);
    // 通し番号 48128 が 5000ms。区切りの終わり（48480・48960）の時刻
    expect(levels[0]!.time).toBeCloseTo(5000 + (352 / 48000) * 1000, 6);
    expect(levels[1]!.time).toBeCloseTo(levels[0]!.time + 10, 6);
  });

  it('生の波形も渡す（サンプルレートと先頭の時刻つき）', async () => {
    const { source, graphs } = setup();
    graphs.sampleRate = 44100;
    const received: [Float32Array, number, number][] = [];
    const off = source.onSamples((s, rate, time) => received.push([s, rate, time]));
    await source.start();
    const chunk = square(-20, 441);
    graphs.last.push(chunk, 0);
    graphs.last.push(chunk, 441);
    expect(received).toEqual([
      [chunk, 44100, 990],
      [chunk, 44100, 1000],
    ]);
    off();
    graphs.last.push(chunk, 882);
    expect(received).toHaveLength(2);
  });

  it('止めると Web Audio を閉じてマイクを離す。そのあと届いた波形は使わない', async () => {
    const { source, devices, graphs, levels } = setup();
    await source.start();
    const graph = graphs.last;
    source.stop();
    expect(graph.closed).toBe(1);
    expect(devices.streams[0]!.stopped).toBe(1);
    graph.push(square(-20, 480), 0);
    expect(levels).toHaveLength(0);
    source.stop(); // 2回止めても何もしない
    expect(graph.closed).toBe(1);
  });

  it('開始し直すと前のマイクを離し、音量の区切りと時刻を数え直す', async () => {
    const { source, devices, graphs, levels, setNow } = setup();
    await source.start('mic-a');
    graphs.last.push(square(-20, 300), 0); // 区切りの途中
    const first = graphs.last;
    setNow(2000);
    await source.start('mic-b');
    expect(first.closed).toBe(1);
    expect(devices.streams[0]!.stopped).toBe(1);
    first.push(square(-20, 180), 300); // 古いほうから遅れて届いても使わない
    graphs.last.push(square(-40, 480), 0);
    expect(levels).toEqual([{ time: 2000, rmsDb: expect.closeTo(-40, 4) }]);
  });

  it('マイクを開けなければ失敗を返す', async () => {
    const { source, devices } = setup();
    devices.fail = new Error('NotAllowedError');
    await expect(source.start()).rejects.toThrow('NotAllowedError');
  });

  it('Web Audio を作れなければマイクを離して失敗を返す', async () => {
    const { source, devices, graphs } = setup();
    graphs.fail = new Error('AudioWorklet を読めない');
    await expect(source.start()).rejects.toThrow('AudioWorklet を読めない');
    expect(devices.streams[0]!.stopped).toBe(1);
  });

  it('マイクを開くのを待つ間に止めたら、開けたマイクをすぐ離す（失敗も知らせない）', async () => {
    const { source, devices, graphs } = setup();
    let release!: () => void;
    devices.hold = new Promise((r) => (release = r));
    const starting = source.start();
    source.stop();
    release();
    await starting;
    expect(devices.streams[0]!.stopped).toBe(1);
    expect(graphs.graphs).toHaveLength(0);

    devices.hold = new Promise((r) => (release = r));
    devices.fail = new Error('NotAllowedError');
    const failing = source.start();
    source.stop();
    release();
    await expect(failing).resolves.toBeUndefined();
  });

  it('受け取る処理が例外を出しても、ほかの受け取り先には届く（知らせるのは1回）', async () => {
    const { source, graphs, levels } = setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    source.onLevel(() => {
      throw new Error('壊れた受け取り先');
    });
    const after: AudioLevel[] = [];
    source.onLevel((l) => after.push(l));
    await source.start();
    graphs.last.push(square(-20, 960), 0);
    expect(levels).toHaveLength(2);
    expect(after).toHaveLength(2);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('mediaDevices が無い環境では使えないことを知らせる', async () => {
    const source = createAudioSource({ mediaDevices: undefined });
    const navigator = globalThis.navigator as Navigator | undefined;
    if (navigator?.mediaDevices) return; // Node には無い
    await expect(source.listDevices()).rejects.toThrow('この環境ではマイクを使えない');
    await expect(source.start()).rejects.toThrow('この環境ではマイクを使えない');
  });
});
