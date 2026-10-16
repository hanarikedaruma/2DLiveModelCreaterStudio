import { emitTo, listen, TauriEvent } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { Services } from '@app/contracts';
import { createDefaultSpeechPreferences, createDefaultVoiceSettings, speechPreferencesSchema } from '@app/schema';
import type { EnvironmentStore } from '../shell/environment';
import { isTauri } from '../platform/tauri';
import { lipSyncBinding, setLipSyncCommand } from '../modes/studio/lipsync';
import { setVoiceCommand } from '../modes/studio/voice/commands';
import { studioRuntime } from '../modes/studio/runtime';
import { INPUT_LABEL, REQUEST_EVENT, RESPONSE_EVENT, isSpeechRequest, type SpeechSnapshot } from './protocol';

let openWindow: (() => Promise<void>) | null = null;
let opening: Promise<void> | null = null;

// The child owns only its draft. Project, audio, GPU and lip sync remain in main.
export function bindSpeechInput(services: Services, environment: EnvironmentStore) {
  if (!isTauri()) return;
  const token = crypto.randomUUID();
  let opened = false;
  let inspection: SpeechSnapshot['inspection'] = null;
  let inspectionKey = '';
  let inspectionSerial = 0;
  let detach: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const seen = new Set<string>();
  const draftOwners = new Set<string>();
  const settings = () => services.store.get().studio.voice ?? createDefaultVoiceSettings();
  const preferences = () =>
    settings().speech ?? { ...createDefaultSpeechPreferences(), ...(inspection ? { voice: inspection.voice } : {}) };
  const voiceEnv = () =>
    environment.get().voice ?? { inputDeviceId: null, outputDeviceId: null, inputGainDb: 0, silenceThreshold: -50 };
  const publish = async () => {
    if (!opened) return;
    const project = services.store.get();
    const snapshot: SpeechSnapshot = {
      projectId: project.id,
      projectName: project.name,
      profileKey: JSON.stringify(settings().profile),
      preferences: preferences(),
      environment: voiceEnv(),
      inspection,
      state: services.voice.state(),
    };
    await emitTo(INPUT_LABEL, RESPONSE_EVENT, { token, snapshot });
  };
  const changed = () => {
    if (!opened || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void publish().catch(() => {});
    }, 50);
  };
  const inspect = () => {
    const key = `${services.store.get().id}:${settings().profile.reference}`;
    if (inspectionKey === key) return;
    inspectionKey = key;
    inspection = null;
    const serial = ++inspectionSerial;
    void services.voice
      .inspectSpeech(settings().profile)
      .then((value) => {
        if (serial === inspectionSerial) {
          inspection = value;
          changed();
        }
      })
      .catch((error: unknown) => {
        if (serial !== inspectionSerial) return;
        inspection = {
          ready: false,
          reason: String(error),
          voice: createDefaultSpeechPreferences().voice,
          outputs: [],
        };
        changed();
      });
  };
  const ready = listen<unknown>(REQUEST_EVENT, (event) => {
    if (!isSpeechRequest(event.payload, token)) return;
    const request = event.payload;
    if (seen.has(request.id)) return;
    seen.add(request.id);
    if (seen.size > 64) seen.delete(seen.values().next().value!);
    void (async () => {
      let error: string | undefined;
      try {
        if (request.action === 'ready') {
          opened = true;
          inspect();
          await publish();
        } else {
          if (request.projectId !== services.store.get().id)
            throw new Error('プロジェクトが切り替わりました。文章を確認して再送信してください');
          const state = services.voice.state();
          if (
            ['speak', 'preferences', 'output', 'clear', 'release'].includes(request.action) &&
            (['loading', 'priming', 'running', 'stopping'].includes(state.state) || state.converting)
          )
            throw new Error('実行中の音声を停止してください');
          switch (request.action) {
            case 'draft':
              if (
                typeof request.owner !== 'string' ||
                request.owner.length > 80 ||
                (draftOwners.size >= 8 && !draftOwners.has(request.owner))
              )
                throw new Error('入力の識別子が不正です');
              draftOwners.add(request.owner);
              await services.voice.prepareSpeechDraft(
                request.text,
                preferences(),
                settings().profile,
                request.owner,
                request.revision,
              );
              break;
            case 'discardDraft':
              if (draftOwners.has(request.owner)) {
                await services.voice.discardSpeechDraft(request.owner);
                draftOwners.delete(request.owner);
              }
              break;
            case 'speak': {
              const s = settings();
              const env = voiceEnv();
              lipSyncBinding.bind({ audio: services.audio, lipSync: services.lipSync });
              lipSyncBinding.stopMicrophone();
              lipSyncBinding.setSilenceThreshold(env.silenceThreshold);
              services.store.dispatch(setVoiceCommand({ speech: preferences() }));
              if (s.mouthLinked)
                services.store.dispatch(setLipSyncCommand('読み上げに口を合わせる', { mouthSource: 'micOnly' }));
              await services.voice.speak(request.text, preferences(), s.profile, env);
              break;
            }
            case 'stop':
              await services.voice.stop();
              break;
            case 'mute':
              if (typeof request.mute !== 'boolean') throw new Error('ミュートの設定が不正です');
              await services.voice.controls({ mute: request.mute });
              break;
            case 'preferences':
              services.store.dispatch(setVoiceCommand({ speech: speechPreferencesSchema.parse(request.preferences) }));
              break;
            case 'output':
              if (
                request.outputDeviceId !== null &&
                (typeof request.outputDeviceId !== 'string' || request.outputDeviceId.length > 1000)
              )
                throw new Error('出力先が不正です');
              environment.set({ voice: { ...voiceEnv(), outputDeviceId: request.outputDeviceId } });
              break;
            case 'clear':
              await services.voice.clearSpeechHistory();
              break;
            case 'release':
              await services.voice.releaseSpeech();
              break;
          }
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      await publish();
      await emitTo(INPUT_LABEL, RESPONSE_EVENT, { token, id: request.id, ...(error ? { error } : {}) });
    })().catch(() => {});
  });
  services.voice.subscribe(changed);
  environment.subscribe(changed);
  services.store.subscribe(() => {
    if (opened) inspect();
    changed();
  });
  openWindow = async () => {
    await ready;
    const existing = await WebviewWindow.getByLabel(INPUT_LABEL);
    if (existing) {
      await existing.setFocus();
      await publish();
      return;
    }
    const win = new WebviewWindow(INPUT_LABEL, {
      url: `/speech-input?token=${token}`,
      title: 'チャット読み上げ',
      width: 520,
      height: 740,
      minWidth: 360,
      minHeight: 460,
      resizable: true,
    });
    await new Promise<void>((resolve, reject) => {
      void win.once('tauri://created', () => resolve());
      void win.once('tauri://error', (e) => reject(new Error(String(e.payload))));
    });
    detach ??= studioRuntime.attach(services);
    void win.once(TauriEvent.WINDOW_DESTROYED, () => {
      opened = false;
      for (const owner of draftOwners) void services.voice.discardSpeechDraft(owner).catch(() => {});
      draftOwners.clear();
      detach?.();
      detach = null;
    });
  };
}

export async function openSpeechInputWindow() {
  if (!openWindow) throw new Error('別ウィンドウでの入力はデスクトップアプリで使えます');
  opening ??= openWindow().finally(() => {
    opening = null;
  });
  await opening;
}
