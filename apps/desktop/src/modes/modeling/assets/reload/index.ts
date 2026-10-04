// カード43: PSD の再読み込み。素材トレイ（assets.tray）の <PanelSections> に [PSD を読み込み直す] を入れる
import { registerPanelSection } from '../../../../shell/api';
import { PsdReloadSection } from './PsdReloadSection';

export { reloadPsd, type ReloadSummary, type ReloadOutcome } from './actions';
export { reloadPsdCommand, RELOAD_LABEL } from './commands';

export const PSD_RELOAD_SECTION_ID = 'assets.psdReload';

export function register(): void {
  registerPanelSection({ id: PSD_RELOAD_SECTION_ID, panelId: 'assets.tray', order: 10, component: PsdReloadSection });
}
