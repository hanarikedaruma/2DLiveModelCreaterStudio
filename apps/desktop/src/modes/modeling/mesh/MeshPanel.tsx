// メッシュのパネル。対象のパーツと頂点・三角形の数、[自動生成]・[選んだ頂点を削除] を出す
import { useEffect, useSyncExternalStore, type FC } from 'react';
import { useCanvas, useEditor, useProject } from '../../../shell/api';
import { useBindEnv, type EnvSlot } from '../canvas/env';
import { MESH_TOOL_ID, meshTarget, type MeshEditor } from './meshTool';
import './mesh.css';

export function makeMeshPanel(slot: EnvSlot, editor: MeshEditor): FC {
  return function MeshPanel() {
    useBindEnv(slot);
    const project = useProject();
    const [state] = useEditor();
    const { activeToolId, setActiveTool } = useCanvas();
    const selection = useSyncExternalStore(editor.selection.subscribe, editor.selection.get);
    const target = meshTarget(project.model, state.selectedPartIds);
    const mesh = target?.mesh ?? null;
    const selectedCount =
      mesh && selection.meshId === mesh.id ? selection.indices.filter((i) => i < mesh.vertices.length).length : 0;
    const active = activeToolId === MESH_TOOL_ID;
    // 別のプロジェクトを開いたら（とパネルを出し直したら）頂点の選択を外す
    useEffect(() => editor.clearSelection(), [project.id]);

    return (
      <div className="mesh-panel">
        {target ? (
          <>
            <div className="mesh-target">
              <span className="mesh-name">{target.part.name}</span>
              <span className="mesh-stats" data-testid="mesh-stats">
                {mesh ? `頂点 ${mesh.vertices.length}・三角形 ${mesh.triangles.length}` : 'メッシュはまだ無い'}
              </span>
            </div>
            <div className="mesh-buttons">
              <button type="button" onClick={() => void editor.generate()}>
                自動生成
              </button>
              <button type="button" disabled={selectedCount === 0} onClick={() => void editor.deleteSelected()}>
                選んだ頂点を削除
              </button>
            </div>
          </>
        ) : (
          <p className="mesh-hint">画像パーツを選ぶと、メッシュを編集できる</p>
        )}
        {active ? (
          <p className="mesh-hint">
            頂点をドラッグで移動、何も無い所からのドラッグで矩形選択（Shift で追加）。ダブルクリックで追加、Delete
            で削除
          </p>
        ) : (
          <button type="button" className="mesh-activate" onClick={() => setActiveTool(MESH_TOOL_ID)}>
            メッシュ編集ツールにする
          </button>
        )}
      </div>
    );
  };
}
