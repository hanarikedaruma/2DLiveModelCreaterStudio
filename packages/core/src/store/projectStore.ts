import type { Model, Part, Project } from '@app/schema';
import type { Command, ProjectStore } from '@app/contracts';
import { withPartOpacity } from '../eval/opacity';

export const HISTORY_LIMIT = 200;

interface HistoryEntry {
  label: string;
  project: Project; // そのコマンドを適用する前の状態
}

// 拡張: 履歴のラベルを読める（メニューの「元に戻す: ○○」などに使う）
export interface ProjectStoreWithHistory extends ProjectStore {
  undoLabel(): string | null;
  redoLabel(): string | null;
}

export function createProjectStore(initial: Project): ProjectStoreWithHistory {
  let current = initial;
  let past: HistoryEntry[] = [];
  let future: HistoryEntry[] = [];
  const listeners = new Set<(project: Project) => void>();
  // トランザクションの入れ子。各段の開始前の状態
  const txStarts: Project[] = [];

  function setCurrent(next: Project) {
    if (next === current) return;
    current = next;
    for (const l of [...listeners]) l(current);
  }

  function record(label: string, before: Project) {
    past.push({ label, project: before });
    if (past.length > HISTORY_LIMIT) past = past.slice(past.length - HISTORY_LIMIT);
    future = [];
  }

  function assertNotInTransaction(what: string) {
    if (txStarts.length > 0) throw new Error(`トランザクションの中では ${what} できない`);
  }

  const store: ProjectStoreWithHistory = {
    get: () => current,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispatch(command: Command) {
      const before = current;
      const next = command.apply(before);
      if (next === before) return;
      if (txStarts.length === 0) record(command.label, before);
      setCurrent(next);
    },

    transaction(label, run) {
      const start = current;
      txStarts.push(start);
      try {
        run(store.dispatch);
      } catch (e) {
        txStarts.pop();
        setCurrent(start);
        throw e;
      }
      txStarts.pop();
      // 入れ子はいちばん外側でまとめて1回の Undo にする
      if (txStarts.length === 0 && current !== start) record(label, start);
    },

    undo() {
      assertNotInTransaction('undo');
      const entry = past.pop();
      if (!entry) return;
      future.push({ label: entry.label, project: current });
      setCurrent(entry.project);
    },

    redo() {
      assertNotInTransaction('redo');
      const entry = future.pop();
      if (!entry) return;
      past.push({ label: entry.label, project: current });
      setCurrent(entry.project);
    },

    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    undoLabel: () => past.at(-1)?.label ?? null,
    redoLabel: () => future.at(-1)?.label ?? null,

    load(project) {
      assertNotInTransaction('load');
      past = [];
      future = [];
      setCurrent(project);
    },
  };
  return store;
}

// モデルだけを変えるコマンド。fn が同じ参照を返したら何もしない
export function modelCommand(label: string, fn: (model: Model) => Model): Command {
  return {
    label,
    apply(project) {
      const model = fn(project.model);
      return model === project.model ? project : { ...project, model };
    },
  };
}

// パーツの項目を書き換えるコマンド。パーツが無いか、値が同じなら何もしない。
// 不透明度を変えるときは、不透明度のバインディングのデフォルト値のキーも同じ値にする（I-026）
export function patchPart(label: string, partId: string, patch: Partial<Part>): Command {
  return modelCommand(label, (model) => {
    const index = model.parts.findIndex((p) => p.id === partId);
    const part = model.parts[index];
    if (!part) return model;
    const changed = (Object.keys(patch) as (keyof Part)[]).some((k) => !Object.is(part[k], patch[k]));
    if (!changed) return model;
    const parts = model.parts.slice();
    parts[index] = { ...part, ...patch };
    const next = { ...model, parts };
    return patch.opacity !== undefined ? withPartOpacity(next, partId, patch.opacity) : next;
  });
}
