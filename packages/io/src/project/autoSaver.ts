// 自動保存と異常終了からの復元（カード14）
import { sha256Hex, type AutoSaver, type FileSystem, type ProjectIO, type ProjectStore } from '@app/contracts';
import type { Project } from '@app/schema';
import {
  ASSETS_DIR,
  BACKUPS_DIR,
  PROJECT_FILE,
  assetFilePath,
  canonicalJson,
  isRecord,
  joinPath,
  projectToJson,
  uniqueStampedPath,
  writeBinaryAtomic,
  writeTextAtomic,
} from './files';

export interface AutoSaverOptions {
  delayMs?: number; // 最後の変更から書くまで（既定 5000）
  generations?: number; // 残す数（既定 10）
  now?: () => Date; // ファイル名に使う日時
  onError?: (error: unknown) => void; // 書き込みに失敗したとき（既定は console.error）
}

export interface ProjectAutoSaver extends AutoSaver {
  // 待っている自動保存があればすぐに書き、書き終わるまで待つ
  flush(): Promise<void>;
}

// 自動保存のファイルに足す情報。読み込むときの検証では捨てられる
export const AUTOSAVE_KEY = 'autosave';
export interface AutosaveInfo {
  basedOn: string | null; // 書いたときの project.json の SHA-256（無ければ null）
  savedAt: string; // ISO 8601
}

const AUTOSAVE_NAME = /^autosave-[^/\\:]+\.json$/;

export function isAutosaveName(name: string): boolean {
  return AUTOSAVE_NAME.test(name);
}

// io は契約の形に合わせて受け取る（いまは使わない。書き込みは fs で直接行う）
export function createAutoSaver(
  fs: FileSystem,
  _io: ProjectIO,
  store: ProjectStore,
  getAssetPngs: () => Record<string, Uint8Array>,
  options: AutoSaverOptions = {},
): ProjectAutoSaver {
  const delayMs = options.delayMs ?? 5000;
  const generations = options.generations ?? 10;
  const now = options.now ?? (() => new Date());
  const onError = options.onError ?? ((e: unknown) => console.error('自動保存に失敗した', e));

  let target: { dir: string; projectId: string } | null = null;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();

  const clearTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const fire = (): void => {
    timer = null;
    const current = target;
    if (!current) return;
    const project = store.get();
    // 別のプロジェクトに入れ替わっていたら、このフォルダには書かない
    if (project.id !== current.projectId) return;
    writing = writing
      .then(() => writeAutosave(fs, current.dir, project, getAssetPngs(), now(), generations))
      .catch(onError);
  };

  const stop = (): void => {
    unsubscribe?.();
    unsubscribe = null;
    clearTimer();
    target = null;
  };

  return {
    start(dir) {
      stop();
      target = { dir, projectId: store.get().id };
      unsubscribe = store.subscribe(() => {
        clearTimer();
        timer = setTimeout(fire, delayMs);
      });
    },

    stop,

    async flush() {
      if (timer !== null) {
        clearTimer();
        fire();
      }
      await writing;
    },

    findRecoverable: (dir) => findRecoverable(fs, dir),
    discardRecovery(dir, expectedPath) {
      // このインスタンスの既に始まった書き込みと、破棄を直列にする。
      const result = writing.then(() => discardRecovery(fs, dir, expectedPath));
      writing = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

async function writeAutosave(
  fs: FileSystem,
  dir: string,
  project: Project,
  pngs: Record<string, Uint8Array>,
  date: Date,
  generations: number,
): Promise<void> {
  const backups = joinPath(dir, BACKUPS_DIR);
  await fs.mkdir(backups);
  await fs.mkdir(joinPath(dir, ASSETS_DIR));

  // 素材は assets/ に無いものだけ書く
  for (const asset of project.assets) {
    const path = assetFilePath(dir, asset);
    const png = pngs[asset.id];
    if (png && !(await fs.exists(path))) await writeBinaryAtomic(fs, path, png);
  }

  const info: AutosaveInfo = { basedOn: await savedHash(fs, dir), savedAt: date.toISOString() };
  const path = await uniqueStampedPath(fs, backups, date, (stamp) => `autosave-${stamp}.json`);
  await writeTextAtomic(fs, path, projectToJson(project, { [AUTOSAVE_KEY]: info }));

  // 古いものから消して generations 個を保つ
  const names = (await fs.list(backups)).filter(isAutosaveName).sort();
  for (const name of names.slice(0, Math.max(0, names.length - generations))) {
    await fs.remove(joinPath(backups, name));
  }
}

// project.json の SHA-256。無ければ null
async function savedHash(fs: FileSystem, dir: string): Promise<string | null> {
  const path = joinPath(dir, PROJECT_FILE);
  if (!(await fs.exists(path))) return null;
  return sha256Hex(await fs.readBinary(path));
}

// project.json より新しい自動保存があれば、そのパスを返す。
// 「新しい」= 今の project.json を元にして書かれ（basedOn が一致し）、中身が違う。
// project.json が無ければ（まだ保存していなければ）いちばん新しい自動保存を返す
export async function findRecoverable(fs: FileSystem, dir: string): Promise<string | null> {
  const backups = joinPath(dir, BACKUPS_DIR);
  if (!(await fs.exists(backups))) return null;
  const names = (await fs.list(backups)).filter(isAutosaveName).sort().reverse();
  if (names.length === 0) return null;

  const projectPath = joinPath(dir, PROJECT_FILE);
  const saved = (await fs.exists(projectPath)) ? await fs.readBinary(projectPath) : null;
  const hash = saved ? await sha256Hex(saved) : null;

  for (const name of names) {
    const path = joinPath(backups, name);
    let json: unknown;
    try {
      json = JSON.parse(await fs.readText(path));
    } catch {
      continue; // 壊れたものは飛ばして1つ前を見る
    }
    if (!isRecord(json)) continue;
    if (!saved) return path;

    const { [AUTOSAVE_KEY]: info, ...content } = json;
    const basedOn = isRecord(info) && typeof info.basedOn === 'string' ? info.basedOn : null;
    // 自動保存の後に保存し直していれば、project.json のほうが新しい
    if (basedOn !== hash) return null;
    let savedJson: unknown;
    try {
      savedJson = JSON.parse(new TextDecoder().decode(saved));
    } catch {
      return path; // project.json が壊れているなら戻せるほうを返す
    }
    return canonicalJson(content) === canonicalJson(savedJson) ? null : path;
  }
  return null;
}

// フォルダ全体を消さず、表示した世代までの自動保存JSONだけを消す（I-071）。
export async function discardRecovery(
  fs: FileSystem,
  dir: string,
  expectedPath: string,
): Promise<'discarded' | 'changed'> {
  const backups = joinPath(dir, BACKUPS_DIR);
  const expectedName = expectedPath.slice(expectedPath.lastIndexOf('/') + 1);
  if (!isAutosaveName(expectedName) || joinPath(backups, expectedName) !== expectedPath) {
    throw new Error('破棄する自動保存のパスが対象のフォルダと一致しない');
  }
  if ((await findRecoverable(fs, dir)) !== expectedPath) return 'changed';
  const names = (await fs.list(backups)).filter((name) => isAutosaveName(name) && name <= expectedName).sort();
  // .jsonという名前のフォルダをremoveで再帰削除しないよう、先に全対象が読めるファイルか確かめる。
  for (const name of names) await fs.readBinary(joinPath(backups, name));
  if ((await findRecoverable(fs, dir)) !== expectedPath) return 'changed';
  // 古い世代から消す。途中で失敗しても、表示した最新の作業をなるべく残す。
  for (const name of names) await fs.remove(joinPath(backups, name));
  return (await findRecoverable(fs, dir)) === null ? 'discarded' : 'changed';
}
