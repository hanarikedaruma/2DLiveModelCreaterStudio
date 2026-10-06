// プロジェクトのフォルダへの保存と読み込み（カード14）。
// フォルダの構成: project.json・assets/<id>.png・backups/
// STEP3 のカード58: 素材が欠けていても開く（透明な画像の代わり）。保存の途中で止まった .tmp から開く。
// 開くときに切れた参照を直す。分かったことは LoadReport で返す
import {
  MIGRATIONS,
  ProjectVersionError,
  SCHEMA_VERSION,
  migrateWith,
  validateProject,
  type Asset,
  type Migrations,
  type Project,
} from '@app/schema';
import {
  emptyLoadReport,
  sha256Hex,
  type FileSystem,
  type LoadReport,
  type LoadedProject,
  type ProjectIO,
} from '@app/contracts';
import { encodePng } from '../import/png';
import {
  ASSETS_DIR,
  BACKUPS_DIR,
  PROJECT_FILE,
  TMP_SUFFIX,
  assetFilePath,
  isRecord,
  joinPath,
  projectToJson,
  uniqueStampedPath,
  writeBinaryAtomic,
  writeTextAtomic,
} from './files';
import { repairProject } from './repair';

export type { LoadedProject } from '@app/contracts';

export interface ProjectIOOptions {
  migrations?: Migrations; // 版の変換表（テスト用。既定は @app/schema の MIGRATIONS）
  currentVersion?: number; // 現在の版（テスト用。既定は SCHEMA_VERSION）
  now?: () => Date; // バックアップの名前に使う日時
}

export interface ProjectFolderIO extends ProjectIO {
  // 自動保存のファイル（<dir>/backups/autosave-<日時>.json）から読み込む。素材は <dir>/assets/ から読む
  loadAutosave(path: string): Promise<LoadedProject>;
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

  // 素材を読む。無ければ保存の途中の .tmp、それも無ければ透明な画像の代わりにする
  async function readAssets(dir: string, project: Project, report: LoadReport): Promise<Record<string, Uint8Array>> {
    const pngs: Record<string, Uint8Array> = {};
    const fromTmp: string[] = [];
    for (const asset of project.assets) {
      const path = assetFilePath(dir, asset);
      let png: Uint8Array | null = null;
      if (await fs.exists(path)) png = await fs.readBinary(path);
      else if (await fs.exists(path + TMP_SUFFIX)) {
        png = await fs.readBinary(path + TMP_SUFFIX);
        fromTmp.push(asset.path);
      }
      if (png === null) {
        report.missingAssetIds.push(asset.id);
        pngs[asset.id] = transparentPng(asset);
        continue;
      }
      if ((await sha256Hex(png)) !== asset.hash) report.changedAssetIds.push(asset.id);
      pngs[asset.id] = png;
    }
    if (fromTmp.length > 0) {
      report.repairs.push(
        `素材のファイルが無く、保存の途中の .tmp があったので、そこから読んだ（${fromTmp.join('、')}）`,
      );
    }
    return pngs;
  }

  async function finish(project: Project, dir: string, report: LoadReport): Promise<LoadedProject> {
    const repaired = repairProject(project);
    report.repairs.push(...repaired.repairs);
    return { project: repaired.project, assetPngs: await readAssets(dir, repaired.project, report), report };
  }

  return {
    async save(dir, project, assetPngs, saveOptions = {}) {
      const skip = new Set(saveOptions.skipAssetIds ?? []);
      const previous = await savedAssets(fs, dir);
      // 書くものを先に決め、足りない画像があれば何も書かずに止める
      const toWrite: { path: string; png: Uint8Array }[] = [];
      const lacking: string[] = [];
      for (const asset of project.assets) {
        if (skip.has(asset.id)) continue; // 欠けたまま（ファイルを書かない）
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
      const report = emptyLoadReport();
      let text: string;
      if (await fs.exists(path)) text = await fs.readText(path);
      else if (await fs.exists(path + TMP_SUFFIX)) {
        // 置き換えの途中で止まった跡。.tmp は書き終えてから名前を変えるので、中身はそろっている
        text = await fs.readText(path + TMP_SUFFIX);
        report.openedFromTmp = true;
        report.repairs.push(
          `${PROJECT_FILE} が無く、保存の途中の ${PROJECT_FILE}${TMP_SUFFIX} があったので、そこから開いた。保存すると ${PROJECT_FILE} に戻る`,
        );
      } else throw new Error(`${PROJECT_FILE} が無い: ${path}`);
      const label = report.openedFromTmp ? PROJECT_FILE + TMP_SUFFIX : PROJECT_FILE;
      return finish(await parseProject(text, label, joinPath(dir, BACKUPS_DIR)), dir, report);
    },

    async loadAutosave(path) {
      const dir = projectDirOfBackup(path);
      return finish(await parseProject(await fs.readText(path), path, null), dir, emptyLoadReport());
    },
  };
}

// 欠けた素材の代わり。素材と同じ大きさの透明な PNG（メッシュの UV と描画の大きさをそろえる）
function transparentPng(asset: Asset): Uint8Array {
  const width = Math.max(1, Math.round(asset.width));
  const height = Math.max(1, Math.round(asset.height));
  return encodePng({ width, height, data: new Uint8Array(width * height * 4) });
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
