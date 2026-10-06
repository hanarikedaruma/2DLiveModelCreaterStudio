import { newId } from '@app/schema';
import type { Asset, Project } from '@app/schema';
import {
  emptyLoadReport,
  type AutoSaver,
  type FileSystem,
  type ImportWarning,
  type ImportedAsset,
  type Importer,
  type LoadedProject,
  type ProjectIO,
} from '../index';

// ---- MemoryFileSystem ----

function normalize(path: string): string {
  const parts = path.split('/').filter((s) => s && s !== '.');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else out.push(p);
  }
  return '/' + out.join('/');
}

function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}

function notFound(path: string): Error {
  return new Error(`見つからない: ${path}`);
}

// メモリの中のファイルシステム。パスは / 区切りの絶対パス
export class MemoryFileSystem implements FileSystem {
  private readonly files = new Map<string, Uint8Array>();
  private readonly dirs = new Set<string>(['/']);

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBinary(path));
  }

  async writeText(path: string, data: string): Promise<void> {
    await this.writeBinary(path, new TextEncoder().encode(data));
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const data = this.files.get(normalize(path));
    if (!data) throw notFound(path);
    return data.slice();
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    const p = normalize(path);
    if (this.dirs.has(p)) throw new Error(`フォルダには書き込めない: ${path}`);
    if (!this.dirs.has(parentOf(p))) throw notFound(parentOf(p));
    this.files.set(p, data.slice());
  }

  async exists(path: string): Promise<boolean> {
    const p = normalize(path);
    return this.files.has(p) || this.dirs.has(p);
  }

  // 途中のフォルダもまとめて作る
  async mkdir(path: string): Promise<void> {
    let p = normalize(path);
    while (!this.dirs.has(p)) {
      if (this.files.has(p)) throw new Error(`ファイルがあるのでフォルダを作れない: ${p}`);
      this.dirs.add(p);
      p = parentOf(p);
    }
  }

  // 直下の名前（ファイルとフォルダ）を名前順に返す
  async list(dir: string): Promise<string[]> {
    const d = normalize(dir);
    if (!this.dirs.has(d)) throw notFound(dir);
    const prefix = d === '/' ? '/' : d + '/';
    const names = new Set<string>();
    for (const p of [...this.files.keys(), ...this.dirs]) {
      if (p !== d && p.startsWith(prefix)) names.add(p.slice(prefix.length).split('/')[0]!);
    }
    return [...names].sort();
  }

  // フォルダは中身ごと消す
  async remove(path: string): Promise<void> {
    const p = normalize(path);
    if (this.files.delete(p)) return;
    if (!this.dirs.has(p) || p === '/') throw notFound(path);
    const prefix = p + '/';
    for (const f of [...this.files.keys()]) if (f.startsWith(prefix)) this.files.delete(f);
    for (const d of [...this.dirs]) if (d === p || d.startsWith(prefix)) this.dirs.delete(d);
  }

  // 移動先にファイルがあれば置き換える
  async rename(from: string, to: string): Promise<void> {
    const src = normalize(from);
    const dst = normalize(to);
    if (!this.dirs.has(parentOf(dst))) throw notFound(parentOf(dst));
    const file = this.files.get(src);
    if (file) {
      this.files.delete(src);
      this.files.set(dst, file);
      return;
    }
    if (!this.dirs.has(src)) throw notFound(from);
    const prefix = src + '/';
    for (const [f, data] of [...this.files]) {
      if (f.startsWith(prefix)) {
        this.files.delete(f);
        this.files.set(dst + f.slice(src.length), data);
      }
    }
    for (const d of [...this.dirs]) {
      if (d === src || d.startsWith(prefix)) {
        this.dirs.delete(d);
        this.dirs.add(dst + d.slice(src.length));
      }
    }
  }
}

// ---- FakeImporter ----

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(data: Uint8Array): boolean {
  return data.length >= 24 && PNG_SIGNATURE.every((b, i) => data[i] === b);
}

// IHDR から幅と高さを読む
export function pngSize(data: Uint8Array): { width: number; height: number } {
  if (!isPng(data)) throw new Error('PNG ではない');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// PNG だけを読み、トリミングせず offset (0,0) で返す
export class FakeImporter implements Importer {
  async importFiles(
    files: { name: string; data: Uint8Array }[],
  ): Promise<{ assets: ImportedAsset[]; warnings: ImportWarning[] }> {
    const assets: ImportedAsset[] = [];
    for (const file of files) {
      if (!isPng(file.data)) continue;
      const { width, height } = pngSize(file.data);
      const id = newId();
      const asset: Asset = {
        id,
        path: `assets/${id}.png`,
        hash: await sha256Hex(file.data),
        width,
        height,
        offset: { x: 0, y: 0 },
        canvasSize: { width, height },
        source: { kind: 'png', file: file.name },
        sourceBlendMode: 'normal',
        sourceOpacity: 1,
      };
      assets.push({ asset, png: file.data });
    }
    return { assets, warnings: [] };
  }
}

// ---- FakeProjectIO・FakeAutoSaver ----

// メモリに保存する
export class FakeProjectIO implements ProjectIO {
  private readonly saved = new Map<string, { project: Project; assetPngs: Record<string, Uint8Array> }>();

  async save(dir: string, project: Project, assetPngs: Record<string, Uint8Array>): Promise<void> {
    this.saved.set(normalize(dir), structuredClone({ project, assetPngs }));
  }

  async load(dir: string): Promise<LoadedProject> {
    const entry = this.saved.get(normalize(dir));
    if (!entry) throw notFound(dir);
    return { ...structuredClone(entry), report: emptyLoadReport() };
  }
}

// 何もしない
export class FakeAutoSaver implements AutoSaver {
  start(_dir: string): void {}
  stop(): void {}
  async findRecoverable(_dir: string): Promise<string | null> {
    return null;
  }
}
