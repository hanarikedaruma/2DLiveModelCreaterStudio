// 永続的な選択と、押している間だけの選択を分ける。本物と仮実装で同じ所有規則を使う。
export function createExpressionSelection() {
  let order = 0;
  const base = new Map<string, number>();
  const held = new Map<string, { id: string | null; mode: 'stack' | 'single'; order: number; suppressed: boolean }>();

  function ids(): string[] {
    const holds = [...held.values()].filter((h) => !h.suppressed);
    if (holds.some((h) => h.id === null)) return [];
    const single = holds.filter((h) => h.mode === 'single').sort((a, b) => b.order - a.order)[0];
    const entries = single ? new Map([[single.id!, single.order]]) : new Map(base);
    for (const h of holds) {
      if (h.mode !== 'stack' || (single && h.order <= single.order)) continue;
      if (!entries.has(h.id!)) entries.set(h.id!, h.order);
    }
    return [...entries].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  }

  return {
    ids,
    apply(id: string | null) {
      held.clear();
      base.clear();
      if (id !== null) base.set(id, ++order);
    },
    toggle(id: string) {
      if (ids().includes(id)) {
        base.delete(id);
        for (const h of held.values()) if (h.id === id) h.suppressed = true;
      } else base.set(id, ++order);
    },
    hold(owner: string, id: string | null, mode: 'stack' | 'single') {
      if (held.has(owner)) return;
      const existing =
        mode === 'stack' && id !== null
          ? (base.get(id) ?? [...held.values()].find((h) => h.id === id && !h.suppressed)?.order)
          : undefined;
      held.set(owner, { id, mode, order: existing ?? ++order, suppressed: false });
    },
    release(owner: string) {
      held.delete(owner);
    },
  };
}
