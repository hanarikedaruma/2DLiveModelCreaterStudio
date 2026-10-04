// 背景の色の文字列を、乗算していない 0..1 の [r, g, b, a] にする（WebGL のレンダラーの resolveCssColor と同じ読み方）。
// #rgb・#rgba・#rrggbb・#rrggbbaa・rgb()・rgba()・transparent は自分で読み、ほかの書き方（色の名前・hsl() など）はブラウザに読ませる。
// 読めない色は透明にする
export type Rgba = readonly [number, number, number, number];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function channel(text: string, scale: number): number | null {
  const n = parseFloat(text);
  if (!Number.isFinite(n)) return null;
  return clamp01(text.endsWith('%') ? n / 100 : n / scale);
}

export function parseCssColor(text: string): Rgba | null {
  const s = text.trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3,8})$/.exec(s)?.[1];
  if (hex !== undefined) {
    const pairs =
      hex.length === 3 || hex.length === 4
        ? [...hex].map((c) => c + c)
        : hex.length === 6 || hex.length === 8
          ? (hex.match(/../g) ?? [])
          : null;
    if (!pairs) return null;
    const v = pairs.map((c) => parseInt(c, 16) / 255);
    return [v[0]!, v[1]!, v[2]!, v[3] ?? 1];
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(s)?.[1];
  if (fn === undefined) return null;
  const parts = fn.split(/[\s,/]+/).filter((p) => p.length > 0);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const r = channel(parts[0]!, 255);
  const g = channel(parts[1]!, 255);
  const b = channel(parts[2]!, 255);
  const a = parts[3] === undefined ? 1 : channel(parts[3], 1);
  if (r === null || g === null || b === null || a === null) return null;
  return [r, g, b, a];
}

let scratch: { fillStyle: string | CanvasGradient | CanvasPattern } | null | undefined;

function parseWithCanvas(text: string): Rgba | null {
  if (scratch === undefined) {
    try {
      const canvas =
        typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
      scratch =
        (canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null) ?? null;
    } catch {
      scratch = null;
    }
  }
  if (!scratch) return null;
  // fillStyle は読めない値を無視するので、2つの初期値で試して見分ける
  scratch.fillStyle = '#000000';
  scratch.fillStyle = text;
  const first = String(scratch.fillStyle);
  scratch.fillStyle = '#ffffff';
  scratch.fillStyle = text;
  if (String(scratch.fillStyle) !== first) return null;
  return parseCssColor(first);
}

export function cssColorToRgba(text: string): Rgba {
  return parseCssColor(text) ?? parseWithCanvas(text) ?? [0, 0, 0, 0];
}
