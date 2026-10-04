import { describe, expect, it } from 'vitest';
import * as mod from './index';

describe('@app/audio', () => {
  it('読み込める', () => {
    expect(mod).toBeTypeOf('object');
  });

  it('マイクの音声とリップシンクを公開する（カード37）', () => {
    expect(mod.createAudioSource).toBeTypeOf('function');
    expect(mod.createLipSyncProducer).toBeTypeOf('function');
    expect(mod.createLevelMeter).toBeTypeOf('function');
    expect(mod.createWorkletCaptureGraph).toBeTypeOf('function');
  });
});
