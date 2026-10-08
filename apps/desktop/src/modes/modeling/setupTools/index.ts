// カード42: かんたんセットアップの補助（閉じた目の線のなぞり）。register() で枠（shell/api.ts）に部品を登録する。
// 目専用の道具なので、ツールはツールバーに出さず、目のパーツを選んでいる間だけ出る「閉じた目の線」のパレットから使う
import { registerCanvasTool, registerPanel } from '../../../shell/api';
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
    info: {
      purpose:
        'まばたきで目を閉じたときのまぶたの形を決める。なぞった線に沿って上まぶたが下り、白目と瞳はその線で隠れる。線が無いと、上まぶたがまっすぐ下へ動くだけの閉じ方になる',
      steps: [
        '目のパーツ（白目・上まぶたなど）を選ぶと、このパレットが出る',
        '［閉じた目の線をなぞる］を押し、閉じた目のまつげの線を、目の端から端までドラッグする',
        '［かんたんセットアップで反映］を押す',
        'パラメータの目の開閉を動かして確かめる。直すときは［なぞり直す］。上まぶたと白目を割り当てていないと効かない',
      ],
    },
  });
}
