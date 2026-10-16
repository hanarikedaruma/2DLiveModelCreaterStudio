import { registerCanvasTool, registerPanel } from '../../../shell/api';
import { createEnvSlot } from '../canvas/env';
import { imagePartAt } from '../canvas/parts';
import { meshTarget } from '../mesh/meshTool';
import { CURVE_TOOL_ID, createCurveEditor } from './curveTool';
import { makeCurvePanel } from './CurvePanel';

export const CURVE_PICK_PROMPT = '流れ線で曲げる髪などの画像パーツを、キャンバスでクリックして選ぶ';

export const curveToolEnv = createEnvSlot();
export const curveEditor = createCurveEditor(curveToolEnv);
const CurvePanel = makeCurvePanel(curveToolEnv, curveEditor);
export function register(): void {
  // 画像パーツを選ぶまでは、枠が案内の帯とクリックでの選択を受け持つ（ツールの押したときの処理は変えない）
  registerCanvasTool({
    ...curveEditor.tool,
    target: {
      prompt: CURVE_PICK_PROMPT,
      has: (project, editor) => meshTarget(project.model, editor.selectedPartIds) !== null,
      pick: (project, deformed, p) => imagePartAt(project.model, deformed, p),
    },
  });
  registerPanel({
    id: 'curveGuide',
    mode: 'modeling',
    area: 'right',
    title: '流れ線',
    order: 41,
    component: CurvePanel,
    // 流線で曲げるツールの設定なので、そのツールのときだけ出す（ツールのパレット）
    object: { kind: 'tool', when: ({ activeToolId }) => activeToolId === CURVE_TOOL_ID },
    info: 'curveGuide',
  });
}
