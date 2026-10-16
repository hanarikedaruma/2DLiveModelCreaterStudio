import { describe, expect, it, vi } from 'vitest';
import { createDefaultSpeechPreferences, createDefaultVoiceSettings } from '@app/schema';
import { createVoiceService, type VoiceTransport } from './service';

function setup() {
  let receive: (x: Record<string, unknown>) => void = () => {};
  const transport: VoiceTransport = {
    connect: vi.fn(async (listener) => {
      receive = listener;
    }),
    request: vi.fn(async (action) =>
      action === 'clock' ? { hostTimeMs: 1000 } : ['start', 'speak'].includes(action) ? { sessionId: 'current' } : true,
    ),
    configureRuntime: vi.fn(async () => {}),
  };
  const service = createVoiceService({ transport, now: () => 100 });
  return { service, transport, event: (x: Record<string, unknown>) => receive(x) };
}
const environment = { inputDeviceId: 'mic', outputDeviceId: 'out', inputGainDb: 0, silenceThreshold: -50 };
describe('AI音声サービスの状態と時計', () => {
  it('下書きを送っても再生を開始せず、話者と設定を同じ入力へ紐づける', async () => {
    const s = setup();
    const initial = s.service.state();
    await s.service.prepareSpeechDraft(
      '下書き',
      createDefaultSpeechPreferences(),
      createDefaultVoiceSettings().profile,
      'editor',
      7,
    );
    expect(s.transport.request).toHaveBeenCalledWith(
      'prepareSpeechDraft',
      expect.objectContaining({
        text: '下書き',
        owner: 'editor',
        revision: 7,
        profile: createDefaultVoiceSettings().profile,
      }),
    );
    expect(s.service.state()).toBe(initial);
    expect(s.transport.request).not.toHaveBeenCalledWith('speak', expect.anything());
    await s.service.discardSpeechDraft('editor');
    expect(s.transport.request).toHaveBeenCalledWith('discardSpeechDraft', { owner: 'editor' });
  });
  it('逐次再生の無音PCMでバッファ待機表示を再生中へ上書きしない', async () => {
    const s = setup();
    const playback = vi.fn();
    s.service.onPlayback(playback);
    await s.service.speak(
      'こんにちは',
      { ...createDefaultSpeechPreferences(), delivery: 'stream' },
      createDefaultVoiceSettings().profile,
      environment,
    );
    s.event({
      kind: 'status',
      sessionId: 'current',
      source: 'speech',
      state: 'priming',
      speech: { delivery: 'stream', history: [], resident: true },
    });
    s.event({
      kind: 'playback',
      sessionId: 'current',
      sequence: 0,
      pcm: btoa(String.fromCharCode(...new Uint8Array(new Float32Array(480).buffer))),
      playbackTimeMs: 1000,
      sampleRate: 48000,
    });
    expect(playback).toHaveBeenCalledOnce();
    expect(s.service.state().state).toBe('priming');
    s.event({ kind: 'status', sessionId: 'current', source: 'speech', state: 'running' });
    expect(s.service.state().state).toBe('running');
  });
  it('ミュートのチェックを即座に反映し、応答待ちの古い状態通知で戻さない', async () => {
    const s = setup();
    let fail: (error: Error) => void = () => {};
    let controlStarted = false;
    s.transport.request = async (action) => {
      if (action === 'clock') return { hostTimeMs: 1000 };
      if (action === 'controls')
        return new Promise((_, reject) => {
          controlStarted = true;
          fail = reject;
        });
      return true;
    };
    const pending = s.service.controls({ mute: true });
    expect(s.service.state().mute).toBe(true);
    await vi.waitFor(() => expect(controlStarted).toBe(true));
    s.event({ kind: 'status', state: 'stopped', mute: false });
    expect(s.service.state().mute).toBe(true);
    fail(new Error('出力エラー'));
    await expect(pending).rejects.toThrow('出力エラー');
    expect(s.service.state().mute).toBe(false);
  });
  it('読み上げではマイク不要で、文章と指示を分け、出力先だけを渡す', async () => {
    const s = setup();
    const preferences = { ...createDefaultSpeechPreferences(), scene: '友人を優しく励ます' };
    await s.service.speak('そうなんだ。', preferences, createDefaultVoiceSettings().profile, {
      ...environment,
      inputDeviceId: null,
    });
    expect(s.service.state()).toMatchObject({ source: 'speech', state: 'loading', sessionId: 'current' });
    expect(s.transport.request).toHaveBeenCalledWith(
      'speak',
      expect.objectContaining({ text: 'そうなんだ。', preferences, outputDeviceId: 'out' }),
    );
    expect(s.transport.request).not.toHaveBeenCalledWith('start', expect.anything());
    const payload = vi.mocked(s.transport.request).mock.calls.find(([action]) => action === 'speak')![1];
    expect(payload).not.toHaveProperty('inputDeviceId');
  });
  it('文章の空白・上限・実行中の二重送信を拒否する', async () => {
    const s = setup();
    const p = createDefaultVoiceSettings().profile;
    const prefs = createDefaultSpeechPreferences();
    for (const text of [' ', 'あ'.repeat(301), '危険\u0000'])
      await expect(s.service.speak(text, prefs, p, environment)).rejects.toThrow();
    await s.service.speak('こんにちは', prefs, p, environment);
    await expect(s.service.speak('二重送信', prefs, p, environment)).rejects.toThrow('停止');
  });
  it('読み上げ停止後に届いたPCMを捨て、発話履歴だけを保持する', async () => {
    const s = setup();
    const playback = vi.fn();
    s.service.onPlayback(playback);
    await s.service.speak(
      'こんにちは',
      createDefaultSpeechPreferences(),
      createDefaultVoiceSettings().profile,
      environment,
    );
    s.event({
      kind: 'status',
      sessionId: 'current',
      source: 'speech',
      state: 'running',
      speech: { history: ['こんにちは'], resident: true },
    });
    expect(s.service.state().speech.history).toEqual(['こんにちは']);
    await s.service.stop();
    s.event({ kind: 'status', sessionId: 'current', source: 'speech', state: 'running' });
    expect(s.service.state().state).toBe('stopped');
    s.event({ kind: 'playback', sessionId: 'current', sequence: 0, pcm: '', playbackTimeMs: 1000, sampleRate: 48000 });
    expect(playback).not.toHaveBeenCalled();
    await s.service.clearSpeechHistory();
    expect(s.service.state().speech.history).toEqual([]);
    await s.service.releaseSpeech();
    expect(s.service.state().speech.resident).toBe(false);
  });
  it('準備中の停止を開始要求の後に処理し、遅い開始応答を復活させない', async () => {
    const s = setup();
    let finish: (value: unknown) => void = () => {};
    const calls: string[] = [];
    s.transport.request = async (action) => {
      calls.push(action);
      if (action === 'clock') return { hostTimeMs: 1000 };
      if (action === 'start')
        return new Promise((resolve) => {
          finish = resolve;
        });
      return true;
    };
    const starting = s.service.start(createDefaultVoiceSettings().profile, environment);
    await vi.waitFor(() => expect(calls).toContain('start'));
    const stopping = s.service.stop();
    expect(calls).not.toContain('stop');
    finish({ sessionId: 'cancelled' });
    await starting;
    await stopping;
    expect(calls.indexOf('stop')).toBeGreaterThan(calls.indexOf('start'));
    expect(s.service.state().state).toBe('stopped');
    expect(s.service.state().sessionId).toBeNull();
  });
  it('マイクと出力先を指定し、方式を検証してから開始する', async () => {
    const s = setup();
    await expect(
      s.service.start(createDefaultVoiceSettings().profile, { ...environment, inputDeviceId: null }),
    ).rejects.toThrow('選んで');
    expect(s.transport.request).not.toHaveBeenCalled();
    await s.service.start(createDefaultVoiceSettings().profile, environment);
    expect(s.service.state().sessionId).toBe('current');
    expect(s.transport.request).toHaveBeenCalledWith(
      'start',
      expect.objectContaining({ inputDeviceId: 'mic', outputDeviceId: 'out', projectDir: null }),
    );
  });
  it('出力の時計を画面の時計へ写し、古いセッションと重複を捨てる', async () => {
    const s = setup();
    await s.service.start(createDefaultVoiceSettings().profile, environment);
    const playback = vi.fn();
    s.service.onPlayback(playback);
    const pcm = btoa(String.fromCharCode(...new Uint8Array(new Float32Array([0.2, 0.2]).buffer)));
    const frame = { kind: 'playback', sessionId: 'current', sequence: 0, playbackTimeMs: 1000, sampleRate: 48000, pcm };
    s.event({ ...frame, sessionId: 'old' });
    s.event(frame);
    s.event(frame);
    expect(playback).toHaveBeenCalledTimes(1);
    expect(playback.mock.calls[0]![0].time).toBe(100);
    expect(s.service.state().state).toBe('running');
  });
  it('停止でセッションを破棄し、接続の異常を表示する', async () => {
    const s = setup();
    await s.service.start(createDefaultVoiceSettings().profile, environment);
    await s.service.stop();
    expect(s.service.state().sessionId).toBeNull();
    s.event({ kind: 'disconnected', error: 'worker ended' });
    expect(s.service.state().state).toBe('error');
  });
  it('プロジェクトの参照音声を保存先へコピーする', async () => {
    const s = setup();
    s.service.setProjectDirectory('C:/old');
    const profile = createDefaultVoiceSettings().profile;
    profile.reference = 'voice/references/' + 'a'.repeat(64) + '.wav';
    await s.service.persistReferences('C:/new', profile);
    expect(s.transport.request).toHaveBeenCalledWith('persistReferences', {
      sourceDir: 'C:/old',
      targetDir: 'C:/new',
      reference: profile.reference,
    });
  });
  it('WAV変換の完了と中断を声の実行状態から区別する', async () => {
    const s = setup();
    await s.service.convert('input.wav', 'output.wav', createDefaultVoiceSettings().profile);
    expect(s.service.state().converting).toBe(true);
    s.event({ kind: 'converted', output: 'output.wav' });
    expect(s.service.state().converting).toBe(false);
    expect(s.service.state().conversionOutput).toBe('output.wav');
  });
});
