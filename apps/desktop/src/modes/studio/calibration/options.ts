// トラッキングの設定のうち Environment に項目の無いもの（カード35）: 目のトラッキングのオン・オフと、
// 動きを「カスタム」にしたときの値。Environment（@app/schema）は変えられないので、この PC の localStorage に覚える
// （保存できない環境では、このセッションの間だけ覚える）
import { TRACKING_PRESETS, type TrackingTuning } from '@app/tracking';

export interface TrackingOptions {
  eyeTracking: boolean;
  custom: TrackingTuning; // Environment.trackingPreset が 'custom' のときに使う値
}

export const TRACKING_OPTIONS_KEY = 'live2d-studio.trackingOptions';

export function defaultTrackingOptions(): TrackingOptions {
  return { eyeTracking: true, custom: { ...TRACKING_PRESETS.standard } };
}

export interface TrackingOptionsStorage {
  read(): string | null;
  write(text: string): void;
}

export function localStorageTrackingOptions(key = TRACKING_OPTIONS_KEY): TrackingOptionsStorage {
  return {
    read() {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write(text) {
      try {
        localStorage.setItem(key, text);
      } catch {
        // 保存できない環境では覚えない
      }
    },
  };
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// 壊れた・足りない項目は既定値で埋める
export function parseTrackingOptions(text: string | null): TrackingOptions {
  const defaults = defaultTrackingOptions();
  if (!text) return defaults;
  try {
    const json = JSON.parse(text) as Partial<Record<keyof TrackingOptions, unknown>> | null;
    if (!json || typeof json !== 'object') return defaults;
    const custom = (json.custom ?? {}) as Partial<Record<keyof TrackingTuning, unknown>>;
    return {
      eyeTracking: typeof json.eyeTracking === 'boolean' ? json.eyeTracking : defaults.eyeTracking,
      custom: {
        minCutoff: isNumber(custom.minCutoff) && custom.minCutoff > 0 ? custom.minCutoff : defaults.custom.minCutoff,
        beta: isNumber(custom.beta) && custom.beta >= 0 ? custom.beta : defaults.custom.beta,
        gain: isNumber(custom.gain) && custom.gain >= 0 ? custom.gain : defaults.custom.gain,
        deadZone: isNumber(custom.deadZone) && custom.deadZone >= 0 ? custom.deadZone : defaults.custom.deadZone,
      },
    };
  } catch {
    return defaults;
  }
}

export interface TrackingOptionsStore {
  get(): TrackingOptions;
  set(patch: Partial<TrackingOptions>): void;
  subscribe(listener: () => void): () => void;
}

// 最初に get したときに読む。set するたびに書く
export function createTrackingOptionsStore(storage: TrackingOptionsStorage): TrackingOptionsStore {
  let options: TrackingOptions | null = null;
  const listeners = new Set<() => void>();
  const current = () => (options ??= parseTrackingOptions(storage.read()));
  return {
    get: current,
    set(patch) {
      const before = current();
      const next = { ...before, ...patch };
      if (next.eyeTracking === before.eyeTracking && next.custom === before.custom) return;
      options = next;
      storage.write(JSON.stringify(next));
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// アプリで1つ
export const trackingOptions: TrackingOptionsStore = createTrackingOptionsStore(localStorageTrackingOptions());
