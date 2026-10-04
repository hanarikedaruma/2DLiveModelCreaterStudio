// 素材の一覧（フォルダの折りたたみ・サムネイル・非表示の印・割り当て先）。素材トレイと「素材を差し替え」の選択で使う
import { useMemo, useState, type MouseEvent } from 'react';
import type { Asset, Model } from '@app/schema';
import type { AssetRepository } from '@app/contracts';
import { buildAssetTree, type AssetTreeNode } from './assetTree';
import { findAssignment, layerNameOf } from './commands';
import { beginDrag } from './dnd';
import { AssetThumb } from './thumbnail';
import './assets.css';

export interface AssetListProps {
  assets: readonly Asset[];
  repo: AssetRepository;
  model: Model;
  selectedIds?: ReadonlySet<string>;
  disabledIds?: ReadonlySet<string>;
  onPick(assetId: string, e: MouseEvent): void;
  // 指定するとドラッグ元になる。押した素材から、一緒に運ぶ素材の id を返す
  dragIds?: (assetId: string) => string[];
}

function AssetRow({ asset, props, depth }: { asset: Asset; props: AssetListProps; depth: number }) {
  const name = layerNameOf(asset);
  const assigned = findAssignment(props.model, asset.id);
  const selected = props.selectedIds?.has(asset.id) ?? false;
  const disabled = props.disabledIds?.has(asset.id) ?? false;
  const { dragIds } = props;
  return (
    <li
      className={`asset-row${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
      style={{ paddingLeft: 4 + depth * 12 }}
      data-asset-id={asset.id}
      data-selected={selected || undefined}
      onClick={(e) => {
        if (!disabled) props.onPick(asset.id, e);
      }}
      onPointerDown={
        dragIds
          ? (e) =>
              beginDrag(e, () => {
                const ids = dragIds(asset.id);
                return {
                  payload: { kind: 'assets', assetIds: ids },
                  label: ids.length > 1 ? `素材 ${ids.length} 個` : name,
                };
              })
          : undefined
      }
    >
      <AssetThumb repo={props.repo} assetId={asset.id} alt={name} />
      <span className="asset-name" title={name}>
        {name}
      </span>
      {asset.source.hidden && <span className="am-badge">非表示</span>}
      {assigned && (
        <span className="am-badge assigned" title={`割り当て先: ${assigned.slot.name}`}>
          {assigned.slot.name}
        </span>
      )}
    </li>
  );
}

function Nodes({
  nodes,
  props,
  depth,
  collapsed,
  toggle,
}: {
  nodes: AssetTreeNode[];
  props: AssetListProps;
  depth: number;
  collapsed: ReadonlySet<string>;
  toggle(key: string): void;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === 'asset')
          return <AssetRow key={node.asset.id} asset={node.asset} props={props} depth={depth} />;
        const open = !collapsed.has(node.key);
        return (
          <li key={node.key} className="asset-folder">
            <button
              type="button"
              className="asset-folder-toggle"
              style={{ paddingLeft: 4 + depth * 12 }}
              aria-expanded={open}
              onClick={() => toggle(node.key)}
            >
              <span className="caret" aria-hidden>
                {open ? '▾' : '▸'}
              </span>
              {node.name}
            </button>
            {open && (
              <ul className="asset-list">
                <Nodes nodes={node.children} props={props} depth={depth + 1} collapsed={collapsed} toggle={toggle} />
              </ul>
            )}
          </li>
        );
      })}
    </>
  );
}

export function AssetList(props: AssetListProps) {
  const tree = useMemo(() => buildAssetTree(props.assets), [props.assets]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <ul className="asset-list">
      <Nodes nodes={tree} props={props} depth={0} collapsed={collapsed} toggle={toggle} />
    </ul>
  );
}
