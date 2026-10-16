import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { registry } from './registry';

export const LAYOUT_SIZES_KEY = 'live2d-studio.layoutSizes';
const LEGACY_HEIGHTS_KEY = 'live2d-studio.panelHeights';
export const clampSize = (value: number, min: number, max: number) => Math.round(Math.max(min, Math.min(max, value)));

function limits(id: string): [number, number] | null {
  if (/^(modeling|animation|studio)\.column\.(left|right)$/.test(id)) return [200, 560];
  if (/^(modeling|animation|studio)\.panel\..+$/.test(id)) return [60, 4000];
  if (/^(modeling|animation|studio)\.bottom\.(height|.+\.width)$/.test(id)) {
    return id.endsWith('.width') ? [200, 4000] : [120, 4000];
  }
  if (id === 'animation.timeline.height') return [120, 4000];
  if (id === 'animation.sliders.width') return [180, 480];
  if (id === 'animation.sliders.height') return [80, 4000];
  return null;
}

function readRecord(key: string): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readSizes(): Record<string, number> {
  const sizes: Record<string, number> = {};
  for (const [id, value] of Object.entries(readRecord(LAYOUT_SIZES_KEY))) {
    const range = limits(id);
    if (range && typeof value === 'number' && Number.isFinite(value)) sizes[id] = clampSize(value, ...range);
  }
  // I-064 の実際に適用していた高さだけを移す。新しい記録がある境目は上書きしない。
  const legacy = readRecord(LEGACY_HEIGHTS_KEY);
  for (const panel of registry.get().panels) {
    const value = legacy[panel.id];
    const id = `${panel.mode}.panel.${panel.id}`;
    if (
      panel.area === 'right' &&
      !panel.object &&
      sizes[id] === undefined &&
      typeof value === 'number' &&
      Number.isFinite(value)
    ) {
      sizes[id] = clampSize(value, 60, 4000);
    }
  }
  return sizes;
}

interface LayoutSizes {
  values: Record<string, number>;
  set(id: string, value: number | null): void;
  reset(): void;
}

const SizesContext = createContext<LayoutSizes | null>(null);

export function LayoutSizesProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState(readSizes);
  // 保存が拒まれても表示は動かす。移行後は古い記録を消し、リセット時に復活させない。
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_SIZES_KEY, JSON.stringify(values));
      localStorage.removeItem(LEGACY_HEIGHTS_KEY);
    } catch {
      // 設定を保存できない環境では、現在の画面だけに適用する。
    }
  }, [values]);
  const set = useCallback((id: string, value: number | null) => {
    const range = limits(id);
    if (!range || (value !== null && !Number.isFinite(value))) return;
    setValues((prev) => {
      const next = { ...prev };
      if (value === null) delete next[id];
      else next[id] = clampSize(value, ...range);
      return next;
    });
  }, []);
  const reset = useCallback(() => setValues({}), []);
  return <SizesContext.Provider value={{ values, set, reset }}>{children}</SizesContext.Provider>;
}

export function useLayoutSizes() {
  const context = useContext(SizesContext);
  if (!context) throw new Error('LayoutSizesProvider が必要');
  return context;
}

// ドラッグ中の見た目だけは、その境目の持ち主に置く。保存は pointerup のときだけ。
export function useResizableSize(id: string) {
  const { values, set } = useLayoutSizes();
  const [preview, setPreview] = useState<number | null>(null);
  useEffect(() => setPreview(null), [id]);
  const commit = (value: number | null) => set(id, value);
  return { value: preview ?? values[id], preview: setPreview, commit };
}

// 両側の列から先に縮める。小さな窓でも中央の領域を残し、記録した希望の幅は変えない。
export function fitColumnWidths(width: number, left: number, right: number): [number, number] {
  const minLeft = left ? 200 : 0;
  const minRight = right ? 200 : 0;
  const budget = Math.max(minLeft + minRight, width - 320);
  const fittedLeft = left ? clampSize(left, minLeft, budget - minRight) : 0;
  return [fittedLeft, right ? clampSize(right, minRight, budget - fittedLeft) : 0];
}

export function useElementSize<T extends HTMLElement>() {
  const [element, ref] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [element]);
  return { ref, ...size };
}
