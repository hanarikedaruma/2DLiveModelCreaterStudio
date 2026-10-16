// 標準パーツの割り当て（right のパネル）。部位ごとに枠を並べ、素材トレイからのドロップで割り当てる
import type { Asset, Model, Part } from '@app/schema';
import type { Services } from '@app/contracts';
import { useDialogs, useDispatch, useProject, useServices } from '../../../shell/api';
import { assignAssets, runAutoSetup } from './actions';
import { findSlotPart, freeSlotParts, layerNameOf, slotMembers, unassign, type SlotTarget } from './commands';
import { useDropTarget } from './dnd';
import { SLOT_SECTIONS, type SlotDef } from './slots';
import { AssetThumb } from './thumbnail';
import './assets.css';

const acceptsAssets = (p: { kind: string }) => p.kind === 'assets';

function SlotChips({
  model,
  slot,
  target,
  assets,
  services,
}: {
  model: Model;
  slot: Part | undefined;
  target: SlotTarget;
  assets: ReadonlyMap<string, Asset>;
  services: Services;
}) {
  const dispatch = useDispatch();
  const members = slot ? slotMembers(model, slot) : [];
  if (members.length === 0) return <span className="slot-empty">ここに素材をドロップ</span>;
  return (
    <span className="slot-chips">
      {members.map((m) => {
        const asset = m.assetId ? assets.get(m.assetId) : undefined;
        const name = asset ? layerNameOf(asset) : m.name;
        return (
          <span key={m.id} className="slot-chip">
            {m.assetId && <AssetThumb repo={services.assets} assetId={m.assetId} alt={name} />}
            <span className="slot-chip-name" title={name}>
              {name}
            </span>
            <button
              type="button"
              className="am-icon-button"
              aria-label={`「${name}」の割り当てを解除`}
              onClick={() => dispatch(unassign(target, m.assetId ?? undefined))}
            >
              ×
            </button>
          </span>
        );
      })}
    </span>
  );
}

function StandardSlot({ def, model, assets }: { def: SlotDef; model: Model; assets: ReadonlyMap<string, Asset> }) {
  const services = useServices();
  const target: SlotTarget = { kind: 'standard', type: def.type };
  const slot = findSlotPart(model, target);
  const drop = useDropTarget({
    accepts: acceptsAssets,
    onDrop: (p) => {
      if (p.kind === 'assets') assignAssets(services, target, p.assetIds);
    },
  });
  return (
    <li className={`slot${drop.over ? ' over' : ''}${slot ? ' filled' : ''}`} data-slot={def.type} {...drop.handlers}>
      <span className="slot-label">
        {def.label}
        {def.recommended && (
          <span className="star" title="推奨">
            ★
          </span>
        )}
      </span>
      <SlotChips model={model} slot={slot} target={target} assets={assets} services={services} />
    </li>
  );
}

function FreeSlot({ part, model, assets }: { part: Part; model: Model; assets: ReadonlyMap<string, Asset> }) {
  const services = useServices();
  const target: SlotTarget = { kind: 'free', partId: part.id, name: part.name };
  const drop = useDropTarget({
    accepts: acceptsAssets,
    onDrop: (p) => {
      if (p.kind === 'assets') assignAssets(services, target, p.assetIds);
    },
  });
  return (
    <li className={`slot filled${drop.over ? ' over' : ''}`} data-free-slot={part.id} {...drop.handlers}>
      <span className="slot-label">{part.name}</span>
      <SlotChips model={model} slot={part} target={target} assets={assets} services={services} />
    </li>
  );
}

function NewFreeSlot({ assets }: { assets: ReadonlyMap<string, Asset> }) {
  const services = useServices();
  const { prompt } = useDialogs();
  const drop = useDropTarget({
    accepts: acceptsAssets,
    onDrop: (p) => {
      if (p.kind !== 'assets') return;
      const first = p.assetIds[0] ? assets.get(p.assetIds[0]) : undefined;
      void prompt('自由パーツの名前', first ? layerNameOf(first) : '').then((name) => {
        const trimmed = name?.trim();
        if (trimmed) assignAssets(services, { kind: 'free', partId: null, name: trimmed }, p.assetIds);
      });
    },
  });
  return (
    <li className={`slot new-free${drop.over ? ' over' : ''}`} data-slot="free" {...drop.handlers}>
      <span className="slot-label">自由パーツ</span>
      <span className="slot-empty">ここに素材をドロップして名前を入れる</span>
    </li>
  );
}

export function AssignPanel() {
  const services = useServices();
  const project = useProject();
  const { notify } = useDialogs();
  const { model } = project;
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  return (
    <div className="assign-panel">
      {SLOT_SECTIONS.map((section) => (
        <details key={section.id} className="assign-section" open>
          <summary>{section.title}</summary>
          <ul className="slot-list">
            {section.slots.map((def) => (
              <StandardSlot key={def.type} def={def} model={model} assets={assets} />
            ))}
          </ul>
        </details>
      ))}
      <details className="assign-section" open>
        <summary>その他</summary>
        <ul className="slot-list">
          {freeSlotParts(model).map((part) => (
            <FreeSlot key={part.id} part={part} model={model} assets={assets} />
          ))}
          <NewFreeSlot assets={assets} />
        </ul>
      </details>
      <div className="assign-footer">
        <button type="button" className="primary" onClick={() => runAutoSetup(services, notify)}>
          自動セットアップ
        </button>
        <p className="am-dim am-hint">★ は推奨の枠。割り当てたら [自動セットアップ] で動きを付ける</p>
      </div>
    </div>
  );
}
