// 背景の色の文字列を読む。値は 0..1 の [r, g, b, a]（乗算していない）
export type Rgba = [number, number, number, number];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// rgb() の成分。数（0..255）か百分率
function channel(text: string): number | null {
  const n = parseFloat(text);
  if (!Number.isFinite(n)) return null;
  return clamp01(text.endsWith('%') ? n / 100 : n / 255);
}

// アルファの成分。数（0..1）か百分率
function alphaChannel(text: string): number | null {
  const n = parseFloat(text);
  if (!Number.isFinite(n)) return null;
  return clamp01(text.endsWith('%') ? n / 100 : n);
}

// #rgb・#rgba・#rrggbb・#rrggbbaa・rgb()・rgba()・transparent を読む。読めなければ null
export function parseCssColor(text: string): Rgba | null {
  const s = text.trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3,8})$/.exec(s)?.[1];
  if (hex !== undefined) {
    if (hex.length === 3 || hex.length === 4) {
      const v = [...hex].map((c) => parseInt(c + c, 16) / 255);
      return [v[0]!, v[1]!, v[2]!, v[3] ?? 1];
    }
    if (hex.length === 6 || hex.length === 8) {
      const v = (hex.match(/../g) ?? []).map((c) => parseInt(c, 16) / 255);
      return [v[0]!, v[1]!, v[2]!, v[3] ?? 1];
    }
    return null;
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(s)?.[1];
  if (fn !== undefined) {
    const parts = fn.split(/[\s,/]+/).filter((p) => p.length > 0);
    if (parts.length !== 3 && parts.length !== 4) return null;
    const r = channel(parts[0]!);
    const g = channel(parts[1]!);
    const b = channel(parts[2]!);
    const a = parts[3] === undefined ? 1 : alphaChannel(parts[3]);
    if (r === null || g === null || b === null || a === null) return null;
    return [r, g, b, a];
  }
  return null;
}

let scratch: { fillStyle: string | CanvasGradient | CanvasPattern } | null = null;

// ブラウザに読ませる（色の名前・hsl() など）。fillStyle は読めない値を無視するので、2つの初期値で試して見分ける
function parseWithCanvas(text: string): Rgba | null {
  if (!scratch) {
    const canvas =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    scratch = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!scratch) return null;
  }
  scratch.fillStyle = '#000000';
  scratch.fillStyle = text;
  const first = String(scratch.fillStyle);
  scratch.fillStyle = '#ffffff';
  scratch.fillStyle = text;
  if (String(scratch.fillStyle) !== first) return null;
  return parseCssColor(first);
}

const warned = new Set<string>();
let last: { text: string; rgba: Rgba } | null = null;

// 色を読む。読めない色は透明にして、1回だけ console.warn する
export function resolveCssColor(text: string): Rgba {
  if (last?.text === text) return last.rgba;
  let rgba = parseCssColor(text) ?? parseWithCanvas(text);
  if (!rgba) {
    if (!warned.has(text)) {
      warned.add(text);
      console.warn(`背景の色を読めないので透明にした: ${text}`);
    }
    rgba = [0, 0, 0, 0];
  }
  last = { text, rgba };
  return rgba;
}
