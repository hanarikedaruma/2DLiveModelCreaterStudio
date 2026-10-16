// カード29: ワープ（グループへの格子のワープの追加・削除と、制御点を動かすワープ編集ツール）。
// ワープの設定は、ワープ編集ツールのときだけ右の列の上に出る「ワープ」のパレット（ツールのパレット）に置く
import { createElement } from 'react';
import { PanelSections, registerCanvasTool, registerPanel, registerPanelSection } from '../../../shell/api';
import { createEnvSlot } from '../canvas/env';
import { makeWarpSection } from './WarpSection';
import { WARP_TOOL_ID, createWarpEditor } from './warpTool';

export { WARP_TOOL_ID } from './warpTool';

export const WARP_PANEL_ID = 'warp';
export const WARP_SECTION_ID = 'modeling.warp';

// ツールに services とダイアログを渡す口。ワープのパレットが表示中に入れる
export const warpToolEnv = createEnvSlot();
export const warpEditor = createWarpEditor(warpToolEnv);
const WarpSection = makeWarpSection(warpToolEnv, warpEditor);
const WarpPanel = () => createElement(PanelSections, { panelId: WARP_PANEL_ID });

export function register(): void {
  registerCanvasTool(warpEditor.tool);
  registerPanel({
    id: WARP_PANEL_ID,
    mode: 'modeling',
    area: 'right',
    title: 'ワープ',
    order: 42,

    component: WarpPanel,
    object: { kind: 'tool', when: ({ activeToolId }) => activeToolId === WARP_TOOL_ID },
    info: 'warp',
  });
  registerPanelSection({ id: WARP_SECTION_ID, panelId: WARP_PANEL_ID, component: WarpSection });
}
