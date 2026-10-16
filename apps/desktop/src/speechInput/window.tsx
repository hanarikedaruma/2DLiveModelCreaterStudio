import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { SpeechPreferences } from '@app/schema';
import { connectSpeechInput } from './client';
import type { SpeechAction, SpeechSnapshot } from './protocol';
import '../shell/shell.css';
import '../modes/studio/studio.css';
import '../modes/studio/voice/voice.css';
import './window.css';
import { useSpeechDraft } from './useSpeechDraft';
import { DeliveryPresets } from './DeliveryPresets';
import { EmotionButtons } from './EmotionButtons';

function SpeechInputWindow() {
  const [snapshot, setSnapshot] = useState<SpeechSnapshot | null>(null);
  const [draft, setDraft] = useState('');
  const [sceneDraft, setSceneDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [muted, setMuted] = useState<boolean | null>(null);
  const client = useRef<Awaited<ReturnType<typeof connectSpeechInput>> | null>(null);
  const projectId = useRef('');
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    let alive = true;
    void connectSpeechInput((value) => {
      if (!alive) return;
      if (projectId.current && projectId.current !== value.projectId) {
        setDraft('');
        setSceneDraft(null);
        setError('プロジェクトが切り替わりました');
      }
      projectId.current = value.projectId;
      setSnapshot(value);
    })
      .then(async (value) => {
        if (!alive) {
          value.close();
          return;
        }
        client.current = value;
        await value.request({ action: 'ready' });
      })
      .catch((e: unknown) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
      client.current?.close();
      client.current = null;
    };
  }, []);
  async function command(action: SpeechAction) {
    if (!client.current) throw new Error('接続を準備中です');
    await client.current.request(action);
  }
  async function perform(action: SpeechAction) {
    setError('');
    try {
      await command(action);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const state = snapshot?.state;
  const active = !!state && ['loading', 'priming', 'running', 'stopping'].includes(state.state);
  const locked = active || !!state?.converting || pending;
  const canSend = !!snapshot?.inspection?.ready && !!snapshot.environment.outputDeviceId && !locked && !!draft.trim();
  async function send() {
    if (!canSend) return;
    const text = draftRef.current;
    setPending(true);
    setError('');
    try {
      await command({ action: 'speak', text });
      if (draftRef.current === text) setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }
  const prefs = snapshot?.preferences;
  const draftMonitor = useSpeechDraft(
    draft,
    !!snapshot?.inspection?.ready,
    JSON.stringify([snapshot?.projectId, snapshot?.profileKey, prefs]),
    (text, owner, revision) => command({ action: 'draft', text, owner, revision }),
    (owner) => command({ action: 'discardDraft', owner }),
  );
  const change = (patch: Partial<SpeechPreferences>) => {
    if (prefs) void perform({ action: 'preferences', preferences: { ...prefs, ...patch } });
  };
  return (
    <main className="speech-input-window speech-panel">
      <h1>チャット読み上げ</h1>
      <p className="studio-note">{snapshot?.projectName ?? 'スタジオに接続中…'} · 入力した言葉をモデルが話します。</p>
      <p className="studio-note">話者は音声変換の参照音声に固定。声質調整もメインと共通です。</p>
      <div role="status" className="voice-status">
        {state?.source === 'speech' && active
          ? state.state === 'running'
            ? '読み上げ中'
            : state.state === 'priming'
              ? '音声をためています…'
              : state.state === 'stopping'
                ? '停止しています'
                : '音声を生成中…'
          : '文章を入力して読み上げ'}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="speech-composer">
          <EmotionButtons
            value={prefs?.style ?? 'auto'}
            disabled={locked || !prefs}
            onChange={(style) => change({ style })}
          />
          <label className="speech-field speech-compose-field">
            <span>モデルが話す言葉</span>
            <textarea
              autoFocus
              rows={7}
              maxLength={300}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onCompositionStart={draftMonitor.onCompositionStart}
              onCompositionEnd={draftMonitor.onCompositionEnd}
              placeholder="配信で話したいことを入力…"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
          </label>
        </div>
        {prefs?.style === 'shy' && (
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
            disabled={!active || state?.source !== 'speech' || state.state === 'stopping'}
            onClick={() => void perform({ action: 'stop' })}
          >
            読み上げを停止
          </button>
          <label className="studio-check">
            <input
              type="checkbox"
              checked={muted ?? state?.mute ?? false}
              onChange={(e) => {
                const mute = e.target.checked;
                setMuted(mute);
                void perform({ action: 'mute', mute }).finally(() => setMuted(null));
              }}
            />
            読み上げをミュート
          </label>
        </div>
      </form>
      <p className="studio-note">
        入力を自動で先行合成します。音声は送信後に再生します。
        {state?.speech.preparation?.owner === draftMonitor.owner &&
          (state.speech.preparation.state === 'ready'
            ? ' 音声を準備済み'
            : state.speech.preparation.state === 'generating'
              ? ' 先行合成中…'
              : '')}
      </p>
      {(error ||
        state?.error ||
        (snapshot?.inspection && !snapshot.inspection.ready && snapshot.inspection.reason)) && (
        <p role="alert">{error || state?.error || snapshot?.inspection?.reason}</p>
      )}
      {prefs && (
        <>
          <label className="studio-field">
            <span>再生方式</span>
            <select
              disabled={locked}
              value={prefs.delivery ?? 'whole'}
              onChange={(e) => change({ delivery: e.target.value as 'whole' | 'stream' })}
            >
              <option value="whole">全文生成後</option>
              <option value="stream">逐次再生</option>
            </select>
          </label>
          <p className="studio-note">
            {prefs.delivery === 'stream'
              ? '合成速度に合わせて音声をためてから逐次再生します。'
              : '全文の音声を生成してから再生します。'}
          </p>
          <label className="studio-field">
            <span>読み上げの出力先</span>
            <select
              disabled={locked}
              value={snapshot.environment.outputDeviceId ?? ''}
              onChange={(e) => void perform({ action: 'output', outputDeviceId: e.target.value || null })}
            >
              <option value="">出力先を選択</option>
              {snapshot.environment.outputDeviceId &&
                !snapshot.inspection?.outputs.some((d) => d.id === snapshot.environment.outputDeviceId) && (
                  <option value={snapshot.environment.outputDeviceId}>前に使った出力先</option>
                )}
              {snapshot.inspection?.outputs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
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
              value={sceneDraft ?? prefs.scene}
              onChange={(e) => setSceneDraft(e.target.value)}
              onBlur={() => {
                if (sceneDraft !== null) {
                  change({ scene: sceneDraft });
                  setSceneDraft(null);
                }
              }}
            />
          </label>
          <DeliveryPresets
            disabled={locked}
            onChange={(patch) => {
              setSceneDraft(null);
              change(patch);
            }}
          />
          <label className="studio-check">
            <input
              type="checkbox"
              disabled={locked}
              checked={prefs.useContext}
              onChange={(e) => change({ useContext: e.target.checked })}
            />
            直前3件の発話を文脈に使う
          </label>
        </>
      )}
      <div className="speech-history" role="log" aria-label="モデルの発話履歴">
        {state?.speech.history.map((text, index) => (
          <p key={index}>{text}</p>
        ))}
      </div>
      <div className="studio-row">
        <button disabled={locked || !state?.speech.history.length} onClick={() => void perform({ action: 'clear' })}>
          発話履歴をクリア
        </button>
        <button disabled={locked || !state?.speech.resident} onClick={() => void perform({ action: 'release' })}>
          読み上げモデルを解放
        </button>
      </div>
      <p className="studio-note">
        生成中も次の文章を入力できます。このウィンドウを閉じても読み上げは続きます。文章と発話履歴は保存しません。
      </p>
    </main>
  );
}

export function startSpeechInputWindow(root: HTMLElement) {
  createRoot(root).render(<SpeechInputWindow />);
}
