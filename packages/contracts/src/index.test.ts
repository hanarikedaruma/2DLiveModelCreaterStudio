import { describe, expect, it } from 'vitest';
import * as contracts from './index';

describe('@app/contracts の公開', () => {
  it('レイヤーの順番', () => {
    expect(contracts.LAYER_ORDER).toEqual([
      'tracking',
      'bodyFollow',
      'expression',
      'animation',
      'lipSync',
      'periodic',
      'physics',
    ]);
  });

  it('本物の素材の置き場と仮実装を出している', () => {
    expect(contracts.createAssetRepository).toBeTypeOf('function');
    for (const name of [
      'FakeEvaluator',
      'FakePipeline',
      'FakeRenderer',
      'FakeMixer',
      'FakeTrackingSource',
      'FakeTrackingLayer',
      'FakeImporter',
      'MemoryFileSystem',
      'FakeProjectIO',
      'FakeAutoSaver',
      'FakeMeshGenerator',
      'FakeKeyGenerator',
      'FakeAutoSetup',
      'FakeKeyEditor',
      'FakeAudioSource',
      'FakeLipSync',
      'FakeAutoBlink',
      'FakeBodyFollow',
      'FakeExpressions',
      'FakeCalibration',
      'FakeHotkeys',
      'FakeSpout',
      'FakeAnimationPlayer',
      'FakePeriodic',
      'FakePhysics',
      'FakeVowels',
    ] as const) {
      expect(contracts[name], name).toBeTypeOf('function');
    }
  });
});
