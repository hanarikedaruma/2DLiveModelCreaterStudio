import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createDefaultSpeechPreferences, createDefaultVoiceSettings, type SpeechPreferences } from '@app/schema';
import type { SpeechInspection } from '@app/contracts';
import { useDialogs, useDispatch, useEnvironment, useProject, useServices } from '../../../shell/api';
import { lipSyncBinding, setLipSyncCommand } from '../lipsync';
import { setVoiceCommand } from './commands';
import './voice.css';
import { openSpeechInputWindow } from '../../../speechInput/host';
import { useSpeechDraft } from '../../../speechInput/useSpeechDraft';
import { DeliveryPresets } from '../../../speechInput/DeliveryPresets';
import { EmotionButtons } from '../../../speechInput/EmotionButtons';

const DEFAULT = createDefaultVoiceSettings();
const DEFAULT_SPEECH = createDefaultSpeechPreferences();

export function SpeechPanel() {
  const services = useServices();
  const voice = services.voice;
  const state = useSyncExternalStore(voice.subscribe, voice.state);
  const project = useProject();
  const dispatch = useDispatch();
  const dialogs = useDialogs();
  const [env, setEnv] = useEnvironment();
  const settings = project.studio.voice ?? DEFAULT;
  const profile = settings.profile;
  const [inspection, setInspection] = useState<SpeechInspection | null>(null);
  const [draft, setDraft] = useState('');
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [sending, setSending] = useState(false);
  const projectId = useRef(project.id);
  const active = ['loading', 'priming', 'running', 'stopping'].includes(state.state);
  const locked = active || state.converting || sending;
  const speechActive = active && state.source === 'speech';
  const preferences = settings.speech ?? { ...DEFAULT_SPEECH, voice: inspection?.voice ?? DEFAULT_SPEECH.voice };
  const voiceEnv = env.voice ?? { inputDeviceId: null, outputDeviceId: null, inputGainDb: 0, silenceThreshold: -50 };
  const draftMonitor = useSpeechDraft(
    draft,
    !!inspection?.ready,
    JSON.stringify([project.id, preferences, profile]),
    (text, owner, revision) => voice.prepareSpeechDraft(text, preferences, profile, owner, revision),
    (owner) => voice.discardSpeechDraft(owner),
  );

  function notify(error: unknown) {
    dialogs.notify(error instanceof Error ? error.message : String(error));
  }
  async function perform(task: () => Promise<void>) {
    try {
      await task();
    } catch (error) {
      notify(error);
    }
  }
  useEffect(() => {
    let alive = true;
    voice
      .inspectSpeech(profile)
      .then((value) => {
        if (alive) setInspection(value);
      })
      .catch((error: unknown) => {
        if (alive)
          setInspection({
            ready: false,
            reason: error instanceof Error ? error.message : String(error),
            voice: DEFAULT_SPEECH.voice,
            outputs: [],
          });
      });
    return () => {
      alive = false;
    };
  }, [voice, profile.reference]);
  useEffect(() => {
    if (projectId.current === project.id) return;
    projectId.current = project.id;
    setDraft('');
    if (voice.state().speech.history.length) void perform(() => voice.clearSpeechHistory());
  }, [project.id, voice]);

  function change(patch: Partial<SpeechPreferences>) {
    dispatch(setVoiceCommand({ speech: { ...preferences, ...patch } }));
  }
  const canSend = !locked && inspection?.ready && !!voiceEnv.outputDeviceId && !!draft.trim() && draft.length <= 300;
  async function send() {
    if (!canSend) return;
    const text = draftRef.current;
    setSending(true);
    try {
      lipSyncBinding.bind({ audio: services.audio, lipSync: services.lipSync });
      lipSyncBinding.stopMicrophone();
      lipSyncBinding.setSilenceThreshold(voiceEnv.silenceThreshold);
      dispatch(setVoiceCommand({ ...settings, speech: preferences }));
      if (settings.mouthLinked) dispatch(setLipSyncCommand('読み上げに口を合わせる', { mouthSource: 'micOnly' }));
      await voice.speak(text, preferences, profile, voiceEnv);
      if (draftRef.current === text) setDraft('');
    } catch (error) {
      notify(error);
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="studio-section speech-panel">
      <p className="studio-note">入力した言葉をモデルが話します。マイクを使わずに配信できます。</p>
      <button type="button" onClick={() => void perform(openSpeechInputWindow)}>
        別ウィンドウで入力
      </button>
      <div className="voice-status" role="status">
        {speechActive
          ? state.state === 'running'
            ? '読み上げ中'
            : state.state === 'stopping'
              ? '停止しています'
              : state.state === 'priming'
                ? '音声をためています… 次の文章を入力できます'
                : '音声を生成中… 次の文章を入力できます'
          : '文章を入力して読み上げ'}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className="speech-composer">
          <EmotionButtons value={preferences.style} disabled={locked} onChange={(style) => change({ style })} />
          <label className="speech-field speech-compose-field">
            <span>モデルが話す言葉</span>
            <textarea
              value={draft}
              maxLength={300}
              rows={4}
              placeholder="配信で話したいことを入力…"
              onChange={(event) => setDraft(event.target.value)}
              onCompositionStart={draftMonitor.onCompositionStart}
              onCompositionEnd={draftMonitor.onCompositionEnd}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.ctrlKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
          </label>
        </div>
        {preferences.style === 'shy' && (
          <p className="studio-note">母音の言い出しと語尾を息に近づけ、ためらいの間を広げてゆっくり話します。</p>
        )}
        <div className="speech-input-note">
          <span>Ctrl＋Enterで読み上げ / Enterで改行</span>
          <span>{draft.length}/300</span>
        </div>
        <div className="studio-row">
          <button type="submit" className="primary" disabled={!canSend}>
            読み上げ
          </button>
          <button
            type="button"
            disabled={!speechActive || state.state === 'stopping'}
            onClick={() => void perform(() => voice.stop())}
          >
            読み上げを停止
          </button>
          <label className="studio-check">
            <input
              type="checkbox"
              checked={state.mute}
              onChange={(event) => void perform(() => voice.controls({ mute: event.target.checked }))}
            />
            読み上げをミュート
          </label>
        </div>
      </form>
      <p className="studio-note">
        入力を自動で先行合成します。音声は送信後に再生します。
        {state.speech.preparation?.owner === draftMonitor.owner &&
          (state.speech.preparation.state === 'ready'
            ? ' 音声を準備済み'
            : state.speech.preparation.state === 'generating'
              ? ' 先行合成中…'
              : '')}
      </p>
      {active && state.source !== 'speech' && (
        <p className="studio-note">マイクの音声変換を停止すると読み上げを使えます。</p>
      )}
      {state.error && state.source === 'speech' && <p role="alert">{state.error}</p>}
      {inspection && !inspection.ready && <p role="alert">{inspection.reason}</p>}
      <label className="studio-field">
        <span>再生方式</span>
        <select
          value={preferences.delivery ?? 'whole'}
          disabled={locked}
          onChange={(event) => change({ delivery: event.target.value as 'whole' | 'stream' })}
        >
          <option value="whole">全文生成後</option>
          <option value="stream">逐次再生</option>
        </select>
      </label>
      <label className="studio-field">
        <span>読み上げの出力先</span>
        <select
          value={voiceEnv.outputDeviceId ?? ''}
          disabled={locked}
          onChange={(event) => setEnv({ voice: { ...voiceEnv, outputDeviceId: event.target.value || null } })}
        >
          <option value="">出力先を選択</option>
          {voiceEnv.outputDeviceId && !inspection?.outputs.some((device) => device.id === voiceEnv.outputDeviceId) && (
            <option value={voiceEnv.outputDeviceId}>前に使った出力先</option>
          )}
          {inspection?.outputs.map((device) => (
            <option key={device.id} value={device.id}>
              {device.label}
            </option>
          ))}
        </select>
      </label>
      <label className="speech-field">
        <span>場面・話し方</span>
        <textarea
          rows={2}
          maxLength={500}
          disabled={locked}
          value={preferences.scene}
          placeholder="例：落ち込んでいる友人を優しく励ます"
          onChange={(event) => change({ scene: event.target.value })}
        />
      </label>
      <DeliveryPresets disabled={locked} onChange={change} />
      <label className="studio-check">
        <input
          type="checkbox"
          checked={preferences.useContext}
          disabled={locked}
          onChange={(event) => change({ useContext: event.target.checked })}
        />
        直前3件の発話を文脈に使う
      </label>
      <details>
        <summary>声と読み上げの設定</summary>
        <p className="studio-note">
          話者の声は［マイク・音声］で選択中の参照音声に固定します。声質調整・出力フィルタも同じ設定を使います。文章ごとに声を作り直しません。
        </p>
      </details>
      <button
        type="button"
        disabled={locked || !state.speech.resident}
        onClick={() => void perform(() => voice.releaseSpeech())}
      >
        読み上げモデルを解放
      </button>
      <div className="speech-history" role="log" aria-label="モデルの発話履歴">
        {state.speech.history.map((text, index) => (
          <p key={index}>{text}</p>
        ))}
      </div>
      <button
        type="button"
        disabled={locked || !state.speech.history.length}
        onClick={() => void perform(() => voice.clearSpeechHistory())}
      >
        発話履歴をクリア
      </button>
      <p className="studio-note">
        {preferences.delivery === 'stream'
          ? '合成速度に合わせて音声をためてから逐次再生します。'
          : '全文の生成後に再生します。'}
        場面に合う抑揚は試聴して確認できます。文章と発話履歴は保存しません。
      </p>
    </div>
  );
}
