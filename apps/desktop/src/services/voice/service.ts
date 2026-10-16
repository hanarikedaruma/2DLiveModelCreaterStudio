import { Channel, invoke } from '@tauri-apps/api/core';
import {
  voiceProfileSchema,
  voiceFiltersSchema,
  speechPreferencesSchema,
  speechUtteranceSchema,
  DEFAULT_SPEECH_VOICE,
} from '@app/schema';
import type { SpeechInspection, VoiceInspection, VoicePlayback, VoiceService, VoiceState } from '@app/contracts';
import { isTauri } from '../../platform/tauri';

export interface VoiceTransport {
  connect(listener: (value: Record<string, unknown>) => void): Promise<void>;
  request(action: string, payload: Record<string, unknown>): Promise<unknown>;
  configureRuntime(python: string, modelRoot: string): Promise<void>;
}
function nativeTransport(): VoiceTransport {
  let channel: Channel<Record<string, unknown>> | null = null;
  return {
    async connect(listener) {
      if (!isTauri()) throw new Error('AI音声はWindowsのデスクトップアプリで使えます');
      channel = new Channel<Record<string, unknown>>();
      channel.onmessage = listener;
      await invoke('voice_connect', { channel });
    },
    request: (action, payload) => invoke('voice_request', { action, payload }),
    configureRuntime: (python, modelRoot) => invoke('voice_configure_runtime', { python, modelRoot }),
  };
}
export const idleVoiceState = (): VoiceState => ({
  state: 'unprepared',
  sessionId: null,
  error: '',
  mute: false,
  bypass: false,
  metrics: {},
  converting: false,
  conversionOutput: null,
  source: null,
  speech: { history: [], resident: false },
});
const textError = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createVoiceService(
  options: { transport?: VoiceTransport; now?: () => number; beforeStart?: () => void } = {},
): VoiceService {
  const transport = options.transport ?? nativeTransport();
  const now = options.now ?? (() => performance.now());
  let state = idleVoiceState();
  let connection: Promise<void> | null = null;
  let clockOffset = 0;
  let projectDir: string | null = null;
  let generation = 0;
  let stopping = false;
  let previousSequence = -1;
  let connectionEpoch = 0;
  let operations: Promise<void> = Promise.resolve();
  const pendingControls: Partial<Pick<VoiceState, 'mute' | 'bypass'>> = {};
  const controlVersions = { mute: 0, bypass: 0 };
  function serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = operations.then(task);
    operations = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  const subscribers = new Set<() => void>();
  const playbackListeners = new Set<(x: VoicePlayback) => void>();
  const replace = (patch: Partial<VoiceState>) => {
    state = { ...state, ...patch };
    for (const listener of subscribers) listener();
  };
  function event(value: Record<string, unknown>) {
    if (value.kind === 'status') {
      if (stopping) return;
      if (state.sessionId && value.sessionId !== state.sessionId) return;
      const incoming = value.state;
      if (!['stopped', 'loading', 'priming', 'running', 'error'].includes(String(incoming))) return;
      if (!state.sessionId && state.state !== 'loading' && ['loading', 'priming', 'running'].includes(String(incoming)))
        return;
      // Idleホストの最初の通知で、開始要求中の状態を停止へ戻さない。
      if (state.state === 'loading' && !state.sessionId && incoming === 'stopped') return;
      replace({
        state: incoming as VoiceState['state'],
        error: String(value.error ?? ''),
        metrics: (value.metrics ?? {}) as Record<string, number>,
        mute: pendingControls.mute ?? value.mute === true,
        bypass: pendingControls.bypass ?? value.bypass === true,
        ...(value.source === 'microphone' || value.source === 'speech' ? { source: value.source } : {}),
        ...(value.speech && typeof value.speech === 'object' ? { speech: value.speech as VoiceState['speech'] } : {}),
      });
    } else if (value.kind === 'playback') {
      if (
        stopping ||
        !['loading', 'priming', 'running'].includes(state.state) ||
        value.sessionId !== state.sessionId ||
        typeof value.sequence !== 'number' ||
        value.sequence <= previousSequence
      )
        return;
      if (
        typeof value.pcm !== 'string' ||
        value.pcm.length > 16384 ||
        value.sampleRate !== 48000 ||
        typeof value.playbackTimeMs !== 'number' ||
        !Number.isFinite(value.playbackTimeMs)
      )
        return;
      const time = value.playbackTimeMs + clockOffset;
      if (now() - time > 150 || time - now() > 2000) return;
      try {
        const raw = atob(value.pcm);
        if (raw.length % 4 || raw.length > 16384) return;
        const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        const samples = new Float32Array(bytes.buffer);
        if (samples.length === 0 || samples.some((x) => !Number.isFinite(x))) return;
        previousSequence = value.sequence;
        // Streaming sends silent device-clock frames while it buffers. Its
        // authoritative priming/running phase comes from the audio host.
        if (state.state !== 'running' && !(state.source === 'speech' && state.speech.delivery === 'stream'))
          replace({ state: 'running' });
        for (const listener of playbackListeners)
          listener({ sessionId: state.sessionId!, sequence: value.sequence, time, sampleRate: 48000, samples });
      } catch {
        /* 壊れた解析フレームを口の動きに使わない。 */
      }
    } else if (value.kind === 'disconnected') {
      connection = null;
      replace({ state: 'error', sessionId: null, error: String(value.error ?? '音声接続が終了しました') });
    } else if (value.kind === 'converted')
      replace({ converting: false, conversionOutput: String(value.output), error: '' });
    else if (value.kind === 'conversionError') replace({ converting: false, error: String(value.error) });
    else if (value.kind === 'conversionCancelled') replace({ converting: false, error: '', conversionOutput: null });
  }
  async function connect() {
    const epoch = connection ? connectionEpoch : ++connectionEpoch;
    connection ??= transport
      .connect((value) => {
        if (epoch === connectionEpoch) event(value);
      })
      .then(async () => {
        let best = Infinity;
        for (let i = 0; i < 3; i++) {
          const begin = now();
          const result = (await transport.request('clock', {})) as { hostTimeMs: number };
          const end = now();
          if (!Number.isFinite(result.hostTimeMs)) throw new Error('音声の時計を確認できません');
          if (end - begin < best) {
            best = end - begin;
            clockOffset = (begin + end) / 2 - result.hostTimeMs;
          }
        }
      })
      .catch((error: unknown) => {
        connection = null;
        replace({ state: 'unprepared', error: textError(error) });
        throw error;
      });
    await connection;
  }
  const request = async <T>(action: string, payload: Record<string, unknown> = {}): Promise<T> => {
    await connect();
    return (await transport.request(action, payload)) as T;
  };
  async function stop() {
    generation++;
    stopping = true;
    if (state.sessionId || ['loading', 'priming', 'running'].includes(state.state) || state.converting)
      replace({ state: 'stopping' });
    try {
      if (connection) await serialize(() => request('stop'));
      replace({ state: 'stopped', sessionId: null, bypass: false, converting: false });
    } catch (error) {
      replace({ state: 'error', sessionId: null, error: textError(error) });
      throw error;
    } finally {
      stopping = false;
      previousSequence = -1;
    }
  }
  return {
    state: () => state,
    subscribe(listener) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    onPlayback(listener) {
      playbackListeners.add(listener);
      return () => {
        playbackListeners.delete(listener);
      };
    },
    async inspect() {
      const result = await request<VoiceInspection>('inspect');
      if (!state.sessionId && state.source !== 'speech')
        replace({ state: result.ready ? 'stopped' : 'unprepared', error: result.reason });
      return result;
    },
    inspectSpeech: (profile) => request<SpeechInspection>('inspectSpeech', { profile, projectDir }),
    async prepareSpeechDraft(text, preferences, profile, owner, revision) {
      if (
        state.converting ||
        (['loading', 'priming', 'running', 'stopping'].includes(state.state) && state.source !== 'speech')
      )
        return;
      if (text.trim()) speechUtteranceSchema.parse(text);
      await request('prepareSpeechDraft', {
        text,
        preferences: speechPreferencesSchema.parse(preferences),
        profile: voiceProfileSchema.parse(profile),
        owner,
        revision,
        projectDir,
      });
    },
    async discardSpeechDraft(owner) {
      await request('discardSpeechDraft', { owner });
    },
    async speak(text, preferences, profile, environment) {
      if (['loading', 'priming', 'running', 'stopping'].includes(state.state) || state.converting)
        throw new Error('実行中の音声を停止してから読み上げてください');
      if (!environment.outputDeviceId) throw new Error('読み上げの出力先を選んでください');
      text = speechUtteranceSchema.parse(text);
      preferences = speechPreferencesSchema.parse(preferences);
      voiceProfileSchema.parse(profile);
      options.beforeStart?.();
      const mine = ++generation;
      previousSequence = -1;
      replace({ state: 'loading', source: 'speech', sessionId: null, error: '', bypass: false, metrics: {} });
      try {
        const result = await serialize(() =>
          request<{ sessionId: string }>('speak', {
            text,
            preferences,
            profile,
            projectDir,
            outputDeviceId: environment.outputDeviceId,
            mute: state.mute,
          }),
        );
        if (mine === generation) replace({ sessionId: result.sessionId });
      } catch (error) {
        if (mine === generation) replace({ state: 'error', sessionId: null, error: textError(error) });
        throw error;
      }
    },
    async clearSpeechHistory() {
      await serialize(() => request('clearSpeechHistory'));
      replace({ speech: { ...state.speech, history: [] } });
    },
    async releaseSpeech() {
      await serialize(() => request('releaseSpeech'));
      replace({ speech: { ...state.speech, resident: false } });
    },
    async configureRuntime(python, modelRoot) {
      await stop();
      connectionEpoch++;
      connection = null;
      await transport.configureRuntime(python, modelRoot);
      await connect();
    },
    async start(profile, environment) {
      if (['loading', 'priming', 'running', 'stopping'].includes(state.state))
        throw new Error('音声はすでに実行中です');
      if (!environment.inputDeviceId || !environment.outputDeviceId) throw new Error('マイクと出力先を選んでください');
      voiceProfileSchema.parse(profile);
      options.beforeStart?.();
      const mine = ++generation;
      previousSequence = -1;
      replace({
        state: 'loading',
        source: 'microphone',
        sessionId: null,
        error: '',
        bypass: false,
        metrics: {},
        speech: { ...state.speech, resident: false },
      });
      try {
        const result = await serialize(() =>
          request<{ sessionId: string }>('start', {
            profile,
            projectDir,
            ...environment,
            mute: state.mute,
          }),
        );
        if (mine !== generation) return;
        replace({ sessionId: result.sessionId });
      } catch (error) {
        if (mine === generation) replace({ state: 'error', sessionId: null, error: textError(error) });
        throw error;
      }
    },
    stop,
    async controls(value) {
      const before = { mute: state.mute, bypass: state.bypass };
      const versions: Partial<typeof controlVersions> = {};
      for (const key of ['mute', 'bypass'] as const)
        if (value[key] !== undefined) {
          versions[key] = ++controlVersions[key];
          pendingControls[key] = value[key];
        }
      replace(pendingControls);
      try {
        await serialize(() => request('controls', value));
      } catch (error) {
        const rollback: Partial<VoiceState> = {};
        for (const key of ['mute', 'bypass'] as const)
          if (versions[key] !== undefined && controlVersions[key] === versions[key]) rollback[key] = before[key];
        replace(rollback);
        throw error;
      } finally {
        for (const key of ['mute', 'bypass'] as const)
          if (versions[key] !== undefined && controlVersions[key] === versions[key]) delete pendingControls[key];
      }
    },
    setProjectDirectory(dir) {
      projectDir = dir;
    },
    async persistReferences(targetDir, profile) {
      if (profile.reference !== 'builtin')
        await request('persistReferences', { targetDir, sourceDir: projectDir, reference: profile.reference });
    },
    importReference: (path) => request<string>('importReference', { path }),
    previewReference: (reference) => request<string>('previewReference', { reference, projectDir }),
    async importProfile(path) {
      return voiceProfileSchema.parse(await request('importProfile', { path }));
    },
    async exportProfile(path, profile) {
      await request('exportProfile', { path, profile, projectDir });
    },
    async readFilters(path) {
      return voiceFiltersSchema.parse(await request('readFilters', { path }));
    },
    async saveFilters(path, filters) {
      await request('saveFilters', { path, filters });
    },
    async convert(source, output, profile) {
      replace({ converting: true, conversionOutput: null, error: '' });
      try {
        await request('convert', { source, output, profile, projectDir });
      } catch (error) {
        replace({ converting: false, error: textError(error) });
        throw error;
      }
    },
  };
}

// 画面テストでは機器やGPUを開かず、サービス境界で差し替える。
export function createFakeVoiceService(): VoiceService {
  const transport: VoiceTransport = {
    connect: async () => {},
    request: async (action) => {
      if (action === 'clock') return { hostTimeMs: performance.now() };
      if (action === 'inspect')
        return { ready: false, reason: 'AI音声の準備が必要です', modelRoot: '', inputs: [], outputs: [], filters: [] };
      if (action === 'inspectSpeech')
        return { ready: false, reason: '読み上げモデルの準備が必要です', voice: DEFAULT_SPEECH_VOICE, outputs: [] };
      return true;
    },
    configureRuntime: async () => {},
  };
  return createVoiceService({ transport });
}
