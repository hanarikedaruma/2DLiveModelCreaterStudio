// 「パーツの設定」のワープのセクション（詳細モード）。グループを選んだときに [ワープを追加]・[ワープを削除] と
// ワープ編集ツールへの切り替えを出す。表示中のあいだ、ワープ編集ツールに services とダイアログを渡す
import { useEffect, useState, useSyncExternalStore, type FC } from 'react';
import { useCanvas, useDialogs, useEditor, useProject, useServices } from '../../../shell/api';
import { useBindEnv, type EnvSlot } from '../canvas/env';
import { ancestorsOf, partById } from '../canvas/parts';
import { isPreviewOffBase } from '../../../services/keyEditor/common';
import { groupParts } from '../structure/commands';
import { warpGuide } from './warpGuide';
import {
  WARP_DIVISIONS,
  addWarpCommand,
  descendantImageBounds,
  groupPart,
  removeWarpCommand,
  removeWarpMessage,
  refitWarpCommand,
  warpNeedsRefit,
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
    const { store, editor: editorStore } = useServices();
    const project = useProject();
    const [state] = useEditor();
    const dialogs = useDialogs();
    const { activeToolId, setActiveTool, requestRedraw } = useCanvas();
    const [columns, setColumns] = useState<number>(WARP_DIVISIONS.initial);
    const [rows, setRows] = useState<number>(WARP_DIVISIONS.initial);
    const selection = useSyncExternalStore(editor.selection.subscribe, editor.selection.get);
    // 別のプロジェクトを開いたら（とセクションを出し直したら）制御点の選択を外す
    useEffect(() => editor.clearSelection(), [project.id]);

    const ids = state.selectedPartIds;
    const group = ids.length === 1 ? groupPart(project.model, ids[0]) : null;
    const warp = group ? warpOfPart(project.model, group.id) : undefined;
    const offBase = isPreviewOffBase(project.model, state);
    const canAdd = !offBase && group !== null && !warp && descendantImageBounds(project, group.id) !== null;
    const active = activeToolId === WARP_TOOL_ID;
    const image = ids.length === 1 ? partById(project.model, ids[0]!) : undefined;
    const parentGroup =
      image?.kind === 'image' ? ancestorsOf(project.model, image.id).find((p) => p.kind === 'group') : undefined;
    const guide = warpGuide(project, state);

    const add = () => {
      if (!group || !canAdd) return;
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

    const createGroup = () => {
      if (image?.kind !== 'image' || offBase) return;
      const before = store.get();
      store.dispatch(groupParts([image.id], { name: `${image.name}のグループ` }));
      const created = store.get().model.parts.find((p) => !before.model.parts.some((old) => old.id === p.id));
      if (created) editorStore.set({ selectedPartIds: [created.id] });
    };
    const refit = () => {
      if (!warp || offBase) return;
      const command = refitWarpCommand(store.get(), warp.id);
      if (!command) {
        dialogs.notify('範囲を合わせ直せない（格子・キー・子パーツの座標を確認する）');
        return;
      }
      store.dispatch(command);
      editor.clearSelection();
      requestRedraw();
    };

    return (
      <div className="warp-section">
        <h3 className="warp-heading">ワープ</h3>
        {group && <p className="warp-info">対象: {group.name}</p>}
        {guide && (
          <p className="warp-hint" role="note">
            {guide}
          </p>
        )}
        {!group ? (
          <>
            {image?.kind === 'image' &&
              (parentGroup ? (
                <button type="button" onClick={() => editorStore.set({ selectedPartIds: [parentGroup.id] })}>
                  グループ「{parentGroup.name}」を選ぶ
                </button>
              ) : (
                <button type="button" disabled={offBase} onClick={createGroup}>
                  グループを作る
                </button>
              ))}
          </>
        ) : warp ? (
          <>
            <p className="warp-info" data-testid="warp-info">
              格子 {warp.columns}×{warp.rows}（制御点 {warp.points.length}）
            </p>
            {active ? (
              <>
                <p className="warp-info">
                  選んだ制御点:{' '}
                  {selection.warpId === warp.id ? selection.indices.filter((i) => i < warp.points.length).length : 0} 個
                </p>
                <p className="warp-hint">
                  制御点をドラッグで移動、何も無い所からのドラッグで矩形選択（Shift で追加）。Esc
                  で選択を外す。パラメータを編集するとキーに記録する
                </p>
              </>
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
            {warpNeedsRefit(project, warp) && (
              <>
                <p className="warp-hint" role="note">
                  子パーツが格子の範囲の外にある。範囲を広げても、既存のキーと見た目は保つ
                </p>
                <button type="button" disabled={offBase} onClick={refit}>
                  範囲を合わせ直す
                </button>
              </>
            )}
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
          </>
        )}
      </div>
    );
  };
}
