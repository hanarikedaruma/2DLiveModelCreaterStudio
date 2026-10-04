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

// 足りない項目は既定値で埋める（古い版や手で書き換えたファイルでも開けるように）
export function parseEnvironment(text: string | null): Environment {
  const defaults = createDefaultEnvironment();
  if (!text) return defaults;
  try {
    const json = JSON.parse(text) as Partial<Environment>;
    return validateEnvironment({
      ...defaults,
      ...json,
      output: { ...defaults.output, ...json.output },
      uiLevel: { ...defaults.uiLevel, ...json.uiLevel },
    });
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

  function replace(next: Environment) {
    env = next;
    for (const l of [...listeners]) l(env);
  }

  return {
    get: () => env,
    set(patch) {
      const keys = Object.keys(patch) as (keyof Environment)[];
      if (keys.every((k) => Object.is(env[k], patch[k]))) return;
      replace({ ...env, ...patch });
      const text = JSON.stringify(env, null, 2);
      // 順番どおりに書く。失敗してもアプリは止めない
      writing = writing
        .then(() => storage.write(text))
        .catch((e) => console.error('environment.json を保存できない', e));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // 読み込みは1回だけ（何度呼んでも同じ結果を待つ。読み込みの後の set を古い内容で上書きしないため）
    load() {
      loading ??= storage.read().then((text) => replace(parseEnvironment(text)));
      return loading;
    },
    flush: () => writing,
  };
}
