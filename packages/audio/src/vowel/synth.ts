// テスト用: フォルマントを持つ母音の音を合成する（カード51）。
// 声帯の音のかわりに基本周波数 f0 のパルス列を -6dB/oct の傾きにして、フォルマントごとの2次の共振（Klatt）に通す。
// 実効値を rmsDb（dBFS）に合わせ、わずかな雑音を足す（乱数は seed で決まる）

export interface SynthFormant {
  frequency: number;
  bandwidth: number;
}

export interface SynthVowelOptions {
  sampleRate: number;
  durationMs: number;
  f0: number;
  formants: SynthFormant[];
  rmsDb?: number; // 既定 -20
  noiseDb?: number; // 雑音の実効値（dBFS）。既定 -70
  seed?: number;
  vibrato?: number; // 基本周波数のゆれ（割合）。既定 0.01
}

// 0..1 の擬似乱数（mulberry32）
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function synthVowel(o: SynthVowelOptions): Float32Array {
  const n = Math.round((o.sampleRate * o.durationMs) / 1000);
  const random = seededRandom(o.seed ?? 1);
  const vibrato = o.vibrato ?? 0.01;
  const buffer = new Float64Array(n);
  // パルス列（位相が 1 を超えるたびに 1）。基本周波数をゆっくりゆらす
  let phase = 0.999;
  let source = 0;
  for (let i = 0; i < n; i++) {
    const f0 = o.f0 * (1 + vibrato * Math.sin((2 * Math.PI * 5 * i) / o.sampleRate));
    phase += f0 / o.sampleRate;
    let pulse = 0;
    if (phase >= 1) {
      phase -= 1;
      pulse = 1;
    }
    source = pulse + 0.97 * source; // -6dB/oct の傾き
    buffer[i] = source;
  }
  // フォルマントの共振を直列につなぐ（直流の利得 1）
  for (const f of o.formants) {
    const t = 1 / o.sampleRate;
    const c = -Math.exp(-2 * Math.PI * f.bandwidth * t);
    const b = 2 * Math.exp(-Math.PI * f.bandwidth * t) * Math.cos(2 * Math.PI * f.frequency * t);
    const a = 1 - b - c;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < n; i++) {
      const y = a * buffer[i]! + b * y1 + c * y2;
      y2 = y1;
      y1 = y;
      buffer[i] = y;
    }
  }
  // 直流を除いて実効値を合わせ、雑音を足す
  let mean = 0;
  for (let i = 0; i < n; i++) mean += buffer[i]!;
  mean /= Math.max(1, n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    buffer[i]! -= mean;
    sum += buffer[i]! * buffer[i]!;
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  const gain = rms > 0 ? 10 ** ((o.rmsDb ?? -20) / 20) / rms : 0;
  const noise = 10 ** ((o.noiseDb ?? -70) / 20) * Math.sqrt(3); // 一様乱数 [-1, 1) の実効値は 1/√3
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buffer[i]! * gain + noise * (2 * random() - 1);
  return out;
}

// 母音ごとの合成の条件（成人の男性・女性の代表的なフォルマント）
export const SYNTH_VOWELS = {
  male: {
    f0: 120,
    a: [780, 1200],
    i: [290, 2250],
    u: [330, 1300],
    e: [480, 1850],
    o: [480, 830],
  },
  female: {
    f0: 220,
    a: [950, 1500],
    i: [340, 2800],
    u: [380, 1600],
    e: [580, 2350],
    o: [560, 1000],
  },
} as const;

// 第1・第2フォルマントと、ふつうの第3・第4フォルマントを持つ母音
export function synthFormants(f1: number, f2: number): SynthFormant[] {
  const f3 = Math.max(2700, f2 + 500);
  return [
    { frequency: f1, bandwidth: 70 },
    { frequency: f2, bandwidth: 100 },
    { frequency: f3, bandwidth: 150 },
    { frequency: Math.max(3700, f3 + 700), bandwidth: 200 },
  ];
}
