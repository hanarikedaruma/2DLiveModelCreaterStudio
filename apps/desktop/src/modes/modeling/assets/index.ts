// カード17: 素材トレイと標準パーツの割り当て。register() で枠（shell/api.ts）に部品を登録する
import { onAppEvent, registerPanel, registerSetupScreen } from '../../../shell/api';
import { AssetTray } from './AssetTray';
import { AssignPanel } from './AssignPanel';
import { SetupScreen } from './SetupScreen';
import { clearAllImportWarnings } from './warnings';

// 結合（カード23）や通しのテストから使う操作
export { importAssetFiles, assignAssets, runAutoSetup, meshForAsset } from './actions';
export { addAssets, assign, unassign, findAssignment, type SlotTarget } from './commands';

export const ASSET_TRAY_PANEL_ID = 'assets.tray';
export const ASSIGN_PANEL_ID = 'assets.assign';

let listening = false;

export function register(): void {
  registerSetupScreen(SetupScreen);
  // 新規・開くのあと（カード23 が出す）に、前の取り込みの警告を消す
  if (!listening) {
    listening = true;
    onAppEvent('projectLoaded', clearAllImportWarnings);
  }
  registerPanel({
    id: ASSET_TRAY_PANEL_ID,
    mode: 'modeling',
    area: 'left',
    title: '素材',
    order: 10,
    component: AssetTray,
  });
  registerPanel({
    id: ASSIGN_PANEL_ID,
    mode: 'modeling',
    area: 'right',
    title: '標準パーツの割り当て',
    order: 50,
    component: AssignPanel,
  });
}
