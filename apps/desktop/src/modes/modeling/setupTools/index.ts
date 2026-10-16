// カード42: 自動セットアップの補助（閉じた目の線のなぞり）。register() で枠（shell/api.ts）に部品を登録する。
// 目専用の道具なので、ツールはツールバーに出さず、目のパーツを選んでいる間だけ出る「閉じた目の線」のパレットから使う
import { registerCanvasOverlay, registerCanvasTool, registerPanel } from '../../../shell/api';
import { createEnvSlot } from '../canvas/env';
import { makeClosedLinePanel } from './ClosedLinePanel';
import { selectedEyeSides } from './closedLine';
import { CLOSED_LINE_TOOL_ID, createClosedLineTool } from './closedLineTool';

export { CLOSED_LINE_TOOL_ID } from './closedLineTool';
export { setClosedLine, strokeToLine, closedLineOf, eyeSideOfPart, selectedEyeSides, type EyeSide } from './closedLine';

export const SETUP_TOOLS_PANEL_ID = 'setupTools.closedLine';

// ツールに services とダイアログを渡す口。「閉じた目の線」のパネルが表示中に入れる
export const closedLineEnv = createEnvSlot();
export const closedLineTool = createClosedLineTool(closedLineEnv);
const ClosedLinePanel = makeClosedLinePanel(closedLineEnv, closedLineTool);

export function register(): void {
  registerCanvasTool(closedLineTool.tool);
  registerCanvasOverlay('closed-eye-line', (ctx, view) => closedLineTool.drawSaved(ctx, view));
  registerPanel({
    id: SETUP_TOOLS_PANEL_ID,
    mode: 'modeling',
    area: 'right',
    title: '閉じた目の線',
    order: 55,
    component: ClosedLinePanel,
    object: {
      kind: 'part',
      when: ({ project, editor, activeToolId }) =>
        activeToolId === CLOSED_LINE_TOOL_ID || selectedEyeSides(project.model, editor.selectedPartIds).length > 0,
    },
    info: 'setupTools.closedLine',
  });
}
