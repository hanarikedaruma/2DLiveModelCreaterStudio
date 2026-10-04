// 「パーツの設定」のワープのセクション（詳細モード）。グループを選んだときに [ワープを追加]・[ワープを削除] と
// ワープ編集ツールへの切り替えを出す。表示中のあいだ、ワープ編集ツールに services とダイアログを渡す
import { useEffect, useState, type FC } from 'react';
import { useCanvas, useDialogs, useEditor, useProject, useServices } from '../../../shell/api';
import { useBindEnv, type EnvSlot } from '../canvas/env';
import {
  WARP_DIVISIONS,
  addWarpCommand,
  descendantImageBounds,
  groupPart,
  removeWarpCommand,
  removeWarpMessage,
  warpKeyCount,
  warpOfPart,
} from './warpOps';
import { WARP_TOOL_ID, type WarpEditor } from './warpTool';
import './warp.css';

const DIVISION_OPTIONS = Array.from(
  { length: WARP_DIVISIONS.max - WARP_DIVISIONS.min + 1 },
  (_, i) => WARP_DIVISIONS.min + i,
);

function DivisionSelect(props: { label: string; value: number; onChange(v: number): void }) {
  return (
    <label className="warp-division">
      <span>{props.label}</span>
      <select aria-label={props.label} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))}>
        {DIVISION_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

export function makeWarpSection(slot: EnvSlot, editor: WarpEditor): FC {
  return function WarpSection() {
    useBindEnv(slot);
    const { store } = useServices();
    const project = useProject();
    const [state] = useEditor();
    const dialogs = useDialogs();
    const { activeToolId, setActiveTool, requestRedraw } = useCanvas();
    const [columns, setColumns] = useState<number>(WARP_DIVISIONS.initial);
    const [rows, setRows] = useState<number>(WARP_DIVISIONS.initial);
    // 別のプロジェクトを開いたら（とセクションを出し直したら）制御点の選択を外す
    useEffect(() => editor.clearSelection(), [project.id]);

    const ids = state.selectedPartIds;
    const group = ids.length === 1 ? groupPart(project.model, ids[0]) : null;
    const warp = group ? warpOfPart(project.model, group.id) : undefined;
    const canAdd = group !== null && !warp && descendantImageBounds(project, group.id) !== null;
    const active = activeToolId === WARP_TOOL_ID;

    const add = () => {
      if (!group) return;
      const before = store.get();
      store.dispatch(addWarpCommand(group.id, columns, rows));
      if (store.get() !== before) setActiveTool(WARP_TOOL_ID);
    };

    const remove = async () => {
      if (!warp) return;
      const keys = warpKeyCount(store.get().model, warp.id);
      if (keys > 0 && !(await dialogs.confirm(removeWarpMessage(keys)))) return;
      store.dispatch(removeWarpCommand(warp.id));
      editor.clearSelection();
      requestRedraw();
    };

    return (
      <div className="warp-section">
        <h3 className="warp-heading">ワープ</h3>
        {!group ? (
          <p className="warp-hint">グループを選ぶと、子パーツをまとめて曲げるワープを付けられる</p>
        ) : warp ? (
          <>
            <p className="warp-info" data-testid="warp-info">
              格子 {warp.columns}×{warp.rows}（制御点 {warp.points.length}）
            </p>
            {active ? (
              <p className="warp-hint">
                制御点をドラッグで移動、何も無い所からのドラッグで矩形選択（Shift で追加）。Esc で選択を外す
              </p>
            ) : (
              <button type="button" className="warp-activate" onClick={() => setActiveTool(WARP_TOOL_ID)}>
                ワープ編集ツールにする
              </button>
            )}
            <div className="warp-buttons">
              <button type="button" onClick={() => void remove()}>
                ワープを削除
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="warp-divisions">
              <DivisionSelect label="横の分割" value={columns} onChange={setColumns} />
              <DivisionSelect label="縦の分割" value={rows} onChange={setRows} />
            </div>
            <div className="warp-buttons">
              <button type="button" disabled={!canAdd} onClick={add}>
                ワープを追加
              </button>
            </div>
            {!canAdd && <p className="warp-hint">子に画像パーツが無いので、ワープを付けられない</p>}
          </>
        )}
      </div>
    );
  };
}
