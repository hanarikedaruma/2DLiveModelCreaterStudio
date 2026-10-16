import type { AudioLevel, AudioSource, FrameContext, Layer, LipSyncProducer, VoiceService } from '@app/contracts';

// AI出力はコールバックのDAC時刻に届く。フレームごとにその時刻の波形だけを流し、
// 推論区間を「最後の母音」1つへ潰さない。
export function createPlaybackAudioRouter(
  microphone: AudioSource,
  voice: VoiceService,
  options: { offsetMs: () => number; linked: () => boolean; now?: () => number },
) {
  const levels = new Set<(level: AudioLevel) => void>();
  const samples = new Set<(samples: Float32Array, rate: number, time: number) => void>();
  const now = options.now ?? (() => performance.now());
  let pending: { samples: Float32Array; rate: number; time: number; sequence: number }[] = [];
  let active = false;
  let lastDelivered = -Infinity;
  let sequence = -1;
  let lastOffset = options.offsetMs();
  let clearMouth = () => {};
  const emitLevel = (x: AudioLevel) => {
    for (const listener of levels) listener(x);
  };
  const emitSamples = (x: Float32Array, rate: number, time: number) => {
    for (const listener of samples) listener(x, rate, time);
  };
  microphone.onLevel((x) => {
    if (!active) emitLevel(x);
  });
  microphone.onSamples((x, r, t) => {
    if (!active) emitSamples(x, r, t);
  });
  voice.onPlayback((frame) => {
    if (!active || !options.linked() || frame.sequence <= sequence) return;
    sequence = frame.sequence;
    const offset = options.offsetMs();
    if (offset !== lastOffset) {
      pending = [];
      clearMouth();
      lastOffset = offset;
    }
    const time = Math.max(frame.time + offset, now() - 20);
    if (now() - time > 150) return;
    pending.push({ samples: frame.samples, rate: frame.sampleRate, time, sequence: frame.sequence });
    pending.sort((a, b) => a.time - b.time);
    if (pending.length > 128) pending = pending.slice(-128);
  });
  voice.subscribe(() => {
    const state = voice.state().state;
    const next = ['loading', 'priming', 'running', 'stopping'].includes(state);
    if (next && !active) {
      microphone.stop();
      pending = [];
      clearMouth();
      lastDelivered = -Infinity;
      sequence = -1;
    }
    if (!next && active) {
      pending = [];
      clearMouth();
      emitLevel({ time: now(), rmsDb: -Infinity });
    }
    active = next;
  });
  const audio: AudioSource = {
    listDevices: () => microphone.listDevices(),
    async start(id) {
      if (active) throw new Error('AI音声を停止してからマイクのみの入力を開始してください');
      await microphone.start(id);
    },
    stop: () => microphone.stop(),
    onLevel(listener) {
      levels.add(listener);
      return () => {
        levels.delete(listener);
      };
    },
    onSamples(listener) {
      samples.add(listener);
      return () => {
        samples.delete(listener);
      };
    },
  };
  function tick(time: number) {
    if (!active) return;
    if (!options.linked()) {
      pending = [];
      clearMouth();
      return;
    }
    while (pending[0] && pending[0].time <= time) {
      const frame = pending.shift()!;
      if (time - frame.time > 150) continue;
      emitSamples(frame.samples, frame.rate, frame.time);
      let power = 0;
      for (const sample of frame.samples) power += sample * sample;
      emitLevel({
        time: frame.time + (frame.samples.length / frame.rate) * 1000,
        rmsDb: power > 0 ? 10 * Math.log10(power / frame.samples.length) : -Infinity,
      });
      lastDelivered = time;
    }
    if (time - lastDelivered > 150) clearMouth();
  }
  function wrap(producer: LipSyncProducer): LipSyncProducer {
    clearMouth = () => producer.reset?.();
    return {
      ...producer,
      produce(ctx: FrameContext): Layer | Layer[] | null {
        if (active && !options.linked()) {
          pending = [];
          clearMouth();
          return null;
        }
        tick(ctx.now);
        return producer.produce(ctx);
      },
    };
  }
  return { audio, wrap, tick, active: () => active };
}
