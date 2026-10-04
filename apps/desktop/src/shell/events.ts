// アプリイベント（名前と任意の値）。部品どうしが直接参照せずに知らせ合うのに使う
const listeners = new Map<string, Set<(payload: unknown) => void>>();

export function emitAppEvent(name: string, payload?: unknown): void {
  const set = listeners.get(name);
  if (!set) return;
  for (const l of [...set]) l(payload);
}

export function onAppEvent(name: string, listener: (payload: unknown) => void): () => void {
  let set = listeners.get(name);
  if (!set) {
    set = new Set();
    listeners.set(name, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(name);
  };
}
