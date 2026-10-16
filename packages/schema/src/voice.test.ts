import { describe, expect, it } from 'vitest';
import { createDefaultVoiceSettings, createDefaultSpeechPreferences, voiceSettingsSchema } from './voice';
import { createEmptyProject } from './defaults';
import { loadProjectJson } from './migrate';
import { validateProject } from './validate';

describe('AI音声の保存形式', () => {
  it('恥ずかしいを含む感情の選択を往復保存する', () => {
    const p = createEmptyProject('感情');
    p.studio.voice = { ...createDefaultVoiceSettings(), speech: createDefaultSpeechPreferences() };
    for (const style of ['auto', 'cheerful', 'shy', 'gentle', 'sad', 'surprised', 'whisper'] as const) {
      p.studio.voice.speech!.style = style;
      expect(loadProjectJson(JSON.stringify(p)).studio.voice?.speech?.style).toBe(style);
    }
  });
  it('再生方式を往復保存し、未指定の旧設定も読み込める', () => {
    const p = createEmptyProject('方式');
    p.studio.voice = { ...createDefaultVoiceSettings(), speech: createDefaultSpeechPreferences() };
    expect(loadProjectJson(JSON.stringify(p)).studio.voice?.speech?.delivery).toBeUndefined();
    for (const delivery of ['stream', 'whole'] as const) {
      p.studio.voice.speech!.delivery = delivery;
      expect(loadProjectJson(JSON.stringify(p)).studio.voice?.speech?.delivery).toBe(delivery);
    }
    expect(() =>
      voiceSettingsSchema.parse({ ...p.studio.voice, speech: { ...p.studio.voice.speech, delivery: 'other' } }),
    ).toThrow();
  });
  it('読み方と場面を保存し、下書きや発話履歴はプロジェクトへ含めない', () => {
    const p = createEmptyProject('読み上げ');
    p.studio.voice = {
      ...createDefaultVoiceSettings(),
      speech: { ...createDefaultSpeechPreferences(), scene: '配信の挨拶' },
    };
    expect(loadProjectJson(JSON.stringify(p)).studio.voice?.speech).toEqual(p.studio.voice.speech);
    expect(p.studio.voice.speech).not.toHaveProperty('history');
    expect(p.studio.voice.speech).not.toHaveProperty('text');
  });
  it('声と順序付きフィルタをプロジェクト保存・再読込する', () => {
    const p = createEmptyProject('声付き');
    p.studio.voice = createDefaultVoiceSettings();
    p.studio.voice.profile.outputFilters.items.reverse();
    p.studio.voice.syncOffsetMs = 120;
    expect(loadProjectJson(JSON.stringify(p)).studio.voice).toEqual(p.studio.voice);
  });
  it('旧プロジェクトの口形を保持してAIを開始しない', () => {
    const p = createEmptyProject('旧版');
    p.schemaVersion = 10;
    p.model.lipSync.vowels = [{ vowel: 'a', values: { MouthOpen: 0.8 } }];
    const loaded = loadProjectJson(JSON.stringify(p));
    expect(loaded.schemaVersion).toBe(11);
    expect(loaded.studio.voice).toBeUndefined();
    expect(loaded.model.lipSync).toEqual(p.model.lipSync);
  });
  it('直接加工・不正な参照パス・方式と品質の不一致を拒否する', () => {
    for (const patch of [{ backend: 'signalsmith-waveform' }, { reference: '../../secret.wav' }, { quality: 'hq' }]) {
      const voice = createDefaultVoiceSettings();
      Object.assign(voice.profile, patch);
      expect(() => voiceSettingsSchema.parse(voice)).toThrow();
    }
  });
  it('非有限値・重複ID・8個超のフィルタを保存しない', () => {
    const voice = createDefaultVoiceSettings();
    voice.profile.voiceTone.brightnessDb = Infinity;
    const p = createEmptyProject('不正');
    p.studio.voice = voice;
    expect(() => validateProject(p)).toThrow();
    voice.profile.voiceTone.brightnessDb = 0;
    voice.profile.outputFilters.items.push({ ...voice.profile.outputFilters.items[0]! });
    expect(() => validateProject(p)).toThrow();
    voice.profile.outputFilters.items = Array.from({ length: 9 }, (_, i) => ({
      ...voice.profile.outputFilters.items[0]!,
      id: String(i),
    }));
    expect(() => validateProject(p)).toThrow();
  });
});
