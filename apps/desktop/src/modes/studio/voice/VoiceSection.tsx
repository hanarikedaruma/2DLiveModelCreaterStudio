import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  createDefaultVoiceSettings,
  newId,
  type VoiceEnvironment,
  type VoiceFilter,
  type VoiceProfile,
} from '@app/schema';
import type { VoiceInspection } from '@app/contracts';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useDialogs, useDispatch, useEditor, useEnvironment, useProject, useServices } from '../../../shell/api';
import { lipSyncBinding, setLipSyncCommand } from '../lipsync';
import { standardVowelsCommand } from '../../modeling/vowels/commands';
import { isTauri } from '../../../platform/tauri';
import { profileWithQuality, setVoiceCommand, type VoiceQualityChoice } from './commands';
import './voice.css';

const DEFAULT = createDefaultVoiceSettings();
const EMPTY_ENV: VoiceEnvironment = {
  inputDeviceId: null,
  outputDeviceId: null,
  inputGainDb: 0,
  silenceThreshold: -50,
};
const STATE_NAMES = {
  unprepared: '準備が必要',
  stopped: '停止中',
  loading: 'モデル準備中',
  priming: '音声を準備中',
  running: '実行中',
  stopping: '停止しています',
  error: '音声エラー',
};
const TABS = ['入出力', '声の調整', '雑音対策', 'フィルタ', '口の動き'] as const;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  change: (x: number) => void;
}) {
  return (
    <label className="voice-slider">
      <span>{props.label}</span>
      <input
        type="range"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.change(Number(e.target.value))}
      />
      <output>
        {props.value.toFixed(props.step && props.step < 1 ? 1 : 0)}
        {props.unit}
      </output>
    </label>
  );
}
export function VoiceSection() {
  const services = useServices();
  const voice = services.voice;
  const state = useSyncExternalStore(voice.subscribe, voice.state);
  const project = useProject();
  const dispatch = useDispatch();
  const dialogs = useDialogs();
  const [env, setEnv] = useEnvironment();
  const [, setEditor] = useEditor();
  const settings = project.studio.voice ?? DEFAULT;
  const profile = settings.profile;
  const voiceEnv = env.voice ?? EMPTY_ENV;
  const [tab, setTab] = useState<(typeof TABS)[number]>('入出力');
  const [inspection, setInspection] = useState<VoiceInspection | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<string | null>(null);
  const [addType, setAddType] = useState<VoiceFilter['type']>('resonance');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [calibration, setCalibration] = useState<'silence' | 'speech' | null>(null);
  const calibrationSamples = useRef<{ noise: number[]; speech: number[] }>({ noise: [], speech: [] });
  const controls = useRef<Partial<Pick<VoiceProfile, 'voiceTone' | 'outputFilters'>> & { inputGainDb?: number }>({});
  const sending = useRef(false);
  const speechActive = state.source === 'speech' && ['loading', 'priming', 'running', 'stopping'].includes(state.state);
  const active = state.source !== 'speech' && ['loading', 'priming', 'running', 'stopping'].includes(state.state);
  const locked = active || speechActive || busy || state.converting;
  const perform = async (task: () => Promise<void>) => {
    try {
      await task();
    } catch (error) {
      dialogs.notify(errorText(error));
    }
  };
  const refresh = async () => {
    try {
      setInspection(await voice.inspect());
    } catch (error) {
      setInspection(null);
      dialogs.notify(errorText(error));
    }
  };
  useEffect(() => {
    let alive = true;
    voice
      .inspect()
      .then((x) => {
        if (alive) setInspection(x);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [voice]);
  useEffect(() => {
    lipSyncBinding.bind({ audio: services.audio, lipSync: services.lipSync });
  }, [services]);
  useEffect(() => {
    setPreview(null);
  }, [profile.reference]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => {
    if (active) lipSyncBinding.setSilenceThreshold(voiceEnv.silenceThreshold);
  }, [active, voiceEnv.silenceThreshold]);
  function setProfile(next: VoiceProfile) {
    dispatch(setVoiceCommand({ profile: next }));
  }
  function updateControls(value: typeof controls.current) {
    Object.assign(controls.current, value);
    if (sending.current) return;
    sending.current = true;
    void (async () => {
      try {
        while (Object.keys(controls.current).length) {
          const next = controls.current;
          controls.current = {};
          await voice.controls(next);
        }
      } catch (error) {
        dialogs.notify(errorText(error));
      } finally {
        sending.current = false;
      }
    })();
  }
  function changeProfile(patch: Partial<VoiceProfile>) {
    const next = { ...profile, ...patch };
    setProfile(next);
    if (active && (patch.voiceTone || patch.outputFilters))
      updateControls({
        ...(patch.voiceTone && { voiceTone: patch.voiceTone }),
        ...(patch.outputFilters && { outputFilters: patch.outputFilters }),
      });
  }
  function changeEnv(patch: Partial<VoiceEnvironment>) {
    setEnv({ voice: { ...voiceEnv, ...patch } });
    if (active && patch.inputGainDb !== undefined) updateControls({ inputGainDb: patch.inputGainDb });
  }
  async function pickFile(title: string, extension: string): Promise<string | null> {
    if (!isTauri()) throw new Error('ファイルの操作はデスクトップアプリで使えます');
    const picked = await open({ title, multiple: false, filters: [{ name: extension, extensions: [extension] }] });
    return typeof picked === 'string' ? picked : null;
  }
  const fileOperation = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };
  function changeFilter(id: string, patch: Partial<VoiceFilter>) {
    changeProfile({
      outputFilters: {
        ...profile.outputFilters,
        items: profile.outputFilters.items.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      },
    });
  }
  function moveFilter(id: string, delta: number) {
    const items = [...profile.outputFilters.items];
    const index = items.findIndex((x) => x.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target]!, items[index]!];
    changeProfile({ outputFilters: { ...profile.outputFilters, items } });
  }
  const currentFilter =
    profile.outputFilters.items.find((x) => x.id === selectedFilter) ?? profile.outputFilters.items[0];
  const currentSpec = inspection?.filters.find((x) => x.type === currentFilter?.type);
  useEffect(() => {
    if (!calibration) return;
    const off = voice.onPlayback((frame) => {
      let power = 0;
      for (const x of frame.samples) power += x * x;
      const db = power > 0 ? 10 * Math.log10(power / frame.samples.length) : -80;
      calibrationSamples.current[calibration === 'silence' ? 'noise' : 'speech'].push(db);
    });
    const timer = setTimeout(() => {
      if (calibration === 'silence') {
        setCalibration('speech');
        return;
      }
      setCalibration(null);
      const { noise, speech } = calibrationSamples.current;
      const sorted = speech.filter((x) => x > -75).sort((a, b) => a - b);
      if (!noise.length || sorted.length < 20) {
        dialogs.notify('普段の声を拾えませんでした。マイクと入力音量を確認して、もう一度試してください');
        return;
      }
      const noiseMax = Math.max(...noise);
      const speaking = sorted[Math.floor(sorted.length * 0.7)]!;
      const threshold = Math.round(Math.max(-75, Math.min(-15, Math.min(speaking - 12, noiseMax + 8))));
      setEnv({ voice: { ...voiceEnv, silenceThreshold: threshold } });
      dialogs.notify(`無音のしきい値を ${threshold} dB にしました。中央の口を見ながら調整できます`);
    }, 3000);
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [calibration, voice, dialogs, setEnv, voiceEnv]);
  useEffect(() => {
    if (!active) setCalibration(null);
  }, [active]);
  const mouth = project.model.parameters.find((p) => p.id === 'MouthOpen');
  const hasMouthBinding = project.model.bindings.some((b) => b.parameterIds.includes('MouthOpen'));
  const hasVowelBindings = project.model.bindings.some((b) =>
    b.parameterIds.some((id) => id === 'MouthForm' || id === 'MouthWidth'),
  );
  return (
    <div className="studio-section voice-section">
      <div className="voice-common">
        <h3>音声・リップシンク</h3>
        <div className="voice-status" role="status">
          {STATE_NAMES[state.state]}
          {state.converting ? ' / WAVを変換中' : ''}
        </div>
        <div className="studio-row">
          <button
            type="button"
            className="primary"
            disabled={
              busy ||
              speechActive ||
              state.state === 'stopping' ||
              state.converting ||
              (!active && (!inspection?.ready || !voiceEnv.inputDeviceId || !voiceEnv.outputDeviceId))
            }
            onClick={() =>
              void perform(async () => {
                if (active) {
                  await voice.stop();
                  return;
                }
                lipSyncBinding.stopMicrophone();
                dispatch(setVoiceCommand(settings));
                if (settings.mouthLinked)
                  dispatch(setLipSyncCommand('音声出力に口を合わせる', { mouthSource: 'micOnly' }));
                await voice.start(profile, voiceEnv);
              })
            }
          >
            {active ? '音声と口の動きを停止' : '音声と口の動きを開始'}
          </button>
          <button
            type="button"
            disabled={!active}
            aria-pressed={state.mute}
            onClick={() => void perform(() => voice.controls({ mute: !state.mute }))}
          >
            Mute
          </button>
          <button
            type="button"
            disabled={!active}
            aria-pressed={state.bypass}
            onClick={() => void perform(() => voice.controls({ bypass: !state.bypass }))}
          >
            元の声を試聴
          </button>
        </div>
        <div className="voice-meters">
          <label>
            入力（調整後）
            <meter
              aria-label="音声の入力レベル"
              min={0}
              max={1}
              value={state.metrics.inputGainPeak ?? state.metrics.inputPeak ?? 0}
            />
          </label>
          <label>
            出力
            <meter min={0} max={1} value={state.metrics.outputPeak ?? 0} />
          </label>
        </div>
        {(state.metrics.inputGainPeak ?? state.metrics.inputPeak ?? 0) >= 1 && (
          <p className="studio-note studio-warn" role="status">
            入力ゲイン調整後の音量が大きすぎます。入力ゲインを下げてください。
          </p>
        )}
        {state.error && (
          <p className="studio-note studio-warn" role="alert">
            {state.error}
          </p>
        )}
      </div>
      <div className="voice-tabs" role="tablist" aria-label="音声の設定">
        {TABS.map((name) => (
          <button type="button" role="tab" key={name} aria-selected={tab === name} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tab}>
        {tab === '入出力' && (
          <>
            <label className="studio-field">
              <span>音声のマイク</span>
              <select
                aria-label="音声のマイク"
                disabled={locked}
                value={voiceEnv.inputDeviceId ?? ''}
                onChange={(e) => changeEnv({ inputDeviceId: e.target.value || null })}
              >
                <option value="">選択してください</option>
                {inspection?.inputs.map((d) => (
                  <option key={d.index} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="studio-field">
              <span>音声の出力先</span>
              <select
                aria-label="音声の出力先"
                disabled={locked}
                value={voiceEnv.outputDeviceId ?? ''}
                onChange={(e) => changeEnv({ outputDeviceId: e.target.value || null })}
              >
                <option value="">選択してください</option>
                {inspection?.outputs.map((d) => (
                  <option key={d.index} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <Slider
              label="音声の入力ゲイン"
              min={-12}
              max={24}
              value={voiceEnv.inputGainDb}
              unit="dB"
              change={(inputGainDb) => changeEnv({ inputGainDb })}
            />
            <div className="studio-row">
              <button type="button" disabled={locked} onClick={() => void refresh()}>
                音声の機器を更新
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  void perform(() =>
                    fileOperation(async () => {
                      const python = await pickFile('音声用Python 3.12のpython.exeを選ぶ', 'exe');
                      if (!python) return;
                      const root = await open({
                        title: 'external/seed-vcのあるモデル保存先',
                        directory: true,
                        multiple: false,
                      });
                      if (typeof root !== 'string') return;
                      await voice.configureRuntime(python, root);
                      await refresh();
                    }),
                  )
                }
              >
                実行環境を設定
              </button>
            </div>
            <p className="studio-note">
              試聴はヘッドホンへ、配信・通話は仮想デバイスの再生側へ出力します。OBSなどでは対応する録音側をマイクに選びます。
            </p>
          </>
        )}
        {tab === '声の調整' && (
          <>
            <label className="studio-field">
              <span>声の名前</span>
              <input
                aria-label="声の名前"
                disabled={locked}
                value={profile.name}
                maxLength={100}
                onChange={(e) => changeProfile({ name: e.target.value || '自分の声' })}
              />
            </label>
            <label className="studio-field">
              <span>AI方式・品質</span>
              <select
                aria-label="AI方式・品質"
                disabled={locked}
                value={profile.quality === 'hq' && profile.advanced?.steps === 30 ? 'hqQuality' : profile.quality}
                onChange={(e) => setProfile(profileWithQuality(profile, e.target.value as VoiceQualityChoice))}
              >
                <option value="fast">Tiny 最速（会話向け）</option>
                <option value="balanced">Tiny バランス（おすすめ）</option>
                <option value="stable">Tiny 安定優先</option>
                <option value="hq">大型AI 標準（20ステップ・待ち時間あり）</option>
                <option value="hqQuality">大型AI 品質優先（30ステップ・待ち時間長め）</option>
              </select>
            </label>
            {profile.quality === 'hq' && (
              <p className="studio-note">大型AIは数秒の遅れがあります。録音WAVでの比較にも使えます。</p>
            )}
            {profile.advanced && (
              <p className="studio-note">
                品質の個別設定を使用中。品質を選び直すと元のVoiceChangerのプリセットに戻ります。
              </p>
            )}
            <Slider
              label="声の明るさ"
              min={-4}
              max={4}
              step={0.1}
              value={profile.voiceTone.brightnessDb}
              unit="dB"
              change={(brightnessDb) => changeProfile({ voiceTone: { ...profile.voiceTone, brightnessDb } })}
            />
            <Slider
              label="声の厚み"
              min={-3}
              max={3}
              step={0.1}
              value={profile.voiceTone.bodyDb}
              unit="dB"
              change={(bodyDb) => changeProfile({ voiceTone: { ...profile.voiceTone, bodyDb } })}
            />
            <Slider
              label="声の柔らかさ"
              min={0}
              max={6}
              step={0.1}
              value={profile.voiceTone.softnessDb}
              unit="dB"
              change={(softnessDb) => changeProfile({ voiceTone: { ...profile.voiceTone, softnessDb } })}
            />
            <Slider
              label="音声の出力ゲイン"
              min={-18}
              max={12}
              value={profile.outputGainDb}
              disabled={locked}
              unit="dB"
              change={(outputGainDb) => changeProfile({ outputGainDb })}
            />
            <div className="studio-row">
              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  void perform(() =>
                    fileOperation(async () => {
                      const path = await pickFile('目標声の参照WAVを選ぶ', 'wav');
                      if (path) changeProfile({ reference: await voice.importReference(path) });
                    }),
                  )
                }
              >
                参照WAVを取り込む
              </button>
              <button type="button" disabled={locked} onClick={() => changeProfile({ reference: 'builtin' })}>
                初期の目標声
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  void perform(() =>
                    fileOperation(async () => {
                      const encoded = await voice.previewReference(profile.reference);
                      const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
                      setPreview(URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })));
                    }),
                  )
                }
              >
                目標声を聴く
              </button>
            </div>
            {preview && !active && <audio aria-label="目標声の試聴" controls src={preview} />}
            <p className="studio-note">
              目標声: {profile.reference === 'builtin' ? '架空の柔らかい日本語女性声' : '取り込んだ参照WAV'}
              。高さや声そのものの個性は目標声で選びます。
            </p>
          </>
        )}
        {tab === '雑音対策' && (
          <>
            <Slider
              label="雑音除去"
              min={0}
              max={100}
              value={profile.inputCleanup.noiseReduction * 100}
              disabled={locked}
              unit="%"
              change={(x) => changeProfile({ inputCleanup: { ...profile.inputCleanup, noiseReduction: x / 100 } })}
            />
            <label className="studio-check">
              <input
                type="checkbox"
                disabled={locked}
                checked={profile.inputCleanup.speechOnly}
                onChange={(e) =>
                  changeProfile({ inputCleanup: { ...profile.inputCleanup, speechOnly: e.target.checked } })
                }
              />
              発話以外の音を遮断
            </label>
            <Slider
              label="声の拾いやすさ"
              min={0}
              max={100}
              value={profile.inputCleanup.speechSensitivity}
              disabled={locked}
              change={(speechSensitivity) =>
                changeProfile({ inputCleanup: { ...profile.inputCleanup, speechSensitivity } })
              }
            />
            <p className="studio-note">
              変更は音声を停止してから行います。小声や語頭が切れるときは拾いやすさを上げて試します。
            </p>
          </>
        )}
        {tab === 'フィルタ' && (
          <>
            <label className="studio-check">
              <input
                type="checkbox"
                checked={profile.outputFilters.enabled}
                onChange={(e) =>
                  changeProfile({ outputFilters: { ...profile.outputFilters, enabled: e.target.checked } })
                }
              />
              フィルタ全体を有効
            </label>
            <ul className="voice-filter-list">
              {profile.outputFilters.items.map((f, i) => (
                <li key={f.id}>
                  <input
                    type="checkbox"
                    aria-label={`${f.name}を有効`}
                    checked={f.enabled}
                    onChange={(e) => changeFilter(f.id, { enabled: e.target.checked })}
                  />
                  <button
                    type="button"
                    aria-pressed={currentFilter?.id === f.id}
                    onClick={() => setSelectedFilter(f.id)}
                  >
                    {f.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`${f.name}を上へ`}
                    disabled={i === 0}
                    onClick={() => moveFilter(f.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`${f.name}を下へ`}
                    disabled={i === profile.outputFilters.items.length - 1}
                    onClick={() => moveFilter(f.id, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`${f.name}を削除`}
                    onClick={() =>
                      changeProfile({
                        outputFilters: {
                          ...profile.outputFilters,
                          items: profile.outputFilters.items.filter((x) => x.id !== f.id),
                        },
                      })
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="studio-row">
              <select
                aria-label="追加するフィルタ"
                value={addType}
                onChange={(e) => setAddType(e.target.value as VoiceFilter['type'])}
              >
                {inspection?.filters.map((s) => (
                  <option key={s.type} value={s.type}>
                    {s.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={profile.outputFilters.items.length >= 8 || !inspection?.filters.length}
                onClick={() => {
                  const spec = inspection?.filters.find((s) => s.type === addType);
                  if (!spec) return;
                  const f: VoiceFilter = {
                    id: newId(),
                    type: spec.type,
                    name: spec.title,
                    enabled: true,
                    params: Object.fromEntries(spec.parameters.map((p) => [p.key, p.default])),
                  };
                  changeProfile({
                    outputFilters: { ...profile.outputFilters, items: [...profile.outputFilters.items, f] },
                  });
                  setSelectedFilter(f.id);
                }}
              >
                フィルタを追加
              </button>
            </div>
            {currentSpec && currentFilter && (
              <div className="voice-filter-settings">
                <p className="studio-note">{currentSpec.description}</p>
                {currentSpec.parameters.map((p) => (
                  <Slider
                    key={p.key}
                    label={p.label}
                    min={p.minimum}
                    max={p.maximum}
                    step={p.maximum <= 10 ? 0.1 : 1}
                    value={currentFilter.params[p.key] ?? p.default}
                    unit={p.unit}
                    change={(x) => changeFilter(currentFilter.id, { params: { ...currentFilter.params, [p.key]: x } })}
                  />
                ))}
              </div>
            )}
            <p className="studio-note">上から順に適用、最大8個。全体OFFは変換済みの声で比較します。</p>
            <div className="studio-row">
              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  void perform(() =>
                    fileOperation(async () => {
                      const path = await pickFile('フィルタ設定を開く', 'json');
                      if (path) changeProfile({ outputFilters: await voice.readFilters(path) });
                    }),
                  )
                }
              >
                フィルタ設定を開く
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  void perform(() =>
                    fileOperation(async () => {
                      const path = await save({
                        title: 'フィルタ設定を別名で保存',
                        defaultPath: 'filters.json',
                        filters: [{ name: 'JSON', extensions: ['json'] }],
                      });
                      if (path) await voice.saveFilters(path, profile.outputFilters);
                    }),
                  )
                }
              >
                フィルタ設定を保存
              </button>
            </div>
          </>
        )}
        {tab === '口の動き' && (
          <>
            <label className="studio-check">
              <input
                type="checkbox"
                checked={settings.mouthLinked}
                onChange={(e) => {
                  dispatch(setVoiceCommand({ mouthLinked: e.target.checked }));
                  if (e.target.checked)
                    dispatch(setLipSyncCommand('音声出力に口を合わせる', { mouthSource: 'micOnly' }));
                }}
              />
              音声出力と口を連動
            </label>
            {!mouth || !hasMouthBinding ? (
              <>
                <p className="studio-note studio-warn">
                  口の開閉の変形がありません。モデリング画面でMouthOpenの動きを作ってから使います。
                </p>
                <button
                  type="button"
                  onClick={() => setEditor({ mode: 'modeling', activeParameterIds: ['MouthOpen'] })}
                >
                  口の開閉を作る
                </button>
              </>
            ) : null}
            <label className="studio-field">
              <span>口の反応</span>
              <select
                aria-label="音声の口の反応"
                value={project.model.lipSync.strength}
                onChange={(e) =>
                  dispatch(
                    setLipSyncCommand('口の反応を変える', { strength: e.target.value as 'low' | 'standard' | 'high' }),
                  )
                }
              >
                <option value="low">控えめ</option>
                <option value="standard">標準</option>
                <option value="high">大きめ</option>
              </select>
            </label>
            <Slider
              label="音声の無音しきい値"
              min={-80}
              max={-10}
              value={voiceEnv.silenceThreshold}
              unit="dB"
              change={(silenceThreshold) => changeEnv({ silenceThreshold })}
            />
            <button
              type="button"
              disabled={state.state !== 'running' || state.mute || calibration !== null}
              onClick={() => {
                calibrationSamples.current = { noise: [], speech: [] };
                setCalibration('silence');
              }}
            >
              口の反応を合わせる
            </button>
            {calibration && (
              <p role="status">
                {calibration === 'silence' ? '3秒間、話さずに待ってください' : '3秒間、普段の声で話してください'}
              </p>
            )}
            <Slider
              label="口の同期微調整"
              min={-300}
              max={300}
              step={10}
              value={settings.syncOffsetMs}
              unit="ms"
              change={(syncOffsetMs) => dispatch(setVoiceCommand({ syncOffsetMs }))}
            />
            <p className="studio-note">
              負の値は口を早め、正の値は遅らせます。早める量は、解析が届く時刻までに限られます。
            </p>
            <p className="studio-note">
              母音の口形: {project.model.lipSync.vowels.length ? '登録済み' : '未登録'}。
              {hasVowelBindings ? '既存の口形を使えます。' : '口の形・幅の変形が無い場合は音量による開閉を使います。'}
            </p>
            <div className="studio-row">
              <button
                type="button"
                disabled={!hasVowelBindings}
                onClick={() =>
                  void perform(async () => {
                    if (
                      project.model.lipSync.vowels.length &&
                      !(await dialogs.confirm('登録した母音を標準の形に置き換えますか？'))
                    )
                      return;
                    dispatch(standardVowelsCommand());
                  })
                }
              >
                標準の母音を設定
              </button>
              <button
                type="button"
                onClick={() =>
                  setEditor({ mode: 'modeling', activeParameterIds: ['MouthOpen', 'MouthForm', 'MouthWidth'] })
                }
              >
                母音の口形を編集
              </button>
            </div>
            <p className="studio-note">
              AIの遅れに合わせて音声の口を優先します。カメラの口との最大値を使うと声より先に口が開く場合があります。
            </p>
          </>
        )}
      </div>
      <div className="voice-file-actions">
        <button
          type="button"
          disabled={locked}
          onClick={() =>
            void perform(() =>
              fileOperation(async () => {
                const path = await pickFile('AI声設定を取り込む', 'json');
                if (path) setProfile(await voice.importProfile(path));
              }),
            )
          }
        >
          声設定を取り込む
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={() =>
            void perform(() =>
              fileOperation(async () => {
                const path = await save({
                  title: '声設定を別名で保存',
                  defaultPath: 'voice.json',
                  filters: [{ name: 'JSON', extensions: ['json'] }],
                });
                if (path) await voice.exportProfile(path, profile);
              }),
            )
          }
        >
          声設定を保存
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={() =>
            void perform(() =>
              fileOperation(async () => {
                const source = await pickFile('比較する録音WAVを選ぶ', 'wav');
                if (!source) return;
                const output = await save({
                  title: '変換WAVの保存先',
                  defaultPath: 'converted.wav',
                  filters: [{ name: 'WAV', extensions: ['wav'] }],
                });
                if (output) await voice.convert(source, output, profile);
              }),
            )
          }
        >
          WAVで比較
        </button>
        {state.converting && (
          <button type="button" onClick={() => void perform(() => voice.stop())}>
            WAV変換を中断
          </button>
        )}
      </div>
      {state.conversionOutput && <p className="studio-note">変換WAVを保存しました: {state.conversionOutput}</p>}
      <details className="voice-diagnostics">
        <summary>音声の計測</summary>
        <p>
          推定内部遅延 {Math.round(state.metrics.estimatedMs ?? 0)}ms / 処理{' '}
          {Math.round(state.metrics.processingMs ?? 0)}ms / GPU {Math.round(state.metrics.vramMiB ?? 0)}MiB
        </p>
        <p>
          不足 {state.metrics.underruns ?? 0} / overflow {state.metrics.overflows ?? 0} / 解析落ち{' '}
          {state.metrics.analysisDrops ?? 0}
        </p>
        <p>
          入力の過大サンプル {state.metrics.inputOverSamples ?? 0} / 出力のピーク抑制{' '}
          {Math.max(state.metrics.outputGainReductionDb ?? 0, state.metrics.outputPeakProtectionDb ?? 0).toFixed(1)} dB
        </p>
        <p>相手側までの通話遅延とは異なります。声・フィルタ・口の設定はプロジェクト保存にも含まれます。</p>
      </details>
    </div>
  );
}
