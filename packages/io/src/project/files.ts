// プロジェクトのフォルダの中のパスと、書き込みの決まり（.tmp に書いてから rename する）
import type { Asset, Project } from '@app/schema';
import type { FileSystem } from '@app/contracts';

export const PROJECT_FILE = 'project.json';
export const ASSETS_DIR = 'assets';
export const BACKUPS_DIR = 'backups';
export const TMP_SUFFIX = '.tmp';

// / 区切りのパスをつなぐ（dir の末尾の / は取る）
export function joinPath(dir: string, ...names: string[]): string {
  return [dir.replace(/\/+$/, ''), ...names].join('/');
}

// プロジェクトのフォルダからの相対パスで、外へ出ないものだけを許す
export function assetFilePath(dir: string, asset: Asset): string {
  const segments = asset.path.split('/');
  const unsafe =
    asset.path.length === 0 ||
    asset.path.startsWith('/') ||
    asset.path.includes('\\') ||
    asset.path.includes(':') ||
    segments.some((s) => s === '' || s === '.' || s === '..');
  if (unsafe) throw new Error(`素材のパスがプロジェクトのフォルダの外を指している: ${asset.path}（${asset.id}）`);
  return joinPath(dir, ...segments);
}

export async function writeTextAtomic(fs: FileSystem, path: string, text: string): Promise<void> {
  await fs.writeText(path + TMP_SUFFIX, text);
  await fs.rename(path + TMP_SUFFIX, path);
}

export async function writeBinaryAtomic(fs: FileSystem, path: string, data: Uint8Array): Promise<void> {
  await fs.writeBinary(path + TMP_SUFFIX, data);
  await fs.rename(path + TMP_SUFFIX, path);
}

// ファイル名に使う日時（UTC。名前の順に並べると古い順になる）。例: 2026-10-03T01-02-03-004Z
export function timestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

// 同じ名前があれば 1 ミリ秒ずつずらして空いている名前を探す
export async function uniqueStampedPath(
  fs: FileSystem,
  dir: string,
  date: Date,
  name: (stamp: string) => string,
): Promise<string> {
  for (let t = date.getTime(); ; t++) {
    const path = joinPath(dir, name(timestamp(new Date(t))));
    if (!(await fs.exists(path))) return path;
  }
}

// project.json の形。schemaVersion を先頭にして2字下げで整形する
export function projectToJson(project: Project, extra: Record<string, unknown> = {}): string {
  const { schemaVersion, ...rest } = project;
  return JSON.stringify({ schemaVersion, ...rest, ...extra }, null, 2) + '\n';
}

// キーの順を問わずに比べるための文字列
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys(value[k])]),
    );
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
