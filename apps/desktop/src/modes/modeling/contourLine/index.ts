// I-068: 輪郭線で整える（輪郭のように折れてほしくない所に線を引き、線の点でメッシュを滑らかに変形する）
import { registerCanvasTool, registerPanel } from '../../../shell/api';
import { createEnvSlot } from '../canvas/env';
import { CONTOUR_TOOL_ID, createContourEditor } from './contourTool';
import { makeContourPanel } from './ContourPanel';

export { CONTOUR_TOOL_ID } from './contourTool';

// ツールに services とダイアログを渡す口。輪郭線のパレットが表示中に入れる
export const contourToolEnv = createEnvSlot();
export const contourEditor = createContourEditor(contourToolEnv);
const ContourPanel = makeContourPanel(contourToolEnv, contourEditor);

export function register(): void {
  registerCanvasTool(contourEditor.tool);
  registerPanel({
    id: 'contourLine',
    mode: 'modeling',
    area: 'right',
    title: '輪郭線',
    order: 42,
    component: ContourPanel,
    // 輪郭線で整えるツールの設定なので、そのツールのときだけ出す（ツールのパレット）
    object: { kind: 'tool', when: ({ activeToolId }) => activeToolId === CONTOUR_TOOL_ID },
    info: {
      purpose:
        '輪郭のように折れてほしくない所に線を引き、線の点を動かしてメッシュを滑らかに変形する。動きは今のキー（基準状態なら基準の形）に記録する',
      steps: [
        'キャンバスで画像パーツをクリックして選ぶ（先にメッシュを自動生成しておく）',
        '［線を引く］を押し、輪郭をなぞる',
        '［線に沿って頂点を足す］を押す',
        'パラメータの値を選び、線の点をドラッグする',
        '段々が残っているキーは［線に合わせて整える］を押す',
      ],
    },
  });
}
