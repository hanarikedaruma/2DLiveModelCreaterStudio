// left のパネル。「パーツ構造」と「描画順」の2つのタブ
import { useState } from 'react';
import { DrawOrderTab } from './DrawOrderTab';
import { StructureTab } from './StructureTab';
import './structure.css';

const TABS = [
  { id: 'structure', label: 'パーツ構造' },
  { id: 'drawOrder', label: '描画順' },
] as const;

export function PartsPanel() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('structure');
  return (
    <div className="parts-panel">
      <div className="parts-tabs" role="tablist" aria-label="パーツ">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'active' : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{tab === 'structure' ? <StructureTab /> : <DrawOrderTab />}</div>
    </div>
  );
}
