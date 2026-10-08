// 描画順のタブ。画像パーツの一覧（上が前面）。ドラッグで並び替え。グループを選ぶと、子孫の画像パーツを相対順のまま一緒に動かす
import type { Part } from '@app/schema';
import { useDispatch, useEditor, useProject } from '../../../shell/api';
import { beginDrag, rowZone, useDropTarget } from '../assets/dnd';
import { reorderDrawOrder } from './commands';
import { drawOrderBlock } from './modelOps';
import { clickSelection } from './selection';
import { AxisSwayBadge, FlowSwayBadge } from './ui';
import { flowSwayReason } from '@app/core';
import './structure.css';

function DrawOrderRow({
  part,
  parentName,
  axisSway,
  flowSway,
  inBlock,
  block,
}: {
  part: Part;
  parentName: string | null;
  axisSway: boolean;
  flowSway?: true | string;
  inBlock: boolean;
  block: readonly string[];
}) {
  const dispatch = useDispatch();
  const [editor, setEditor] = useEditor();
  // 上半分に落とすとその前面、下半分なら背面
  const drop = useDropTarget({
    accepts: (p) => p.kind === 'drawOrder',
    zone: (e) => rowZone(e, false),
    onDrop: (p, zone) => {
      if (p.kind === 'drawOrder') dispatch(reorderDrawOrder(p.partIds, part.id, zone === 'before' ? 'front' : 'back'));
    },
  });
  const classes = [
    'draw-order-row',
    inBlock ? 'selected' : '',
    part.visible ? '' : 'hidden-part',
    drop.over ? `drop-${drop.over}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <li
      className={classes}
      role="option"
      data-part-id={part.id}
      aria-selected={inBlock}
      onClick={(e) =>
        setEditor({
          selectedPartIds: clickSelection(editor.selectedPartIds, part.id, e.ctrlKey || e.metaKey || e.shiftKey),
        })
      }
      onPointerDown={(e) =>
        beginDrag(e, () => {
          const ids = inBlock ? [...block] : [part.id];
          return {
            payload: { kind: 'drawOrder', partIds: ids },
            label: ids.length > 1 ? `パーツ ${ids.length} 個` : part.name,
          };
        })
      }
      {...drop.handlers}
    >
      <span className="part-name" title={part.name}>
        {part.name}
      </span>
      {axisSway && <AxisSwayBadge name={part.name} />}
      {flowSway && <FlowSwayBadge name={part.name} reason={typeof flowSway === 'string' ? flowSway : undefined} />}
      {parentName && <span className="am-dim parent-name">{parentName}</span>}
    </li>
  );
}

export function DrawOrderTab() {
  const project = useProject();
  const { model } = project;
  const [editor, setEditor] = useEditor();
  const byId = new Map(model.parts.map((p) => [p.id, p]));
  const axisSwayPartIds = new Set(project.physics.map((item) => item.partId));
  const flowSwayParts = new Map(
    (model.curveGuides ?? [])
      .filter((g) => g.dynamics?.enabled)
      .map((g) => [g.partId, flowSwayReason(project, g) ?? true] as const),
  );
  const block = drawOrderBlock(model, editor.selectedPartIds);
  const blockSet = new Set(block);
  const rows = [...model.drawOrder]
    .reverse()
    .map((id) => byId.get(id))
    .filter((p): p is Part => p !== undefined && p.kind === 'image');
  const groups = model.parts.filter((p) => p.kind === 'group');
  const only = editor.selectedPartIds.length === 1 ? byId.get(editor.selectedPartIds[0]!) : undefined;
  const selectedGroup = only?.kind === 'group' ? only.id : '';
  return (
    <div className="draw-order-tab">
      {groups.length > 0 && (
        <label className="draw-order-group">
          <span>グループで選ぶ</span>
          <select
            aria-label="グループで選ぶ"
            value={selectedGroup}
            onChange={(e) => setEditor({ selectedPartIds: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">（選ばない）</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {rows.length === 0 ? (
        <p className="am-dim">画像パーツはまだ無い</p>
      ) : (
        <>
          <ol className="draw-order-list" role="listbox" aria-label="描画順" aria-multiselectable>
            {rows.map((part) => (
              <DrawOrderRow
                key={part.id}
                part={part}
                parentName={part.parentId ? (byId.get(part.parentId)?.name ?? null) : null}
                axisSway={axisSwayPartIds.has(part.id)}
                flowSway={flowSwayParts.get(part.id)}
                inBlock={blockSet.has(part.id)}
                block={block}
              />
            ))}
          </ol>
          <p className="am-dim am-hint">上が前面。ドラッグで並び替える。グループを選ぶと子孫をまとめて動かす</p>
        </>
      )}
    </div>
  );
}
