// 背景の画像。シーンの背景（プロジェクトからの相対パス）を描画用の Background にし、
// 選んだ画像をプロジェクトの backgrounds/ に写す
import { newId } from '@app/schema';
import type { Background, FileSystem } from '@app/contracts';
import type { SceneBackground } from './scene';

// missing: ファイルが無い。broken: 画像として読めない
export type BackgroundImageStatus = 'loading' | 'ready' | 'missing' | 'broken';

export interface BackgroundImages {
  resolve(background: SceneBackground): Background; // 画像がまだ読めていなければ透明にする
  status(path: string): BackgroundImageStatus | null;
  put(path: string, bytes: Uint8Array): void; // 手元にある画像（選んだばかりのもの・出力ウィンドウが受け取ったもの）
  bytes(path: string): Uint8Array | undefined;
  subscribe(listener: () => void): () => void; // 読み込みの状態が変わったとき
  forgetMissing(): void; // 読めなかった画像を、次に使うときに読み直す
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

function extensionOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1]!.toLowerCase() : '';
}

export function isBackgroundImageName(name: string): boolean {
  return extensionOf(name) in MIME;
}

export function decodeBackgroundImage(bytes: Uint8Array, path: string): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') return Promise.reject(new Error('画像を読めない環境'));
  return createImageBitmap(new Blob([bytes], { type: MIME[extensionOf(path)] ?? 'image/png' }));
}

interface Entry {
  status: BackgroundImageStatus;
  bytes?: Uint8Array;
  image?: ImageBitmap;
}

export function createBackgroundImages(
  options: {
    decode?: (bytes: Uint8Array, path: string) => Promise<ImageBitmap>;
    load?: (path: string) => Promise<Uint8Array | null>; // 手元に無い画像を読む（無ければ null）
  } = {},
): BackgroundImages {
  const decode = options.decode ?? decodeBackgroundImage;
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const l of [...listeners]) l();
  };

  function put(path: string, bytes: Uint8Array) {
    const before = entries.get(path);
    if (before?.bytes === bytes) return;
    before?.image?.close?.();
    entries.set(path, { status: 'loading', bytes });
    changed();
    decode(bytes, path).then(
      (image) => {
        if (entries.get(path)?.bytes !== bytes) {
          image.close?.();
          return;
        }
        entries.set(path, { status: 'ready', bytes, image });
        changed();
      },
      (e: unknown) => {
        if (entries.get(path)?.bytes !== bytes) return;
        console.warn(`背景の画像を読めない: ${path}`, e);
        entries.set(path, { status: 'broken', bytes });
        changed();
      },
    );
  }

  function startLoad(path: string) {
    entries.set(path, { status: 'loading' });
    const { load } = options;
    if (!load) {
      entries.set(path, { status: 'missing' });
      changed();
      return;
    }
    load(path).then(
      (bytes) => {
        const entry = entries.get(path);
        if (!entry || entry.bytes) return; // 待っている間に put された
        if (bytes) put(path, bytes);
        else {
          entries.set(path, { status: 'missing' });
          changed();
        }
      },
      (e: unknown) => {
        if (entries.get(path)?.bytes) return;
        console.warn(`背景の画像を読めない: ${path}`, e);
        entries.set(path, { status: 'missing' });
        changed();
      },
    );
  }

  return {
    resolve(background) {
      if (background.type !== 'image') return background;
      const entry = entries.get(background.path);
      if (!entry) startLoad(background.path);
      return entry?.image ? { type: 'image', image: entry.image } : { type: 'transparent' };
    },
    status: (path) => entries.get(path)?.status ?? null,
    put,
    forgetMissing() {
      for (const [path, entry] of [...entries]) if (entry.status === 'missing' && !entry.bytes) entries.delete(path);
    },
    bytes: (path) => entries.get(path)?.bytes,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// ---- プロジェクトのフォルダの backgrounds/ ----

// 開いているプロジェクトのフォルダ（/ 区切りの絶対パス）。まだ無ければ null
export type ProjectDirResolver = () => string | null | Promise<string | null>;

export interface BackgroundFiles {
  setProjectDirResolver(resolve: ProjectDirResolver): void;
  // 選んだ画像を backgrounds/ に写し、シーンに書くパスを返す。フォルダがまだ無ければ手元に置いておく（saved: false）
  importImage(file: { name: string; data: Uint8Array }): Promise<{ path: string; saved: boolean }>;
  load(path: string): Promise<Uint8Array | null>;
  // backgrounds/ にある画像と、まだ写していない画像のパス（プロジェクトからの相対パス。名前の順）。シーンの背景プリセットに使う
  list(): Promise<string[]>;
  pending(): string[]; // まだフォルダに写していない画像のパス
  writePending(dir: string): Promise<string[]>; // 手元に置いてある画像をフォルダに写す（保存のときに呼ぶ）
  subscribe(listener: () => void): () => void; // pending が変わったとき
}

function join(dir: string, path: string): string {
  return `${dir.replace(/\/+$/, '')}/${path}`;
}

export function createBackgroundFiles(deps: {
  fs: () => FileSystem | null;
  images: BackgroundImages;
}): BackgroundFiles {
  let resolveDir: ProjectDirResolver = () => null;
  const waiting = new Map<string, Uint8Array>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const l of [...listeners]) l();
  };

  async function write(fs: FileSystem, dir: string, path: string, data: Uint8Array) {
    await fs.mkdir(join(dir, 'backgrounds'));
    await fs.writeBinary(join(dir, path), data);
  }

  return {
    setProjectDirResolver(resolve) {
      resolveDir = resolve;
      deps.images.forgetMissing();
    },
    async importImage(file) {
      if (!isBackgroundImageName(file.name)) throw new Error('PNG・JPEG・WebP の画像を選ぶ');
      const path = `backgrounds/${newId()}.${extensionOf(file.name)}`;
      deps.images.put(path, file.data);
      const dir = await resolveDir();
      const fs = deps.fs();
      if (dir && fs) {
        try {
          await write(fs, dir, path, file.data);
          return { path, saved: true };
        } catch (e) {
          console.error(`背景の画像をフォルダに写せない: ${path}`, e);
        }
      }
      waiting.set(path, file.data);
      changed();
      return { path, saved: false };
    },
    async load(path) {
      const kept = waiting.get(path);
      if (kept) return kept;
      const dir = await resolveDir();
      const fs = deps.fs();
      if (!dir || !fs) return null;
      const full = join(dir, path);
      return (await fs.exists(full)) ? fs.readBinary(full) : null;
    },
    async list() {
      const out = new Set(waiting.keys());
      const dir = await resolveDir();
      const fs = deps.fs();
      if (dir && fs) {
        const folder = join(dir, 'backgrounds');
        if (await fs.exists(folder)) {
          for (const name of await fs.list(folder)) if (isBackgroundImageName(name)) out.add(`backgrounds/${name}`);
        }
      }
      return [...out].sort();
    },
    pending: () => [...waiting.keys()],
    async writePending(dir) {
      const fs = deps.fs();
      if (!fs) return [];
      const written: string[] = [];
      for (const [path, data] of [...waiting]) {
        await write(fs, dir, path, data);
        waiting.delete(path);
        written.push(path);
      }
      if (written.length > 0) changed();
      return written;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
