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
    // 線で曲げるツールの設定なので、そのツールのときだけ出す（ツールのパレット）
    object: { kind: 'tool', when: ({ activeToolId }) => activeToolId === CURVE_TOOL_ID },
    info: {
      purpose:
        '髪などを一本の線で滑らかに曲げる。重力に沿わせ、選んだ対象だけ流れ揺れをONにすると遅れと余韻が付く。パーツの設定の軸揺れとも併用できる',
      steps: [
        'キャンバスで髪のパーツをクリックして選ぶ（先にメッシュを自動生成しておく）',
        '［流れ線を描く］を押し、根元から毛先へドラッグ',
        '中間・毛先の点をドラッグして形を整える',
        '必要なら［重力に沿わせる］を有効にし、影響幅と頭について回る区間を調整する',
        '揺らしたい対象だけ［流れ線で揺らす］をONにし、［動きを試す］で確かめる',
        '右クリックで選択を外し、別のパーツを選ぶ',
      ],
    },
  });
}
