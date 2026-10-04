// 音量のリップシンク（カード37）のスタジオ側。実行部に入れる producer は、つないだ services.lipSync に任せ、
// services.audio の音量（onLevel）を services.lipSync.update に渡す（カード44までは仮実装。本物は @app/audio）。
// 口の動き・カメラの口との関係は project.model.lipSync、無音のしきい値は Environment.silenceThreshold から渡す
import type { AudioLevel, AudioSource, Command, LayerProducer, LipSyncProducer } from '@app/contracts';
import type { LipSync } from '@app/schema';

export type MouthSource = LipSync['mouthSource'];
export type MouthStrength = LipSync['strength'];

export const MOUTH_STRENGTH_CHOICES: readonly { id: MouthStrength; label: string }[] = [
  { id: 'low', label: '控えめ' },
  { id: 'standard', label: '標準' },
  { id: 'high', label: '大きめ' },
];
export const MOUTH_SOURCE_CHOICES: readonly { id: MouthSource; label: string }[] = [
  { id: 'max', label: '大きい方' },
  { id: 'micOnly', label: 'マイクのみ' },
  { id: 'cameraOnly', label: 'カメラのみ' },
];

export const DEFAULT_SILENCE_THRESHOLD_DB = -50; // Environment.silenceThreshold の既定値と同じ
export const LEVEL_NOTIFY_INTERVAL_MS = 50; // 画面に今の音量を知らせる間隔（音量は 10ms ごとに来る）
const STOP_SETTLE_MS = 1000; // 止めたとき、最後の音量からこれだけ無音が続いたことにして口を閉じる

// project.model.lipSync の口の動き・カメラの口との関係を変える（同じなら何もしない）
export function setLipSyncCommand(label: string, patch: Partial<Pick<LipSync, 'mouthSource' | 'strength'>>): Command {
  return {
    label,
    apply(project) {
      const current = project.model.lipSync;
      const next = { ...current, ...patch };
      if (next.mouthSource === current.mouthSource && next.strength === current.strength) return project;
      return { ...project, model: { ...project.model, lipSync: next } };
    },
  };
}

export type MicrophoneStatus = 'stopped' | 'starting' | 'running';
export interface LipSyncState {
  status: MicrophoneStatus;
  level: number | null; // 画面に出す今の音量（dBFS）。止めている間と、まだ届いていないときは null
}

export interface LipSyncTargets {
  audio: AudioSource;
  lipSync: LipSyncProducer;
}

export interface LipSyncBinding {
  readonly producer: LayerProducer; // 実行部に登録する（id 'lipSync'）。つないでいなければ何も出さない
  bind(targets: LipSyncTargets): void; // services.audio・services.lipSync をつなぐ
  bound(): LipSyncTargets | null;
  silenceThreshold(): number;
  setSilenceThreshold(db: number): void; // すぐに services.lipSync へ渡す
  startMicrophone(deviceId?: string | null): Promise<void>; // null・省略なら既定のマイク
  stopMicrophone(): void;
  state(): LipSyncState;
  subscribe(listener: () => void): () => void;
}

type Config = Parameters<LipSyncProducer['configure']>[0];
const sameConfig = (a: Config, b: Config) =>
  a.mouthSource === b.mouthSource && a.strength === b.strength && a.silenceThresholdDb === b.silenceThresholdDb;

export function createLipSyncBinding(): LipSyncBinding {
  let targets: LipSyncTargets | null = null;
  let offLevel: (() => void) | null = null;
  let threshold = DEFAULT_SILENCE_THRESHOLD_DB;
  let settings: Pick<LipSync, 'mouthSource' | 'strength'> | null = null; // 最後のフレームの project.model.lipSync
  let applied: Config | null = null; // 最後に services.lipSync へ渡した設定
  let session: object | null = null; // 今のマイクの開始（止めたり開始し直したりしたら古くなる）
  let lastLevel: AudioLevel | null = null;
  let lastNotified = Number.NEGATIVE_INFINITY;
  let state: LipSyncState = { status: 'stopped', level: null };
  const listeners = new Set<() => void>();

  function setState(patch: Partial<LipSyncState>) {
    const next = { ...state, ...patch };
    if (next.status === state.status && next.level === state.level) return;
    state = next;
    for (const l of [...listeners]) l();
  }

  // 設定が変わったときだけ渡す（project の設定は最初のフレームで分かる）
  function applyConfig() {
    if (!targets || !settings) return;
    const next: Config = {
      mouthSource: settings.mouthSource,
      strength: settings.strength,
      silenceThresholdDb: threshold,
    };
    if (applied && sameConfig(applied, next)) return;
    applied = next;
    targets.lipSync.configure(next);
  }

  function onLevel(level: AudioLevel) {
    targets?.lipSync.update(level);
    lastLevel = level;
    if (!session) return;
    // 画面は 50ms ごとに更新すれば足りる（時刻が戻ったときはすぐ知らせる）
    if (level.time - lastNotified >= LEVEL_NOTIFY_INTERVAL_MS || level.time < lastNotified) {
      lastNotified = level.time;
      setState({ level: level.rmsDb });
    }
  }

  function stopMicrophone() {
    if (!session) return;
    session = null;
    targets?.audio.stop();
    // 口を開いたまま止めないよう、最後の音量から十分たった無音を渡す（戻りのならしで閉じる）
    if (lastLevel) targets?.lipSync.update({ time: lastLevel.time + STOP_SETTLE_MS, rmsDb: Number.NEGATIVE_INFINITY });
    lastLevel = null;
    setState({ status: 'stopped', level: null });
  }

  return {
    producer: {
      id: 'lipSync',
      produce(ctx) {
        if (!targets) return null;
        const { mouthSource, strength } = ctx.project.model.lipSync;
        if (settings?.mouthSource !== mouthSource || settings.strength !== strength)
          settings = { mouthSource, strength };
        applyConfig();
        return targets.lipSync.produce(ctx);
      },
    },
    bind(next) {
      if (targets && next.audio === targets.audio && next.lipSync === targets.lipSync) return;
      if (next.audio !== targets?.audio) {
        stopMicrophone(); // 前のマイクは離す
        offLevel?.();
        offLevel = next.audio.onLevel(onLevel);
      }
      const lipSyncChanged = next.lipSync !== targets?.lipSync;
      targets = { audio: next.audio, lipSync: next.lipSync };
      if (lipSyncChanged) {
        applied = null;
        applyConfig();
      }
    },
    bound: () => targets,
    silenceThreshold: () => threshold,
    setSilenceThreshold(db) {
      if (!Number.isFinite(db) || db === threshold) return;
      threshold = db;
      applyConfig();
    },
    async startMicrophone(deviceId) {
      const audio = targets?.audio;
      if (!audio) throw new Error('マイクがまだつながっていない');
      const mine = {};
      session = mine;
      lastNotified = Number.NEGATIVE_INFINITY;
      setState({ status: 'starting', level: null });
      try {
        await audio.start(deviceId ?? undefined);
      } catch (e) {
        if (session === mine) {
          session = null;
          setState({ status: 'stopped', level: null });
        }
        throw e;
      }
      if (session === mine) setState({ status: 'running' });
    },
    stopMicrophone,
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// アプリで1つ。スタジオの実行部（studioRuntime）に登録し、スタジオの設定のセクションが services をつなぐ
export const lipSyncBinding: LipSyncBinding = createLipSyncBinding();
