// PC ごとの設定（environment.json）。プロジェクトの外に保存する
import { createDefaultEnvironment, validateEnvironment, type Environment } from '@app/schema';
import type { FileSystem } from '@app/contracts';

export interface EnvironmentStorage {
  read(): Promise<string | null>; // 無ければ null
  write(text: string): Promise<void>;
}

// dir/environment.json に読み書きする
export function fileEnvironmentStorage(fs: FileSystem, dir: string): EnvironmentStorage {
  const path = `${dir.replace(/\/+$/, '')}/environment.json`;
  return {
    async read() {
      return (await fs.exists(path)) ? fs.readText(path) : null;
    },
    async write(text) {
      await fs.mkdir(dir);
      await fs.writeText(path, text);
    },
  };
}

// Tauri の外（ブラウザでの開発）で使う
export function localStorageEnvironmentStorage(key = 'live2d-studio.environment'): EnvironmentStorage {
  return {
    async read() {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    async write(text) {
      try {
        localStorage.setItem(key, text);
      } catch {
        // 保存できない環境では覚えない
      }
    },
  };
}

export function memoryEnvironmentStorage(initial: string | null = null): EnvironmentStorage & { text: string | null } {
  const storage = {
    text: initial,
    async read() {
      return storage.text;
    },
    async write(text: string) {
      storage.text = text;
    },
  };
  return storage;
}

// 未設定・不正な項目だけを既定値にし、正常な設定は保持する。
export function parseEnvironment(text: string | null): Environment {
  const defaults = createDefaultEnvironment();
  if (!text) return defaults;
  try {
    const json = JSON.parse(text) as Partial<Environment>;
    const candidate = {
      ...defaults,
      ...json,
      output: { ...defaults.output, ...json.output },

      trackingCustom: { ...defaults.trackingCustom, ...json.trackingCustom },
      cameraCapture: { ...defaults.cameraCapture, ...json.cameraCapture },
    };
    for (const key of Object.keys(defaults.trackingCustom) as (keyof Environment['trackingCustom'])[]) {
      try {
        validateEnvironment({
          ...defaults,
          trackingCustom: { ...defaults.trackingCustom, [key]: candidate.trackingCustom[key] },
        });
      } catch {
        candidate.trackingCustom[key] = defaults.trackingCustom[key];
      }
    }
    const result = { ...defaults };
    for (const key of Object.keys(defaults.cameraCapture) as (keyof Environment['cameraCapture'])[]) {
      try {
        validateEnvironment({
          ...defaults,
          cameraCapture: { ...defaults.cameraCapture, [key]: candidate.cameraCapture[key] },
        });
      } catch {
        Object.assign(candidate.cameraCapture, { [key]: defaults.cameraCapture[key] });
      }
    }
    for (const key of Object.keys(defaults) as (keyof Environment)[]) {
      try {
        const validated = validateEnvironment({ ...defaults, [key]: candidate[key] });
        Object.assign(result, { [key]: validated[key] });
      } catch (e) {
        console.warn(`environment.json の ${key} が不正なので既定値を使う`, e);
      }
    }
    return result;
  } catch (e) {
    console.warn('environment.json を読めなかったので既定値を使う', e);
    return defaults;
  }
}

export interface EnvironmentStore {
  get(): Environment;
  set(patch: Partial<Environment>): void;
  subscribe(listener: (env: Environment) => void): () => void;
  load(): Promise<void>; // 保存先から読み込む（1回だけ）
  flush(): Promise<void>; // 書き込みが終わるのを待つ
}

export function createEnvironmentStore(storage: EnvironmentStorage): EnvironmentStore {
  let env = createDefaultEnvironment();
  const listeners = new Set<(env: Environment) => void>();
  let writing: Promise<void> = Promise.resolve();
  let loading: Promise<void> | null = null;
  let loaded = false;
  let pending: Partial<Environment> = {};

  function replace(next: Environment) {
    env = next;
    for (const l of [...listeners]) l(env);
  }

  function save() {
    const text = JSON.stringify(env, null, 2);
    writing = writing.then(() => storage.write(text)).catch((e) => console.error('environment.json を保存できない', e));
  }

  function load() {
    loading ??= storage
      .read()
      .catch((e) => {
        console.warn('environment.json を読み込めない', e);
        return null;
      })
      .then((text) => {
        const changed = Object.keys(pending).length > 0;
        const next = validateEnvironment({ ...parseEnvironment(text), ...pending });
        pending = {};
        loaded = true;
        replace(next);
        if (changed) save();
      });
    return loading;
  }

  return {
    get: () => env,
    set(patch) {
      const keys = Object.keys(patch) as (keyof Environment)[];
      if (keys.length === 0 || (loaded && keys.every((k) => Object.is(env[k], patch[k])))) return;
      const next = validateEnvironment({ ...env, ...patch });
      if (!loaded) Object.assign(pending, patch);
      replace(next);
      if (loaded) save();
      else void load();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // 読み込みは1回だけ（何度呼んでも同じ結果を待つ。読み込みの後の set を古い内容で上書きしないため）
    load,
    async flush() {
      if (loading && Object.keys(pending).length > 0) await loading;
      await writing;
    },
  };
}
