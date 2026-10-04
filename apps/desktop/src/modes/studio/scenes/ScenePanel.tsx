// シーンの一覧（スタジオの left のパネル、id 'scene'）。押すとそのシーンに切り替える（コマンド）。
// 追加・複製・名前の変更・削除・並べ替えは、使っている（選んでいる）シーンに対して行う。
// 下の <PanelSections panelId="scene" /> に、選んだシーンの編集のセクションが入る
import { useEffect } from 'react';
import { emitAppEvent, PanelSections, useDialogs, useDispatch, useProject, useServices } from '../../../shell/api';
import { activeScene } from '../scene';
import {
  addSceneCommand,
  duplicateSceneCommand,
  moveSceneCommand,
  newScene,
  removeSceneCommand,
  renameSceneCommand,
  selectSceneCommand,
} from './commands';
import { sceneWatcher } from './watcher';

export const SCENE_PANEL = 'scene';

// シーンの切り替えの見張りを services につなぐ。出力ウィンドウはスタジオの画面を離れても動き続け、
// ほかのモードの Undo でもシーンが変わるので、パネルが外れても（画面を離れても）つないだままにする
export function useSceneBinding(): void {
  const services = useServices();
  useEffect(() => {
    sceneWatcher.bind({
      store: services.store,
      expressions: services.expressions,
      now: () => performance.now(),
      emit: emitAppEvent,
    });
  }, [services]);
}

export function ScenePanel() {
  useSceneBinding();
  const project = useProject();
  const dispatch = useDispatch();
  const dialogs = useDialogs();
  const { scenes } = project.studio;
  const active = activeScene(project);
  const index = active ? scenes.findIndex((s) => s.id === active.id) : -1;

  const rename = async (id: string, name: string) => {
    const next = await dialogs.prompt('シーンの名前', name);
    if (next !== null) dispatch(renameSceneCommand(id, next));
  };

  return (
    <div className="scene-panel">
      {scenes.length === 0 ? (
        <p className="studio-note">シーンが無い（［追加］で作る）</p>
      ) : (
        <ul className="scene-list" aria-label="シーンの一覧">
          {scenes.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="scene-item"
                aria-pressed={s.id === active?.id}
                title="押すとこのシーンに切り替える（ダブルクリックで名前の変更）"
                onClick={() => dispatch(selectSceneCommand(s.id))}
                onDoubleClick={() => void rename(s.id, s.name)}
              >
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="scene-actions" role="toolbar" aria-label="シーンの操作">
        <button type="button" onClick={() => dispatch(addSceneCommand(newScene(project)))}>
          追加
        </button>
        <button type="button" disabled={!active} onClick={() => active && dispatch(duplicateSceneCommand(active.id))}>
          複製
        </button>
        <button type="button" disabled={!active} onClick={() => active && void rename(active.id, active.name)}>
          名前の変更
        </button>
        <button
          type="button"
          disabled={!active || scenes.length <= 1}
          title={scenes.length <= 1 ? '最後のシーンは削除できない' : undefined}
          onClick={() => active && dispatch(removeSceneCommand(active.id))}
        >
          削除
        </button>
        <span className="spacer" />
        <button
          type="button"
          aria-label="上へ"
          disabled={index <= 0}
          onClick={() => active && dispatch(moveSceneCommand(active.id, index - 1))}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label="下へ"
          disabled={index < 0 || index >= scenes.length - 1}
          onClick={() => active && dispatch(moveSceneCommand(active.id, index + 1))}
        >
          ↓
        </button>
      </div>
      <PanelSections panelId={SCENE_PANEL} />
    </div>
  );
}
