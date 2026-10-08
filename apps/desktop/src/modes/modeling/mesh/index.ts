// カード21: メッシュ編集（ワイヤーフレーム・頂点の移動・追加・削除・自動生成）
// カード28: 変形の細かさ（「パーツの設定」のセクション）と、形を変えたときの変形の転写
import { registerCanvasTool, registerPanel, registerPanelSection } from '../../../shell/api';
import { createEnvSlot } from '../canvas/env';
import { PART_SETTINGS_PANEL_ID } from '../structure';
import { makeDensitySection } from './DensitySection';
import { MESH_TOOL_ID, createMeshEditor } from './meshTool';
import { makeMeshPanel } from './MeshPanel';

export { MESH_TOOL_ID } from './meshTool';
export { TRANSFER_CONFIRM_MESSAGE } from './remesh';

export const MESH_DENSITY_SECTION_ID = 'modeling.meshDensity';

// ツールに services とダイアログを渡す口。メッシュのパネルが表示中に入れる
export const meshToolEnv = createEnvSlot();
export const meshEditor = createMeshEditor(meshToolEnv);
const MeshPanel = makeMeshPanel(meshToolEnv, meshEditor);
const DensitySection = makeDensitySection(meshEditor);

export function register(): void {
  registerCanvasTool(meshEditor.tool);
  registerPanel({
    id: 'mesh',
    mode: 'modeling',
    area: 'right',
    title: 'メッシュ',
    order: 40,
    component: MeshPanel,
    // メッシュ編集ツールの設定なので、そのツールのときだけ出す（ツールのパレット）
    object: { kind: 'tool', when: ({ activeToolId }) => activeToolId === MESH_TOOL_ID },
    info: {
      purpose:
        '画像パーツに網（メッシュ）を張り、頂点を動かして形を細かく曲げる。パラメータを編集中なら、その値のキーに記録する',
      steps: [
        'キャンバスで画像パーツをクリックして選ぶ',
        'メッシュが無ければ［自動生成］',
        '頂点をドラッグして動かす。何も無い所からのドラッグで囲んで選ぶ（Shift で追加）',
        'ダブルクリックで頂点を追加、Delete で削除',
        '右クリックで選択を外し、別のパーツを選ぶ',
      ],
    },
  });
  registerPanelSection({
    id: MESH_DENSITY_SECTION_ID,
    panelId: PART_SETTINGS_PANEL_ID,
    order: 20,
    component: DensitySection,
  });
}
