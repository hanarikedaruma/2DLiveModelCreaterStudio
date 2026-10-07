import type { Project } from '@app/schema';
import type { Command, ProjectStore } from '@app/contracts';
import type { BackgroundFiles } from '../backgrounds';

export function removeBackgroundImageCommand(path: string): Command {
  return {
    label: '背景の画像を削除',
    apply: (p) => ({
      ...p,
      studio: {
        ...p.studio,
        scenes: p.studio.scenes.map((s) =>
          s.background.type === 'image' && s.background.path === path
            ? { ...s, background: { type: 'transparent' as const } }
            : s,
        ),
        hotkeys: p.studio.hotkeys.filter((h) => h.action !== 'background' || h.targetId !== `image:${path}`),
      },
    }),
  };
}

const watchers = new WeakMap<ProjectStore, Map<string, () => void>>();

// 画像ファイルの変更はコマンドの外で行う。履歴のスナップショットを覚え、
// Undo/Redoに合わせて同じファイルを復元・退避する（プロジェクトの型は増やさない）。
export async function removeBackgroundImage(
  store: ProjectStore,
  files: BackgroundFiles,
  dialogs: { confirm(message: string): Promise<boolean>; notify(message: string): void },
  path: string,
): Promise<boolean> {
  const before = store.get();
  const scenes = before.studio.scenes.filter((s) => s.background.type === 'image' && s.background.path === path);
  const hotkeys = before.studio.hotkeys.filter((h) => h.action === 'background' && h.targetId === `image:${path}`);
  const usage =
    scenes.length > 0 ? `使っているシーン（${scenes.map((s) => s.name).join('、')}）は透明な背景にする。` : '';
  if (
    !(await dialogs.confirm(
      `背景の画像を削除しますか？ ${usage}この背景のホットキー（${hotkeys.length} 個）も消す。Undoで画像と設定を戻せる`,
    ))
  )
    return false;
  if (store.get() !== before) {
    dialogs.notify('確認中にプロジェクトが変わった。削除を選び直す');
    return false;
  }
  try {
    await files.remove(path);
    if (store.get() !== before) {
      await files.restore(path);
      dialogs.notify('削除中にプロジェクトが変わった。画像を戻した');
      return false;
    }
    const after = removeBackgroundImageCommand(path).apply(before);
    let paths = watchers.get(store);
    if (!paths) watchers.set(store, (paths = new Map()));
    paths.get(path)?.();
    const states = new WeakMap<Project, boolean>([
      [before, false],
      [after, true],
    ]);
    let removed = true;
    let pending = Promise.resolve();
    const off = store.subscribe(() => {
      const project = store.get();
      if (project.id !== before.id) {
        off();
        paths!.delete(path);
        return;
      }
      const next = states.get(project) ?? removed;
      states.set(project, next);
      if (next === removed) return;
      removed = next;
      pending = pending
        .then(async () => {
          if (store.get().id !== before.id) return;
          await (next ? files.remove(path) : files.restore(path));
        })
        .catch((e: unknown) =>
          dialogs.notify(
            `背景の画像を${next ? '削除' : '復元'}できない: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
    });
    paths.set(path, off);
    store.dispatch({ label: '背景の画像を削除', apply: (p) => (p === before ? after : p) });
    return true;
  } catch (e) {
    dialogs.notify(`背景の画像を削除できない: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
