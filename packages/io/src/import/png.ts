// PNG の復号と符号化（fast-png）。どの色の形式も 8bit RGBA にそろえる
import { convertIndexedToRgb, decode, encode, type DecodedPng } from 'fast-png';
import type { RgbaImage } from './rgba';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function hasPngSignature(data: Uint8Array): boolean {
  return data.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => data[i] === b);
}

export function decodePng(data: Uint8Array): RgbaImage {
  const png = decode(data);
  return png.palette ? fromIndexed(png) : fromSamples(png);
}

export function encodePng(image: RgbaImage): Uint8Array {
  return encode({ width: image.width, height: image.height, data: image.data, depth: 8, channels: 4 });
}

// パレットの色（RGB か RGBA）を展開する
function fromIndexed(png: DecodedPng): RgbaImage {
  const { width, height } = png;
  const colors = convertIndexedToRgb(png);
  const step = colors.length / (width * height);
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = colors[i * step]!;
    out[i * 4 + 1] = colors[i * step + 1]!;
    out[i * 4 + 2] = colors[i * step + 2]!;
    out[i * 4 + 3] = step === 4 ? colors[i * step + 3]! : 255;
  }
  return { width, height, data: out };
}

// グレー・グレー+アルファ・RGB・RGBA（1〜16bit）を展開する。tRNS の色は透明にする
function fromSamples(png: DecodedPng): RgbaImage {
  const { width, height, channels, depth } = png;
  if (channels === 4 && depth === 8) {
    return { width, height, data: Uint8Array.from(png.data) };
  }
  const sample = sampleReader(png);
  const max = (1 << depth) - 1;
  const to8 = (v: number): number => Math.round((v * 255) / max);
  const key = png.transparency && png.transparency.length > 0 ? png.transparency : null;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (channels <= 2) {
        const g = sample(x, y, 0);
        const g8 = to8(g);
        out[o] = g8;
        out[o + 1] = g8;
        out[o + 2] = g8;
        out[o + 3] = channels === 2 ? to8(sample(x, y, 1)) : key && key[0] === g ? 0 : 255;
      } else {
        const r = sample(x, y, 0);
        const g = sample(x, y, 1);
        const b = sample(x, y, 2);
        out[o] = to8(r);
        out[o + 1] = to8(g);
        out[o + 2] = to8(b);
        if (channels === 4) out[o + 3] = to8(sample(x, y, 3));
        else out[o + 3] = key && key[0] === r && key[1] === g && key[2] === b ? 0 : 255;
      }
    }
  }
  return { width, height, data: out };
}

// (x, y) の c 番目の値を元のビット数のまま返す。8bit 未満は行ごとに詰めてある
function sampleReader(png: DecodedPng): (x: number, y: number, c: number) => number {
  const { width, channels, depth, data } = png;
  if (depth >= 8) return (x, y, c) => data[(y * width + x) * channels + c]!;
  const rowBytes = Math.ceil((width * channels * depth) / 8);
  const mask = (1 << depth) - 1;
  return (x, y, c) => {
    const bit = (x * channels + c) * depth;
    const byte = data[y * rowBytes + (bit >> 3)]!;
    return (byte >> (8 - depth - (bit & 7))) & mask;
  };
}
