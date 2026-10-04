import { describe, expect, it } from 'vitest';
import type { AudioSource, FrameContext } from '@app/contracts';
import { createEmptyProject, ensureStandardParameters } from '@app/schema';
import { createLipSyncProducer } from './lipSync';

function setup() {
  let send: Parameters<AudioSource['onSamples']>[0] = () => {};
  const producer = createLipSyncProducer({
    audio: {
      onSamples: (f) => {
        send = f;
        return () => {};
      },
    },
    vowels: { estimate: () => ({ closed: 0, a: 0, i: 0.75, u: 0, e: 0.25, o: 0 }) },
  });
  const p = createEmptyProject('母音');
  const project = { ...p, model: ensureStandardParameters(p.model, 'step2') };
  project.model.lipSync.vowels = [
    { vowel: 'i', values: { MouthOpen: 0.3, MouthForm: 0.2, MouthWidth: 1 } },
    { vowel: 'e', values: { MouthOpen: 0.6, MouthForm: 0, MouthWidth: 0.7 } },
  ];
  const ctx: FrameContext = {
    now: 100,
    dt: 16,
    project,
    mixedSoFar: { MouthForm: -0.4 },
    flags: { lipSyncWeight: 1, physicsActive: true },
  };
  for (let time = 0; time <= 100; time += 10) producer.update({ time, rmsDb: -20 });
  send(new Float32Array(960), 48000, 100);
  return { producer, ctx, send };
}

describe('母音と音量の合成', () => {
  it('確率で形を平均し、開きは母音と音量の小さい方、形は音量で重み付けする', () => {
    const { producer, ctx } = setup();
    const layer = producer.produce(ctx);
    expect(layer.values.MouthOpen).toBeCloseTo(0.375);
    expect(layer.values.MouthForm).toBeCloseTo(-0.4 + (0.15 + 0.4) * producer.mouthOpen());
    expect(layer.values.MouthWidth).toBeCloseTo(0.925 * producer.mouthOpen());
    expect(layer.blend).toEqual({ MouthOpen: 'max', MouthForm: 'override', MouthWidth: 'override' });
  });
  it('カメラのみ・アニメーションの抑制を守り、未登録や古い音声は音量だけに戻る', () => {
    const { producer, ctx } = setup();
    producer.configure({ mouthSource: 'cameraOnly', strength: 'standard', silenceThresholdDb: -50 });
    expect(producer.produce(ctx).weight).toBe(0);
    producer.configure({ mouthSource: 'micOnly', strength: 'standard', silenceThresholdDb: -50 });
    expect(producer.produce({ ...ctx, flags: { ...ctx.flags, lipSyncWeight: 0.25 } }).weight).toBe(0.25);
    expect(producer.produce({ ...ctx, now: 201 }).values).toEqual({ MouthOpen: producer.mouthOpen() });
    ctx.project.model.lipSync.vowels = [];
    expect(producer.produce(ctx).values).toEqual({ MouthOpen: producer.mouthOpen() });
  });
  it('停止の無音通知で推定を消し、表情の口の形を残す', () => {
    const { producer, ctx } = setup();
    producer.update({ time: 1100, rmsDb: -Infinity });
    expect(producer.produce({ ...ctx, now: 1100 }).values.MouthForm).toBeUndefined();
    expect(producer.mouthOpen()).toBeLessThan(0.001);
  });
});
