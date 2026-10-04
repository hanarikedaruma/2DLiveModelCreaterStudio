// 画面の中のドラッグ&ドロップ（素材トレイ → 枠、パーツの木、描画順）。
// HTML5 の DnD は Tauri（Windows）で dragDropEnabled が有効だと届かないので、pointer イベントで行う。
// 落とし先は pointerup を受けた要素（内側から順に）。最初に受けたものだけが処理する
import { useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';

export type DragPayload =
  | { kind: 'assets'; assetIds: string[] }
  | { kind: 'parts'; partIds: string[] }
  | { kind: 'drawOrder'; partIds: string[] };

export const DRAG_THRESHOLD = 4; // px。これより動かしたらドラッグを始める

interface ActiveDrag {
  payload: DragPayload;
  consumed: boolean;
}

let active: ActiveDrag | null = null;
const listeners = new Set<() => void>();

function setActive(next: ActiveDrag | null) {
  active = next;
  for (const l of [...listeners]) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getPayload = () => active?.payload ?? null;

export function useDragPayload(): DragPayload | null {
  return useSyncExternalStore(subscribe, getPayload);
}

// ---- ドラッグ中に出すラベル ----

let ghost: HTMLDivElement | null = null;

function showGhost(label: string, x: number, y: number) {
  ghost = document.createElement('div');
  ghost.className = 'dnd-ghost';
  ghost.textContent = label;
  document.body.appendChild(ghost);
  moveGhost(x, y);
  document.body.classList.add('dnd-dragging');
}

function moveGhost(x: number, y: number) {
  if (!ghost) return;
  ghost.style.left = `${x + 14}px`;
  ghost.style.top = `${y + 10}px`;
}

function hideGhost() {
  ghost?.remove();
  ghost = null;
  document.body.classList.remove('dnd-dragging');
}

// ドラッグを終えた直後の click（押した要素で離すと起きる）を1回だけ止める
function suppressNextClick() {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
}

// ドラッグ元の onPointerDown から呼ぶ。動かし始めたときに make で中身とラベルを決める（null なら始めない）
export function beginDrag(e: ReactPointerEvent, make: () => { payload: DragPayload; label: string } | null): void {
  if (e.button !== 0) return;
  const target = e.target as Element | null;
  if (target?.closest?.('button, input, select, textarea, [data-no-drag]')) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let started = false;

  const move = (ev: PointerEvent) => {
    if (started) {
      moveGhost(ev.clientX, ev.clientY);
      return;
    }
    if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
    const made = make();
    if (!made) {
      finish();
      return;
    }
    started = true;
    setActive({ payload: made.payload, consumed: false });
    showGhost(made.label, ev.clientX, ev.clientY);
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') finish();
  };
  function finish() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    window.removeEventListener('keydown', key);
    if (!started) return;
    started = false;
    hideGhost();
    setActive(null);
    suppressNextClick();
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
  window.addEventListener('keydown', key);
}

// 行の中のどこに落としたか。rel は行の上端からの割合（0..1。大きさが分からなければ null）
export type RowZone = 'before' | 'into' | 'after';
export function zoneAt(rel: number | null, allowInto: boolean): RowZone {
  if (rel === null) return allowInto ? 'into' : 'after';
  if (allowInto) return rel < 0.25 ? 'before' : rel > 0.75 ? 'after' : 'into';
  return rel < 0.5 ? 'before' : 'after';
}

export function rowZone(e: ReactPointerEvent, allowInto: boolean): RowZone {
  const rect = (e.currentTarget as Element).getBoundingClientRect();
  return zoneAt(rect.height > 0 ? (e.clientY - rect.top) / rect.height : null, allowInto);
}

// 落とし先。zone を省くと、乗っているかどうか（true）だけを返す
export function useDropTarget<Z = true>(options: {
  accepts: (payload: DragPayload) => boolean;
  zone?: (e: ReactPointerEvent) => Z | null;
  onDrop: (payload: DragPayload, zone: Z) => void;
}): {
  over: Z | null;
  handlers: {
    onPointerMove(e: ReactPointerEvent): void;
    onPointerLeave(): void;
    onPointerUp(e: ReactPointerEvent): void;
  };
} {
  const payload = useDragPayload();
  const [over, setOver] = useState<Z | null>(null);
  const zoneOf = (e: ReactPointerEvent): Z | null => (options.zone ? options.zone(e) : (true as Z));
  return {
    over: payload && options.accepts(payload) ? over : null,
    handlers: {
      onPointerMove(e) {
        if (!active || active.consumed || !options.accepts(active.payload)) return;
        const z = zoneOf(e);
        setOver((prev) => (Object.is(prev, z) ? prev : z));
      },
      onPointerLeave() {
        setOver(null);
      },
      onPointerUp(e) {
        setOver(null);
        if (!active || active.consumed || !options.accepts(active.payload)) return;
        const z = zoneOf(e);
        if (z === null) return;
        active.consumed = true;
        options.onDrop(active.payload, z);
      },
    },
  };
}
