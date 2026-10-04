// カード29: ワープ（グループへの格子のワープの追加・削除と、制御点を動かすワープ編集ツール）
import { registerCanvasTool, registerPanelSection } from '../../../shell/api';
import { createEnvSlot } from '../canvas/env';
import { PART_SETTINGS_PANEL_ID } from '../structure';
import { makeWarpSection } from './WarpSection';
import { createWarpEditor } from './warpTool';

export { WARP_TOOL_ID } from './warpTool';

// ツールに services とダイアログを渡す口。「パーツの設定」のワープのセクションが表示中に入れる
export const warpToolEnv = createEnvSlot();
export const warpEditor = createWarpEditor(warpToolEnv);
const WarpSection = makeWarpSection(warpToolEnv, warpEditor);

export function register(): void {
  registerCanvasTool(warpEditor.tool);
  registerPanelSection({
    id: 'modeling.warp',
    panelId: PART_SETTINGS_PANEL_ID,
    order: 40,
    level: 'detail',
    component: WarpSection,
  });
}
