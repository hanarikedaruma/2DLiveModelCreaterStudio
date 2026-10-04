// カード18: キャンバス編集（選択・変形・ピボット）と Transform パネル
import { registerCanvasTool, registerPanel } from '../../../shell/api';
import { createEnvSlot } from './env';
import { createSelectTool } from './selectTool';
import { makeTransformPanel } from './TransformPanel';

export { SELECT_TOOL_ID } from './selectTool';

// ツールに services とダイアログを渡す口。Transform パネルが表示中に入れる
export const selectToolEnv = createEnvSlot();
export const selectTool = createSelectTool(selectToolEnv);
const TransformPanel = makeTransformPanel(selectToolEnv);

export function register(): void {
  registerCanvasTool(selectTool.tool); // 最初に登録するので既定のツールになる
  registerPanel({
    id: 'transform',
    mode: 'modeling',
    area: 'right',
    title: 'Transform',
    order: 20,
    component: TransformPanel,
  });
}
