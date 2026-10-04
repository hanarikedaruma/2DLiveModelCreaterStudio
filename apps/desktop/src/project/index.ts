// プロジェクトの操作をメニューに入れる（カード23）
import type { Services } from '@app/contracts';
import { setProjectDirResolver, writePendingBackgrounds } from '../modes/studio';
import { appDataDirPath, isTauri, pickFolderWithDialog } from '../platform/tauri';
import { onAppEvent, registerMenuItem } from '../shell/api';
import type { Dialogs } from '../shell/dialogs';
import type { EnvironmentStore } from '../shell/environment';
import { createProjectActions, PROJECT_LOADED, type ProjectActions, type ProjectPlatform } from './actions';
import { connectStep1Params } from './step1Params'; // カード34
import { connectStep2Params } from './step2Params'; // カード53
import { connectStandardBreath } from '../modes/studio/periodic/commands'; // カード48

export { PROJECT_LOADED, type ProjectActions } from './actions';

// Tauri ではダイアログとアプリのデータのフォルダ、ブラウザでの開発中は入力欄とメモリのファイルシステムを使う
function platformFor(dialogs: Dialogs): ProjectPlatform {
  return {
    pickFolder: isTauri()
      ? pickFolderWithDialog
      : (title) => dialogs.prompt(`${title}（ブラウザでの確認用。メモリの中に保存する）`, '/projects/sample'),
    unsavedRoot: async () => (isTauri() ? `${await appDataDirPath()}/unsaved` : '/unsaved'),
    writePendingBackgrounds,
  };
}

export function registerProject(services: Services, environment: EnvironmentStore, dialogs: Dialogs): ProjectActions {
  // カード34: STEP1 の標準パラメータを足す。起動時のプロジェクトにも足すので、変更の有無の基準（actions）を作る前に呼ぶ
  connectStep1Params(services.store);
  // カード53: STEP2 の標準パラメータ（呼吸・腕・髪揺れ）も同じく足す。同じ理由で actions を作る前に呼ぶ
  connectStep2Params(services.store);
  connectStandardBreath(services.store);
  onAppEvent(PROJECT_LOADED, () => services.physics.reset());
  const actions = createProjectActions({ services, environment, dialogs, platform: platformFor(dialogs) });
  setProjectDirResolver(() => actions.dir());
  const run = (task: () => Promise<unknown>) => () => {
    task().catch((e) => dialogs.notify(`失敗した: ${e instanceof Error ? e.message : String(e)}`));
  };
  registerMenuItem({ id: 'project.new', label: '新規', shortcut: 'Ctrl+N', run: run(actions.newProject) });
  registerMenuItem({ id: 'project.open', label: '開く…', shortcut: 'Ctrl+O', run: run(() => actions.open()) });
  registerMenuItem({ id: 'project.save', label: '保存', shortcut: 'Ctrl+S', run: run(actions.save) });
  registerMenuItem({
    id: 'project.saveAs',
    label: '名前を付けて保存…',
    shortcut: 'Ctrl+Shift+S',
    run: run(() => actions.saveAs()),
  });
  return actions;
}
