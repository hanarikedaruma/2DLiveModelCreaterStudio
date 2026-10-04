// プロジェクトの操作（カード23）: 新規・開く・保存・名前を付けて保存・起動時の復元・自動保存
import { createEmptyProject, type Project } from '@app/schema';
import type { ProjectIO, Services } from '@app/contracts';
import type { Dialogs } from '../shell/dialogs';
import type { EnvironmentStore } from '../shell/environment';
import { emitAppEvent } from '../shell/events';

// 開いたとき・新規に作ったときに出すアプリイベント（値はプロジェクト）
export const PROJECT_LOADED = 'projectLoaded';

export interface ProjectPlatform {
  pickFolder(title: string): Promise<string | null>; // 選ばなければ null
  unsavedRoot(): Promise<string>; // 保存先の無いプロジェクトの自動保存を置くフォルダ（<アプリのデータ>/unsaved）
  writePendingBackgrounds?(dir: string): Promise<unknown>; // スタジオで先に選んだ背景の画像を写す
}

interface AutosaveLoader {
  loadAutosave(path: string): Promise<{ project: Project; assetPngs: Record<string, Uint8Array> }>;
}

function canLoadAutosave(io: ProjectIO): io is ProjectIO & AutosaveLoader {
  return typeof (io as Partial<AutosaveLoader>).loadAutosave === 'function';
}

export interface ProjectActions {
  dir(): string | null; // いまのプロジェクトの保存先（まだ無ければ null）
  isDirty(): boolean; // 最後に保存（または開いて）から変わったか
  subscribe(listener: () => void): () => void;
  newProject(): Promise<void>;
  open(dir?: string): Promise<void>; // dir を省くとフォルダを選ぶ
  save(): Promise<void>;
  saveAs(dir?: string): Promise<void>;
  recoverOnStartup(): Promise<boolean>; // 復元したら true。どちらでも最後に自動保存を始める
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createProjectActions(deps: {
  services: Services;
  environment: EnvironmentStore;
  dialogs: Dialogs;
  platform: ProjectPlatform;
}): ProjectActions {
  const { services, environment, dialogs, platform } = deps;
  const { store, fs, io, autoSaver, assets } = services;
  let dir: string | null = null;
  let saved: Project | null = store.get();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const l of [...listeners]) l();
  };
  store.subscribe(changed);

  const unsavedDirOf = async (project: Project) => `${await platform.unsavedRoot()}/${project.id}`;

  const projectAssetPngs = (project: Project) => {
    const all = assets.all();
    const out: Record<string, Uint8Array> = {};
    for (const a of project.assets) {
      const png = all[a.id];
      if (png) out[a.id] = png;
    }
    return out;
  };

  async function startAutosave(project: Project) {
    autoSaver.stop();
    autoSaver.start(dir ?? (await unsavedDirOf(project)));
  }

  // 素材を置き場に入れてからストアを差し替え、編集の状態を戻す
  async function loadIntoApp(
    project: Project,
    assetPngs: Record<string, Uint8Array>,
    projectDir: string | null,
    savedState: Project | null,
  ) {
    autoSaver.stop();
    await Promise.all(Object.entries(assetPngs).map(([id, png]) => assets.put(id, png)));
    store.load(project);
    services.editor.set({ selectedPartIds: [], activeParameterIds: [], editorParamValues: {} });
    dir = projectDir;
    saved = savedState;
    if (projectDir) environment.set({ lastProjectDir: projectDir });
    emitAppEvent(PROJECT_LOADED, project);
    // 'projectLoaded' で足したもの（カード34 の STEP1 の標準パラメータ）は、利用者の変更に数えない
    if (saved === project) saved = store.get();
    await startAutosave(project);
    changed();
  }

  async function confirmDiscard(): Promise<boolean> {
    if (store.get() === saved) return true;
    return dialogs.confirm('保存していない変更があります。破棄して続けますか？');
  }

  async function saveTo(target: string) {
    const project = store.get();
    const wasUnsaved = dir === null;
    try {
      await io.save(target, project, projectAssetPngs(project));
      await platform.writePendingBackgrounds?.(target);
    } catch (e) {
      dialogs.notify(`保存できなかった: ${errorText(e)}`);
      return;
    }
    dir = target;
    saved = project;
    environment.set({ lastProjectDir: target });
    await startAutosave(project);
    // 保存先ができたので、保存先の無かったときの自動保存は消す（残すと毎回復元を提案してしまう）
    if (wasUnsaved) {
      const unsaved = await unsavedDirOf(project);
      if (unsaved !== target && (await fs.exists(unsaved))) await fs.remove(unsaved).catch(() => {});
    }
    dialogs.notify(`保存した: ${target}`);
    changed();
  }

  const actions: ProjectActions = {
    dir: () => dir,
    isDirty: () => store.get() !== saved,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async newProject() {
      if (!(await confirmDiscard())) return;
      const name = await dialogs.prompt('新しいプロジェクトの名前', '新しいプロジェクト');
      if (name === null) return;
      const project = createEmptyProject(name.trim() || '新しいプロジェクト');
      await loadIntoApp(project, {}, null, project);
    },

    async open(target) {
      if (!(await confirmDiscard())) return;
      const picked = target ?? (await platform.pickFolder('プロジェクトのフォルダを開く'));
      if (!picked) return;
      let loaded: { project: Project; assetPngs: Record<string, Uint8Array> };
      try {
        loaded = await io.load(picked);
      } catch (e) {
        dialogs.notify(`開けなかった: ${errorText(e)}`);
        return;
      }
      await loadIntoApp(loaded.project, loaded.assetPngs, picked, loaded.project);
    },

    async save() {
      if (dir) await saveTo(dir);
      else await actions.saveAs();
    },

    async saveAs(target) {
      const picked = target ?? (await platform.pickFolder('保存するフォルダを選ぶ'));
      if (!picked) return;
      // ほかのプロジェクトのフォルダに上書きしないように確かめる
      if (picked !== dir && (await fs.exists(`${picked}/project.json`))) {
        const ok = await dialogs.confirm(`${picked} にはプロジェクトがあります。上書きしますか？`);
        if (!ok) return;
      }
      await saveTo(picked);
    },

    async recoverOnStartup() {
      const candidates: { dir: string; saved: boolean }[] = [];
      const last = environment.get().lastProjectDir;
      if (last && (await fs.exists(last))) candidates.push({ dir: last, saved: true });
      const root = await platform.unsavedRoot();
      if (await fs.exists(root)) {
        for (const name of await fs.list(root)) candidates.push({ dir: `${root}/${name}`, saved: false });
      }
      for (const c of candidates) {
        const path = await autoSaver.findRecoverable(c.dir).catch(() => null);
        if (!path || !canLoadAutosave(io)) continue;
        let loaded: { project: Project; assetPngs: Record<string, Uint8Array> };
        try {
          loaded = await io.loadAutosave(path);
        } catch (e) {
          dialogs.notify(`自動保存を読めなかった: ${errorText(e)}`);
          continue;
        }
        const ok = await dialogs.confirm(
          `前回、保存していない変更が残っています（${loaded.project.name}）。復元しますか？`,
        );
        if (!ok) continue;
        try {
          // 復元したものはまだ保存していないので、変更ありの状態にする
          await loadIntoApp(loaded.project, loaded.assetPngs, c.saved ? c.dir : null, null);
          dialogs.notify('前回の作業を復元した');
          return true;
        } catch (e) {
          dialogs.notify(`復元できなかった: ${errorText(e)}`);
        }
      }
      await startAutosave(store.get());
      return false;
    },
  };
  return actions;
}
