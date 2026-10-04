// プロジェクトのフォルダへの保存と読み込み（カード14）。
// フォルダの構成: project.json・assets/<id>.png・backups/
import {
  MIGRATIONS,
  ProjectVersionError,
  SCHEMA_VERSION,
  migrateWith,
  validateProject,
  type Migrations,
  type Project,
} from '@app/schema';
import type { FileSystem, ProjectIO } from '@app/contracts';
import {
  ASSETS_DIR,
  BACKUPS_DIR,
  PROJECT_FILE,
  assetFilePath,
  isRecord,
  joinPath,
  projectToJson,
  uniqueStampedPath,
  writeBinaryAtomic,
  writeTextAtomic,
} from './files';

export interface ProjectIOOptions {
  migrations?: Migrations; // 版の変換表（テスト用。既定は @app/schema の MIGRATIONS）
  currentVersion?: number; // 現在の版（テスト用。既定は SCHEMA_VERSION）
  now?: () => Date; // バックアップの名前に使う日時
}

export interface LoadedProject {
  project: Project;
  assetPngs: Record<string, Uint8Array>;
}

export interface ProjectFolderIO extends ProjectIO {
  // 自動保存のファイル（<dir>/backups/autosave-<日時>.json）から読み込む。素材は <dir>/assets/ から読む
  loadAutosave(path: string): Promise<LoadedProject>;
}

// 参照している素材のファイルが無いときのエラー
export interface MissingAssetFilesError extends Error {
  name: 'MissingAssetFilesError';
  assetIds: string[];
}

export function createProjectIO(fs: FileSystem, options: ProjectIOOptions = {}): ProjectFolderIO {
  const migrations = options.migrations ?? MIGRATIONS;
  const currentVersion = options.currentVersion ?? SCHEMA_VERSION;
  const now = options.now ?? (() => new Date());

  // 解析 → （古い版ならバックアップ）→ 変換 → 検証
  async function parseProject(text: string, label: string, backupDir: string | null): Promise<Project> {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new ProjectVersionError(`${label} を JSON として読めない: ${e instanceof Error ? e.message : String(e)}`);
    }
    const version = isRecord(json) ? json.schemaVersion : undefined;
    const old = typeof version === 'number' && Number.isInteger(version) && version >= 1 && version < currentVersion;
    if (old && backupDir !== null) {
      // 変換前のファイルをそのまま残す
      await fs.mkdir(backupDir);
      const path = await uniqueStampedPath(fs, backupDir, now(), (stamp) => `project.v${version}.${stamp}.json`);
      await writeTextAtomic(fs, path, text);
    }
    return validateProject(migrateWith(json, migrations, currentVersion));
  }

  async function readAssets(dir: string, project: Project): Promise<Record<string, Uint8Array>> {
    const paths = project.assets.map((a) => ({ id: a.id, path: assetFilePath(dir, a) }));
    const missing: string[] = [];
    for (const { id, path } of paths) if (!(await fs.exists(path))) missing.push(id);
    if (missing.length > 0) throw missingAssetFiles(missing);
    const pngs: Record<string, Uint8Array> = {};
    for (const { id, path } of paths) pngs[id] = await fs.readBinary(path);
    return pngs;
  }

  return {
    async save(dir, project, assetPngs) {
      const previous = await savedAssets(fs, dir);
      // 書くものを先に決め、足りない画像があれば何も書かずに止める
      const toWrite: { path: string; png: Uint8Array }[] = [];
      const lacking: string[] = [];
      for (const asset of project.assets) {
        const path = assetFilePath(dir, asset);
        const before = previous.get(asset.id);
        if (before && before.hash === asset.hash && before.path === asset.path && (await fs.exists(path))) continue;
        const png = assetPngs[asset.id];
        if (png) toWrite.push({ path, png });
        else lacking.push(asset.id);
      }
      if (lacking.length > 0) throw new Error(`保存する素材の画像が無い: ${lacking.join(', ')}`);

      await fs.mkdir(dir);
      await fs.mkdir(joinPath(dir, ASSETS_DIR));
      await fs.mkdir(joinPath(dir, BACKUPS_DIR));
      for (const { path, png } of toWrite) await writeBinaryAtomic(fs, path, png);
      // 素材を書き終えてから project.json を置き換える
      await writeTextAtomic(fs, joinPath(dir, PROJECT_FILE), projectToJson(project));
    },

    async load(dir) {
      const path = joinPath(dir, PROJECT_FILE);
      if (!(await fs.exists(path))) throw new Error(`${PROJECT_FILE} が無い: ${path}`);
      const project = await parseProject(await fs.readText(path), PROJECT_FILE, joinPath(dir, BACKUPS_DIR));
      return { project, assetPngs: await readAssets(dir, project) };
    },

    async loadAutosave(path) {
      const dir = projectDirOfBackup(path);
      const project = await parseProject(await fs.readText(path), path, null);
      return { project, assetPngs: await readAssets(dir, project) };
    },
  };
}

// 前に保存した project.json の素材（id → hash・path）。読めなければ空
async function savedAssets(fs: FileSystem, dir: string): Promise<Map<string, { hash: string; path: string }>> {
  const result = new Map<string, { hash: string; path: string }>();
  const path = joinPath(dir, PROJECT_FILE);
  try {
    if (!(await fs.exists(path))) return result;
    const json: unknown = JSON.parse(await fs.readText(path));
    const assets = isRecord(json) && Array.isArray(json.assets) ? json.assets : [];
    for (const a of assets) {
      if (isRecord(a) && typeof a.id === 'string' && typeof a.hash === 'string' && typeof a.path === 'string') {
        result.set(a.id, { hash: a.hash, path: a.path });
      }
    }
  } catch {
    // 壊れた project.json は前の保存が無いものとして全部書く
  }
  return result;
}

// <dir>/backups/<name> → <dir>
function projectDirOfBackup(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/');
  if (parts.length < 3 || parts[parts.length - 2] !== BACKUPS_DIR) {
    throw new Error(`自動保存のファイルは ${BACKUPS_DIR}/ の中にあるはず: ${path}`);
  }
  return parts.slice(0, -2).join('/') || '/';
}

function missingAssetFiles(assetIds: string[]): MissingAssetFilesError {
  const error = new Error(`素材のファイルが無い: ${assetIds.join(', ')}`) as MissingAssetFilesError;
  error.name = 'MissingAssetFilesError';
  error.assetIds = assetIds;
  return error;
}
