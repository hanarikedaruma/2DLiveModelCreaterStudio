// カード20: パーツ構造・描画順・マスクの設定。register() で枠（shell/api.ts）に部品を登録する
import { registerPanel } from '../../../shell/api';
import { MaskPanel, PART_SETTINGS_PANEL_ID } from './MaskPanel';
import { PartsPanel } from './PartsPanel';

export { PART_SETTINGS_PANEL_ID } from './MaskPanel';
export { setPngFlipper, flipPngHorizontally, type PngFlipper } from './mirrorCopy';

export const PARTS_PANEL_ID = 'structure.parts';

export function register(): void {
  registerPanel({
    id: PARTS_PANEL_ID,
    mode: 'modeling',
    area: 'left',
    title: 'パーツ',
    order: 20,
    component: PartsPanel,
  });
  registerPanel({
    id: PART_SETTINGS_PANEL_ID,
    mode: 'modeling',
    area: 'right',
    title: 'パーツの設定',
    order: 30,
    component: MaskPanel,
  });
}
