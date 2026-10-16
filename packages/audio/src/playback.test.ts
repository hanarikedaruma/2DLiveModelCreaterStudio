import { describe, expect, it, vi } from 'vitest';
import type { AudioSource, VoicePlayback, VoiceService, VoiceState } from '@app/contracts';
import { createPlaybackAudioRouter } from './playback';

function setup() {
  let now = 0;
  let offset = 0;
  let linked = true;
  let playback: (x: VoicePlayback) => void = () => {};
  let changed = () => {};
  let state = { state: 'stopped' } as VoiceState;
  const voice = {
    onPlayback: (listener: typeof playback) => {
      playback = listener;
      return () => {};
    },
    subscribe: (listener: () => void) => {
      changed = listener;
      return () => {};
    },
    state: () => state,
  } as VoiceService;
  const microphone: AudioSource = {
    listDevices: async () => [],
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    onLevel: () => () => {},
    onSamples: () => () => {},
  };
  const router = createPlaybackAudioRouter(microphone, voice, {
    now: () => now,
    offsetMs: () => offset,
    linked: () => linked,
  });
  const sample = vi.fn();
  const level = vi.fn();
  router.audio.onSamples(sample);
  router.audio.onLevel(level);
  const reset = vi.fn();
  router.wrap({ id: 'lipSync', configure: () => {}, update: () => {}, produce: () => null, reset });
  return {
    router,
    sample,
    level,
    reset,
    microphone,
    clock: (time: number) => {
      now = time;
    },
    offset: (x: number) => {
      offset = x;
    },
    linked: (x: boolean) => {
      linked = x;
    },
    state: (next: VoiceState['state']) => {
      state = { state: next } as VoiceState;
      changed();
    },
    frame: (time: number, sequence: number, value = 0.1) =>
      playback({ sessionId: 'test', sequence, time, sampleRate: 48000, samples: new Float32Array(480).fill(value) }),
  };
}
describe('AI出力の再生時刻で口を動かす', () => {
  it('同期補正を変えたときに古い窓を後から再生しない', () => {
    const s = setup();
    s.state('running');
    s.offset(100);
    s.frame(0, 0);
    s.offset(0);
    s.clock(10);
    s.frame(10, 1);
    s.router.tick(10);
    s.router.tick(100);
    expect(s.sample).toHaveBeenCalledTimes(1);
    expect(s.sample.mock.calls[0]![2]).toBe(10);
  });
  it('未来の波形を再生時刻より先に口へ渡さない', () => {
    const s = setup();
    s.state('running');
    s.frame(100, 0);
    s.router.tick(99);
    expect(s.sample).not.toHaveBeenCalled();
    s.clock(100);
    s.router.tick(100);
    expect(s.sample).toHaveBeenCalledTimes(1);
    expect(s.level.mock.calls[0]![0].rmsDb).toBeCloseTo(-20);
  });
  it('180ms区間の18窓を再生順に渡す', () => {
    const s = setup();
    s.state('running');
    for (let i = 0; i < 18; i++) s.frame(i * 10, i);
    for (let t = 0; t < 180; t += 10) {
      s.clock(t);
      s.router.tick(t);
      expect(s.sample).toHaveBeenCalledTimes(t / 10 + 1);
    }
    expect(s.sample.mock.calls.map((c) => c[2])).toEqual(Array.from({ length: 18 }, (_, i) => i * 10));
  });
  it('正の補正で口を遅らせ、大きな先行補正は受信時刻までに制限する', () => {
    const s = setup();
    s.state('running');
    s.offset(200);
    s.frame(0, 0);
    s.router.tick(199);
    expect(s.sample).not.toHaveBeenCalled();
    s.router.tick(200);
    expect(s.sample).toHaveBeenCalledTimes(1);
    s.offset(-300);
    s.clock(210);
    s.frame(210, 1);
    s.router.tick(210);
    expect(s.sample).toHaveBeenCalledTimes(2);
  });
  it('Muteのゼロ波形を無音として渡し、停止で古い窓を捨てる', () => {
    const s = setup();
    s.state('running');
    s.frame(0, 0, 0);
    s.router.tick(0);
    expect(s.level.mock.calls[0]![0].rmsDb).toBe(-Infinity);
    s.frame(100, 1);
    s.state('stopped');
    s.router.tick(200);
    expect(s.sample).toHaveBeenCalledTimes(1);
    expect(s.reset).toHaveBeenCalled();
  });
  it('AI実行中の二重マイク開始を防ぎ、解析切断では口を閉じる', async () => {
    const s = setup();
    s.state('running');
    expect(s.microphone.stop).toHaveBeenCalled();
    await expect(s.router.audio.start()).rejects.toThrow('AI音声');
    s.frame(0, 0);
    s.router.tick(0);
    s.reset.mockClear();
    s.router.tick(160);
    expect(s.reset).toHaveBeenCalled();
  });
});
