// パーツ構造のタブ。ツリーのドラッグで親の変更と兄弟の並び替え（drawOrder は変えない）、表示・ロック・名前の変更、右クリックのメニュー
import { useCallback, useRef, useState, type MouseEvent } from 'react';
import type { Model, Part } from '@app/schema';
import type { Command } from '@app/contracts';
import { useDialogs, useDispatch, useEditor, useProject, useServices } from '../../../shell/api';
import { AssetList } from '../assets/AssetList';
import { beginDrag, rowZone, useDropTarget, type RowZone } from '../assets/dnd';
import {
  addedRootIds,
  canMoveTo,
  copyParts,
  deleteParts,
  groupParts,
  moveParts,
  renamePart,
  setPartLocked,
  setPartVisible,
  treeTargetFor,
} from './commands';
import { runMirrorCopy } from './mirrorCopy';
import { childrenOf } from './modelOps';
import { replaceAsset } from './replaceAsset';
import { clickSelection, contextTargets, pruneSelection } from './selection';
import { ContextMenu, EyeIcon, LockIcon, PickerDialog, type MenuEntry } from './ui';

interface Row {
  part: Part;
  depth: number;
}

// 開いているグループの中だけをたどって行にする
export function treeRows(model: Model, collapsed: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const part of childrenOf(model, parentId)) {
      if (seen.has(part.id)) continue;
      seen.add(part.id);
      rows.push({ part, depth });
      if (part.kind === 'group' && !collapsed.has(part.id)) walk(part.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

const acceptsParts = (p: { kind: string }) => p.kind === 'parts';

function RenameInput({ part, onDone }: { part: Part; onDone(name: string | null): void }) {
  const [text, setText] = useState(part.name);
  // Enter・Escape のあとに外れたとき（blur）にもう一度呼ばない
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      className="part-rename"
      aria-label="パーツの名前"
      value={text}
      autoFocus
      onChange={(e) => setText(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(text);
        if (e.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(text)}
    />
  );
}

function TreeRow({
  row,
  model,
  selected,
  open,
  renaming,
  onSelect,
  onToggle,
  onMenu,
  onStartRename,
  onRename,
  dragIds,
}: {
  row: Row;
  model: Model;
  selected: boolean;
  open: boolean;
  renaming: boolean;
  onSelect(e: MouseEvent): void;
  onToggle(): void;
  onMenu(e: MouseEvent): void;
  onStartRename(): void;
  onRename(name: string | null): void;
  dragIds(): string[];
}) {
  const dispatch = useDispatch();
  const { part, depth } = row;
  const isGroup = part.kind === 'group';
  const drop = useDropTarget<RowZone>({
    accepts: acceptsParts,
    zone: (e) => rowZone(e, isGroup),
    onDrop: (p, zone) => {
      if (p.kind !== 'parts') return;
      const target = treeTargetFor(model, p.partIds, part.id, zone);
      if (target) dispatch(moveParts(p.partIds, target));
    },
  });
  const classes = [
    'tree-row',
    selected ? 'selected' : '',
    part.visible ? '' : 'hidden-part',
    drop.over ? `drop-${drop.over}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={isGroup ? open : undefined}
      data-part-id={part.id}
      className={classes}
      style={{ paddingLeft: 4 + depth * 14 }}
      onClick={onSelect}
      onContextMenu={onMenu}
      onDoubleClick={(e) => {
        e.preventDefault();
        onStartRename();
      }}
      onPointerDown={(e) =>
        beginDrag(e, () => {
          const ids = dragIds();
          return {
            payload: { kind: 'parts', partIds: ids },
            label: ids.length > 1 ? `パーツ ${ids.length} 個` : part.name,
          };
        })
      }
      {...drop.handlers}
    >
      {isGroup ? (
        <button
          type="button"
          className="tree-caret"
          aria-label={open ? 'グループを閉じる' : 'グループを開く'}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {open ? '▾' : '▸'}
        </button>
      ) : (
        <span className="tree-caret" aria-hidden />
      )}
      {renaming ? (
        <RenameInput part={part} onDone={onRename} />
      ) : (
        <span className="part-name" title={part.name}>
          {part.name}
        </span>
      )}
      <button
        type="button"
        className="part-toggle"
        aria-label="表示"
        aria-pressed={part.visible}
        title={part.visible ? '表示中（押すと隠す）' : '非表示（押すと表示する）'}
        onClick={(e) => {
          e.stopPropagation();
          dispatch(setPartVisible(part.id, !part.visible));
        }}
      >
        <EyeIcon off={!part.visible} />
      </button>
      <button
        type="button"
        className="part-toggle"
        aria-label="ロック"
        aria-pressed={part.locked}
        title={part.locked ? 'ロック中（押すと外す）' : 'ロックする'}
        onClick={(e) => {
          e.stopPropagation();
          dispatch(setPartLocked(part.id, !part.locked));
        }}
      >
        <LockIcon locked={part.locked} />
      </button>
    </li>
  );
}

export function StructureTab() {
  const services = useServices();
  const project = useProject();
  const { model } = project;
  const dispatch = useDispatch();
  const dialogs = useDialogs();
  const [editor, setEditor] = useEditor();
  const selected = editor.selectedPartIds;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const [picker, setPicker] = useState<{ kind: 'parent' | 'asset'; ids: string[] } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const rows = treeRows(model, collapsed);
  const rootDrop = useDropTarget({
    accepts: acceptsParts,
    zone: (e) => (e.target === e.currentTarget ? true : null),
    onDrop: (p) => {
      if (p.kind === 'parts') dispatch(moveParts(p.partIds, { parentId: null, beforeId: null }));
    },
  });

  // コマンドを実行し、増えたパーツを選ぶ（無ければ選択から消えたものを外す）
  const runAndSelect = (command: Command) => {
    const before = services.store.get().model;
    dispatch(command);
    afterChange(before);
  };
  const afterChange = (before: Model) => {
    const after = services.store.get().model;
    const added = addedRootIds(before, after);
    const current = services.editor.get().selectedPartIds;
    const next = added.length > 0 ? added : pruneSelection(current, new Set(after.parts.map((p) => p.id)));
    if (next !== current) setEditor({ selectedPartIds: [...next] });
  };

  const entries = (ids: string[]): MenuEntry[] => {
    const single = ids.length === 1 ? model.parts.find((p) => p.id === ids[0]) : undefined;
    return [
      { label: 'コピー', run: () => runAndSelect(copyParts(ids)) },
      {
        label: '左右反転コピー',
        run: () => {
          const before = services.store.get().model;
          void runMirrorCopy(services, ids, dialogs.notify).then((ok) => {
            if (ok) afterChange(before);
          });
        },
      },
      { label: 'グループ化', run: () => runAndSelect(groupParts(ids)) },
      { label: '親を変更…', run: () => setPicker({ kind: 'parent', ids }) },
      {
        label: '素材を差し替え…',
        disabled: !single || single.kind !== 'image' || project.assets.length === 0,
        run: () => setPicker({ kind: 'asset', ids }),
      },
      { label: '削除', danger: true, run: () => runAndSelect(deleteParts(ids)) },
    ];
  };

  const pickerPart = picker?.kind === 'asset' ? model.parts.find((p) => p.id === picker.ids[0]) : undefined;

  return (
    <div className="structure-tab">
      <ul
        className={`part-tree${rootDrop.over ? ' drop-root' : ''}`}
        role="tree"
        aria-label="パーツ構造"
        aria-multiselectable
        {...rootDrop.handlers}
      >
        {rows.map((row) => (
          <TreeRow
            key={row.part.id}
            row={row}
            model={model}
            selected={selected.includes(row.part.id)}
            open={!collapsed.has(row.part.id)}
            renaming={renaming === row.part.id}
            onSelect={(e) =>
              setEditor({
                selectedPartIds: clickSelection(selected, row.part.id, e.ctrlKey || e.metaKey || e.shiftKey),
              })
            }
            onToggle={() =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(row.part.id)) next.delete(row.part.id);
                else next.add(row.part.id);
                return next;
              })
            }
            onMenu={(e) => {
              e.preventDefault();
              const ids = contextTargets(selected, row.part.id);
              if (!selected.includes(row.part.id)) setEditor({ selectedPartIds: ids });
              setMenu({ x: e.clientX, y: e.clientY, ids });
            }}
            onStartRename={() => setRenaming(row.part.id)}
            onRename={(name) => {
              setRenaming(null);
              const trimmed = name?.trim();
              if (trimmed && trimmed !== row.part.name) dispatch(renamePart(row.part.id, trimmed));
            }}
            dragIds={() => contextTargets(selected, row.part.id)}
          />
        ))}
      </ul>
      {rows.length === 0 && <p className="am-dim">パーツはまだ無い（素材を標準パーツの枠へ割り当てる）</p>}
      {rows.length > 0 && (
        <p className="am-dim am-hint">ドラッグで親の変更・並び替え。ダブルクリックで名前の変更、右クリックでメニュー</p>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} entries={entries(menu.ids)} onClose={closeMenu} />}

      {picker?.kind === 'parent' && (
        <PickerDialog title="親を変更" onClose={() => setPicker(null)}>
          <ul className="picker-list">
            {[null, ...model.parts.filter((p) => p.kind === 'group' && canMoveTo(model, picker.ids, p.id))].map(
              (parent) => (
                <li key={parent?.id ?? '(root)'}>
                  <button
                    type="button"
                    onClick={() => {
                      const ids = picker.ids;
                      setPicker(null);
                      dispatch(moveParts(ids, { parentId: parent?.id ?? null, beforeId: null }));
                    }}
                  >
                    {parent ? parent.name : '（いちばん上）'}
                  </button>
                </li>
              ),
            )}
          </ul>
        </PickerDialog>
      )}

      {picker?.kind === 'asset' && pickerPart && (
        <PickerDialog title="差し替える素材を選ぶ" onClose={() => setPicker(null)}>
          <AssetList
            assets={project.assets}
            repo={services.assets}
            model={model}
            disabledIds={new Set(pickerPart.assetId ? [pickerPart.assetId] : [])}
            onPick={(assetId) => {
              setPicker(null);
              void replaceAsset(services, dialogs, pickerPart.id, assetId);
            }}
          />
        </PickerDialog>
      )}
    </div>
  );
}
