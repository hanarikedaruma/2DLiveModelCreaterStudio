// 線形予測（LPC）でフォルマントを求めるための計算（カード51）。どれも純粋な関数。
// 低域通過して間引く → 直流を除く → 高域強調 → ハミング窓 → 自己相関 → Levinson-Durbin → 多項式の根 → 周波数と帯域幅

export interface Formant {
  frequency: number; // Hz
  bandwidth: number; // Hz
}

const lowpassCache = new Map<number, Float64Array>();

// 1/factor に間引くための低域通過の係数（ハミング窓をかけた sinc。間引いたあとのナイキスト周波数の 90% で切る）。
// 直流の利得は 1
export function lowpassTaps(factor: number): Float64Array {
  const cached = lowpassCache.get(factor);
  if (cached) return cached;
  const length = 8 * factor + 1;
  const half = (length - 1) / 2;
  const cutoff = (0.5 / factor) * 0.9; // 元のサンプリング周波数に対する比
  const taps = new Float64Array(length);
  let sum = 0;
  for (let j = 0; j < length; j++) {
    const t = j - half;
    const sinc = t === 0 ? 1 : Math.sin(2 * Math.PI * cutoff * t) / (2 * Math.PI * cutoff * t);
    const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * j) / (length - 1));
    taps[j] = sinc * window;
    sum += taps[j]!;
  }
  for (let j = 0; j < length; j++) taps[j]! /= sum;
  lowpassCache.set(factor, taps);
  return taps;
}

// 低域通過してから factor サンプルに1つ取り出す（範囲の外は 0 とみなす）。factor が 1 以下なら写すだけ
export function decimate(samples: ArrayLike<number>, factor: number): Float64Array {
  if (!(factor > 1)) return Float64Array.from(samples);
  const taps = lowpassTaps(factor);
  const half = (taps.length - 1) / 2;
  const n = Math.floor(samples.length / factor);
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const center = k * factor;
    let acc = 0;
    const from = Math.max(0, half - center);
    const to = Math.min(taps.length, samples.length - center + half);
    for (let j = from; j < to; j++) acc += taps[j]! * samples[center - half + j]!;
    out[k] = acc;
  }
  return out;
}

// 直流（平均）を除き、高域強調（y[n] = x[n] - α x[n-1]）してからハミング窓をかける（その場で書き換える）
export function prepareFrame(x: Float64Array, preEmphasis: number): Float64Array {
  const n = x.length;
  if (n === 0) return x;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i]!;
  mean /= n;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i]! - mean;
    x[i] = v - preEmphasis * prev;
    prev = v;
  }
  if (n === 1) return x;
  for (let i = 0; i < n; i++) x[i]! *= 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
  return x;
}

// 自己相関 r[0..order]
export function autocorrelation(x: ArrayLike<number>, order: number): Float64Array {
  const r = new Float64Array(order + 1);
  for (let k = 0; k <= order; k++) {
    let acc = 0;
    for (let i = k; i < x.length; i++) acc += x[i]! * x[i - k]!;
    r[k] = acc;
  }
  return r;
}

// Levinson-Durbin。A(z) = 1 + a1 z^-1 + … + ap z^-p の係数 [1, a1, …, ap] を返す。解けないとき（無音など）は null
export function levinsonDurbin(r: ArrayLike<number>, order: number): Float64Array | null {
  const r0 = r[0] ?? 0;
  if (!(r0 > 0) || r.length < order + 1) return null;
  const a = new Float64Array(order + 1);
  const prev = new Float64Array(order + 1);
  a[0] = 1;
  let error = r0;
  for (let i = 1; i <= order; i++) {
    let acc = r[i]!;
    for (let j = 1; j < i; j++) acc += a[j]! * r[i - j]!;
    const k = -acc / error;
    if (!Number.isFinite(k) || Math.abs(k) >= 1) return null;
    prev.set(a);
    for (let j = 1; j < i; j++) a[j] = prev[j]! + k * prev[i - j]!;
    a[i] = k;
    error *= 1 - k * k;
    if (!(error > 0)) return null;
  }
  return a;
}

// 最高次の係数が 1 の多項式 z^p + c1 z^(p-1) + … + cp（coeffs = [1, c1, …, cp]）の根（Durand-Kerner 法）
export function polynomialRoots(coeffs: ArrayLike<number>, maxIterations = 500): { re: number; im: number }[] {
  const p = coeffs.length - 1;
  if (p < 1) return [];
  const re = new Float64Array(p);
  const im = new Float64Array(p);
  // 初期値は (0.4 + 0.9i)^k（どの根とも対称にならない点）
  let zr = 1;
  let zi = 0;
  for (let k = 0; k < p; k++) {
    const nr = zr * 0.4 - zi * 0.9;
    zi = zr * 0.9 + zi * 0.4;
    zr = nr;
    re[k] = zr;
    im[k] = zi;
  }
  for (let iter = 0; iter < maxIterations; iter++) {
    let maxDelta = 0;
    for (let i = 0; i < p; i++) {
      const xr = re[i]!;
      const xi = im[i]!;
      // 多項式の値（ホーナー法）
      let pr = 1;
      let pi = 0;
      for (let j = 1; j <= p; j++) {
        const nr = pr * xr - pi * xi + coeffs[j]!;
        pi = pr * xi + pi * xr;
        pr = nr;
      }
      // ほかの根との差の積
      let dr = 1;
      let di = 0;
      for (let j = 0; j < p; j++) {
        if (j === i) continue;
        const ar = xr - re[j]!;
        const ai = xi - im[j]!;
        const nr = dr * ar - di * ai;
        di = dr * ai + di * ar;
        dr = nr;
      }
      const den = dr * dr + di * di;
      if (!(den > 0)) {
        // 根が重なったら少しずらす
        re[i] = xr + 1e-6;
        im[i] = xi + 1e-6;
        maxDelta = Math.max(maxDelta, 1e-6);
        continue;
      }
      const qr = (pr * dr + pi * di) / den;
      const qi = (pi * dr - pr * di) / den;
      re[i] = xr - qr;
      im[i] = xi - qi;
      maxDelta = Math.max(maxDelta, Math.hypot(qr, qi));
    }
    if (maxDelta < 1e-12) break;
  }
  return Array.from({ length: p }, (_, k) => ({ re: re[k]!, im: im[k]! }));
}

// LPC の包絡 1/|A(e^jω)|² の、周波数 frequency（Hz）での強さ（dB。大きさの基準は任意なので、比べるのに使う）。
// preEmphasis（prepareFrame に渡した α）を渡すと、高域強調 1 - α z^-1 で持ち上げた分を戻した強さにする
export function lpcEnvelopeDb(a: ArrayLike<number>, frequency: number, sampleRate: number, preEmphasis = 0): number {
  const w = (2 * Math.PI * frequency) / sampleRate;
  let re = 0;
  let im = 0;
  for (let k = 0; k < a.length; k++) {
    re += a[k]! * Math.cos(w * k);
    im -= a[k]! * Math.sin(w * k);
  }
  const emphasis = 1 + preEmphasis * preEmphasis - 2 * preEmphasis * Math.cos(w); // |1 - α e^-jω|²
  const power = (re * re + im * im) * emphasis;
  return power > 0 ? -10 * Math.log10(power) : Infinity;
}

// LPC の係数の根から、上半面の根の周波数と帯域幅を求める（周波数の小さい順）
export function lpcResonances(a: ArrayLike<number>, sampleRate: number): Formant[] {
  const out: Formant[] = [];
  for (const root of polynomialRoots(a)) {
    if (!(root.im > 1e-9)) continue;
    const magnitude = Math.hypot(root.re, root.im);
    if (!(magnitude > 0) || !Number.isFinite(magnitude)) continue;
    out.push({
      frequency: (Math.atan2(root.im, root.re) * sampleRate) / (2 * Math.PI),
      bandwidth: (-Math.log(magnitude) * sampleRate) / Math.PI,
    });
  }
  return out.sort((x, y) => x.frequency - y.frequency);
}
