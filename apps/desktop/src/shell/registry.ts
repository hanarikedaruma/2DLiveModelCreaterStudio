// 差し込み口の登録先。モジュールの読み込み時に register* で登録し、画面は useRegistry で読む。
// 同じ id で登録し直すと置き換える（開発中の HMR で二重に並ばないように）。
import type { FC } from 'react';
import type { ModeId, UiLevel } from '@app/schema';
import type { ViewTransform } from '@app/contracts';
import type { CanvasTool, MenuItem, PanelDef, SectionDef } from './api';

export type OverlayDraw = (ctx: CanvasRenderingContext2D, view: ViewTransform) => void;

export interface RegistrySnapshot {
  panels: PanelDef[];
  sections: SectionDef[];
  centers: Partial<Record<'studio' | 'animation', FC>>;
  setupScreen: FC | null;
  menuItems: MenuItem[];
  tools: CanvasTool[];
  overlays: { id: string; draw: OverlayDraw }[];
}

function empty(): RegistrySnapshot {
  return { panels: [], sections: [], centers: {}, setupScreen: null, menuItems: [], tools: [], overlays: [] };
}

let snapshot = empty();
const listeners = new Set<() => void>();

function update(fn: (s: RegistrySnapshot) => RegistrySnapshot) {
  snapshot = fn(snapshot);
  for (const l of [...listeners]) l();
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  const out = list.slice();
  out[i] = item;
  return out;
}

export const registry = {
  get: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  addPanel: (def: PanelDef) => update((s) => ({ ...s, panels: upsert(s.panels, def) })),
  addSection: (def: SectionDef) => update((s) => ({ ...s, sections: upsert(s.sections, def) })),
  setCenter: (mode: 'studio' | 'animation', component: FC) =>
    update((s) => ({ ...s, centers: { ...s.centers, [mode]: component } })),
  setSetupScreen: (component: FC) => update((s) => ({ ...s, setupScreen: component })),
  addMenuItem: (item: MenuItem) => update((s) => ({ ...s, menuItems: upsert(s.menuItems, item) })),
  addTool: (tool: CanvasTool) => update((s) => ({ ...s, tools: upsert(s.tools, tool) })),
  addOverlay: (id: string, draw: OverlayDraw) => update((s) => ({ ...s, overlays: upsert(s.overlays, { id, draw }) })),
  // テスト用。登録をすべて消す
  reset: () => update(() => empty()),
};

// level が 'detail' のものは uiLevel が 'detail' のときだけ、'easy' のものは 'easy' のときだけ出す。'both'（省略）は常に出す
export function visibleAt(level: 'easy' | 'detail' | 'both' | undefined, uiLevel: UiLevel): boolean {
  return level === undefined || level === 'both' || level === uiLevel;
}

export function byOrder<T extends { order?: number }>(items: T[]): T[] {
  // order が同じなら登録順
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (a.item.order ?? 0) - (b.item.order ?? 0) || a.i - b.i)
    .map((x) => x.item);
}

export function panelsFor(s: RegistrySnapshot, mode: ModeId, area: PanelDef['area'], uiLevel: UiLevel): PanelDef[] {
  return byOrder(s.panels.filter((p) => p.mode === mode && p.area === area && visibleAt(p.level, uiLevel)));
}
