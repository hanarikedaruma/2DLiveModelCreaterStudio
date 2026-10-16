import { describe, expect, it, vi } from 'vitest';
import { createFakeServices } from '../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../shell/environment';
import { createDefaultSpeechPreferences } from '@app/schema';
import { bindSpeechInput } from './host';
import { REQUEST_EVENT } from './protocol';
import { setVoiceCommand } from '../modes/studio/voice/commands';

const bridge = vi.hoisted(() => ({
  callbacks: new Map<string, (e: { payload: unknown }) => void>(),
  emit: vi.fn(async () => {}),
}));
vi.mock('@tauri-apps/api/event', () => ({
  emitTo: bridge.emit,
  listen: vi.fn(async (name: string, callback: (e: { payload: unknown }) => void) => {
    bridge.callbacks.set(name, callback);
    return () => {};
  }),
  TauriEvent: { WINDOW_DESTROYED: 'tauri://destroyed' },
}));
vi.mock('../platform/tauri', () => ({ isTauri: () => true }));
vi.mock('../modes/studio/lipsync', () => ({
  lipSyncBinding: { bind: vi.fn(), stopMicrophone: vi.fn(), setSilenceThreshold: vi.fn() },
  setLipSyncCommand: vi.fn(),
}));
vi.mock('../modes/studio/runtime', () => ({ studioRuntime: { attach: vi.fn(() => () => {}) } }));

describe('入力ウィンドウのメイン側権限と一回だけの実行', () => {
  it('方式を本体に保存し、古いプロジェクト・別token・重複要求から発話しない', async () => {
    const token = '00000000-0000-4000-8000-000000000001';
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(token);
    const services = createFakeServices();
    services.store.dispatch(setVoiceCommand({ mouthLinked: false }));
    services.voice.inspectSpeech = vi.fn(async () => ({
      ready: true,
      reason: '',
      outputs: [],
      voice: createDefaultSpeechPreferences().voice,
    }));
    services.voice.speak = vi.fn(async () => {});
    const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
    environment.set({ voice: { inputDeviceId: null, outputDeviceId: 'out', inputGainDb: 0, silenceThreshold: -50 } });
    bindSpeechInput(services, environment);
    const receive = bridge.callbacks.get(REQUEST_EVENT)!;
    const projectId = services.store.get().id;
    receive({ payload: { token, id: 'ready', projectId, action: 'ready' } });
    await vi.waitFor(() => expect(bridge.emit).toHaveBeenCalled());
    const preferences = { ...createDefaultSpeechPreferences(), delivery: 'stream' as const };
    receive({ payload: { token, id: 'prefs', projectId, action: 'preferences', preferences } });
    await vi.waitFor(() => expect(services.store.get().studio.voice?.speech?.delivery).toBe('stream'));
    receive({ payload: { token: 'wrong', id: 'wrong', projectId, action: 'speak', text: '送らない' } });
    receive({ payload: { token, id: 'stale', projectId: 'old', action: 'speak', text: '送らない' } });
    await vi.waitFor(() =>
      expect(bridge.emit).toHaveBeenCalledWith(
        'speech-input',
        'studio-speech:response',
        expect.objectContaining({ id: 'stale', error: expect.any(String) }),
      ),
    );
    expect(services.voice.speak).not.toHaveBeenCalled();
    const request = { token, id: 'send-once', projectId, action: 'speak', text: 'こんにちは' };
    receive({ payload: request });
    receive({ payload: request });
    await vi.waitFor(() => expect(services.voice.speak).toHaveBeenCalledTimes(1));
    expect(services.voice.speak).toHaveBeenCalledWith(
      'こんにちは',
      preferences,
      expect.any(Object),
      expect.objectContaining({ inputDeviceId: null, outputDeviceId: 'out' }),
    );
    expect(JSON.stringify(services.store.get())).not.toContain('こんにちは');
    vi.restoreAllMocks();
  });
});
