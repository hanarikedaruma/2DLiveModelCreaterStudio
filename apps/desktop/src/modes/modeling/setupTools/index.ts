// カード42: かんたんセットアップの補助（閉じた目の線のなぞり）。register() で枠（shell/api.ts）に部品を登録する
import { registerCanvasTool, registerPanel } from '../../../shell/api';
import { createEnvSlot } from '../canvas/env';
import { makeClosedLinePanel } from './ClosedLinePanel';
import { createClosedLineTool } from './closedLineTool';

export { CLOSED_LINE_TOOL_ID } from './closedLineTool';
export { setClosedLine, strokeToLine, closedLineOf, type EyeSide } from './closedLine';

export const SETUP_TOOLS_PANEL_ID = 'setupTools.closedLine';

// ツールに services とダイアログを渡す口。「閉じた目の線」のパネルが表示中に入れる
export const closedLineEnv = createEnvSlot();
export const closedLineTool = createClosedLineTool(closedLineEnv);
const ClosedLinePanel = makeClosedLinePanel(closedLineEnv, closedLineTool);

export function register(): void {
  registerCanvasTool(closedLineTool.tool);
  registerPanel({
    id: SETUP_TOOLS_PANEL_ID,
    mode: 'modeling',
    area: 'right',
    title: '閉じた目の線',
    order: 55, // 「標準パーツの割り当て」（50）の次
    component: ClosedLinePanel,
  });
}
