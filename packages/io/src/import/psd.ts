// PSD のレイヤーを読む（ag-psd）。キャンバスを使わず ImageData の形で受け取る
import {
  getCompositeImageData,
  getLayerImageData,
  initializeCanvas,
  readPsd,
  type BlendMode as PsdBlendMode,
  type Layer,
  type LayerEffectsInfo,
  type PixelData,
} from 'ag-psd';
import type { BlendMode } from '@app/schema';
import { clipToBase, mergeClipped, type ClipLayer } from './clipping';
import type { RgbaImage, Size } from './rgba';

export function hasPsdSignature(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x38 && data[1] === 0x42 && data[2] === 0x50 && data[3] === 0x53; // '8BPS'
}

// ラスタレイヤー1枚。image はレイヤーの矩形の画素（無ければ null）。
// クリッピングされたレイヤーはクリップ先に統合してある（カード32。非表示のものはクリップ先で切り抜いた別の1枚）
export interface PsdRasterLayer {
  name: string | null; // レイヤーの無い PSD の統合画像は null
  path: string[]; // 親のグループ名（外側から）
  left: number;
  top: number;
  image: RgbaImage | null;
  opacity: number; // グループの不透明度も掛けたもの
  hidden: boolean; // 親のグループが非表示でも true
  blendMode: BlendMode;
}

// 統合が必要なレイヤーやグループ。layerIndexes はその影響を受けるラスタレイヤーの番号
export interface PsdMergeTarget {
  name: string;
  reasons: string[];
  layerIndexes: number[];
}

export interface PsdDocument {
  canvas: Size;
  layers: PsdRasterLayer[]; // 背面 → 前面
  mergeTargets: PsdMergeTarget[];
}

const BLEND_MODES: Partial<Record<PsdBlendMode, BlendMode>> = {
  normal: 'normal',
  'pass through': 'normal',
  multiply: 'multiply',
  screen: 'screen',
  'linear dodge': 'add',
};

const BLEND_MODE_NAMES: Partial<Record<PsdBlendMode, string>> = {
  multiply: '乗算',
  screen: 'スクリーン',
  'linear dodge': '覆い焼き（リニア）- 加算',
};

export function toBlendMode(mode: PsdBlendMode | undefined): BlendMode {
  return (mode && BLEND_MODES[mode]) ?? 'normal';
}

export function readPsdDocument(data: Uint8Array): PsdDocument {
  prepareAgPsd();
  // 画素は後から1枚ずつ取り出す（メモリを抑える）
  const psd = readPsd(data, {
    useRawData: true,
    useImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
    skipLinkedFilesData: true,
  });
  const canvas = { width: psd.width, height: psd.height };
  const layers: PsdRasterLayer[] = [];
  const mergeTargets: PsdMergeTarget[] = [];

  const addReasons = (name: string, reasons: string[], layerIndexes: number[]): void => {
    if (reasons.length > 0) mergeTargets.push({ name, reasons, layerIndexes });
  };

  // ラスタレイヤーを1枚足し、統合が必要な理由 reasons を記録して、その番号を返す
  const pushLayer = (
    layer: Layer,
    path: string[],
    image: RgbaImage | null,
    parentOpacity: number,
    parentHidden: boolean,
    reasons: string[],
  ): number => {
    const index = layers.length;
    layers.push({
      name: layer.name ?? '',
      path,
      left: layer.left ?? 0,
      top: layer.top ?? 0,
      image,
      opacity: parentOpacity * (layer.opacity ?? 1) * (layer.fillOpacity ?? 1),
      hidden: parentHidden || layer.hidden === true,
      blendMode: toBlendMode(layer.blendMode),
    });
    addReasons(layer.name ?? '', reasons, [index]);
    return index;
  };

  // 画素を取り出したら元のデータは捨てる
  const takeImage = (layer: Layer): RgbaImage | null => {
    const image = toRgba8(getLayerImageData(layer));
    delete layer.rawData;
    return image;
  };

  // extraReasons は統合できなかったクリッピングなど、レイヤーの外から足す理由
  const visit = (
    layer: Layer,
    path: string[],
    parentOpacity: number,
    parentHidden: boolean,
    extraReasons: string[] = [],
  ): void => {
    if (!layer.children) {
      pushLayer(layer, path, takeImage(layer), parentOpacity, parentHidden, [
        ...extraReasons,
        ...mergeReasons(layer, false),
      ]);
      return;
    }
    // グループ。不透明度と非表示は中のレイヤーへ引き継ぐ
    const name = layer.name ?? '';
    const first = layers.length;
    const hidden = parentHidden || layer.hidden === true;
    visitList(layer.children, [...path, name], parentOpacity * (layer.opacity ?? 1), hidden);
    addReasons(name, [...extraReasons, ...mergeReasons(layer, true)], range(first, layers.length));
  };

  // クリップ先 base と、その上に続くクリッピングされたレイヤー clipped（背面 → 前面）。
  // 表示しているものはクリップ先に重ねて1枚にし（名前・合成モード・不透明度はクリップ先のもの）、
  // 非表示のものはクリップ先のアルファで切り抜いた別の素材にする（hidden）。
  // グループが混ざる・クリップ先に画素が無いときは統合できないので、別々に取り込んで needsMerge にする
  const visitClipping = (
    base: Layer,
    clipped: Layer[],
    path: string[],
    parentOpacity: number,
    parentHidden: boolean,
  ): void => {
    const baseImage = base.children ? null : takeImage(base);
    if (!baseImage || clipped.some((l) => l.children)) {
      if (base.children) visit(base, path, parentOpacity, parentHidden);
      else pushLayer(base, path, baseImage, parentOpacity, parentHidden, mergeReasons(base, false));
      for (const layer of clipped) visit(layer, path, parentOpacity, parentHidden, ['クリッピング']);
      return;
    }
    const placedBase = { left: base.left ?? 0, top: base.top ?? 0, image: baseImage };
    const merged: Layer[] = []; // 統合したレイヤー（理由は統合した素材に付ける）
    const sources: ClipLayer[] = [];
    const separate: { layer: Layer; image: RgbaImage }[] = [];
    for (const layer of clipped) {
      const image = takeImage(layer);
      if (layer.hidden === true && image) {
        separate.push({ layer, image });
        continue;
      }
      merged.push(layer);
      if (!image || layer.hidden === true) continue; // 画素の無いレイヤー（調整レイヤーなど）は理由だけ見る
      sources.push({
        left: layer.left ?? 0,
        top: layer.top ?? 0,
        image,
        opacity: (layer.opacity ?? 1) * (layer.fillOpacity ?? 1),
        blendMode: toBlendMode(layer.blendMode),
      });
    }
    const image = sources.length > 0 ? mergeClipped(placedBase, sources) : baseImage;
    const index = pushLayer(base, path, image, parentOpacity, parentHidden, mergeReasons(base, false));
    for (const layer of merged) addReasons(layer.name ?? '', mergeReasons(layer, false), [index]);
    for (const { layer, image: own } of separate) {
      const cut = clipToBase(placedBase, { left: layer.left ?? 0, top: layer.top ?? 0, image: own });
      pushLayer(layer, path, cut, parentOpacity, parentHidden, mergeReasons(layer, false));
    }
  };

  // 同じ階層のレイヤーの並び（背面 → 前面）。clipping のレイヤーは、すぐ下のクリッピングでないレイヤーにまとめる
  // （いちばん下のレイヤーの clipping は Photoshop と同じく無視する）
  const visitList = (list: Layer[], path: string[], parentOpacity: number, parentHidden: boolean): void => {
    for (let i = 0; i < list.length;) {
      const base = list[i]!;
      let end = i + 1;
      while (end < list.length && list[end]!.clipping === true) end++;
      if (end === i + 1) visit(base, path, parentOpacity, parentHidden);
      else visitClipping(base, list.slice(i + 1, end), path, parentOpacity, parentHidden);
      i = end;
    }
  };

  visitList(psd.children ?? [], [], 1, false);
  if (layers.some((l) => l.image)) return { canvas, layers, mergeTargets };

  // 画素のあるレイヤーが無い PSD（背景だけの PSD など）は統合画像を1枚として読む
  const composite = readPsd(data, {
    useRawData: true,
    useImageData: true,
    skipLayerImageData: true,
    skipThumbnail: true,
    skipLinkedFilesData: true,
  });
  return {
    canvas,
    layers: [
      {
        name: null,
        path: [],
        left: 0,
        top: 0,
        image: toRgba8(getCompositeImageData(composite)),
        opacity: 1,
        hidden: false,
        blendMode: 'normal',
      },
    ],
    mergeTargets: mergeTargets.map((t) => ({ ...t, layerIndexes: [] })),
  };
}

// 統合が必要な理由（対応していない合成モード・調整レイヤー・レイヤー効果・スマートオブジェクト・マスク）。
// クリッピングは取り込みで統合するので、ここでは挙げない。乗算・スクリーン・覆い焼き（リニア）は素材の合成モードに引き継ぐ。
// グループは中のレイヤーに分けて取り込むので、グループの合成モード（通常・通過以外）は引き継げない
export function mergeReasons(layer: Layer, isGroup: boolean): string[] {
  const reasons: string[] = [];
  const mode = layer.blendMode ?? 'normal';
  const supported = isGroup ? mode === 'normal' || mode === 'pass through' : BLEND_MODES[mode] !== undefined;
  if (!supported) reasons.push(`合成モード: ${BLEND_MODE_NAMES[mode] ?? mode}`);
  if (layer.adjustment) reasons.push('調整レイヤー');
  if (hasActiveEffects(layer.effects)) reasons.push('レイヤー効果');
  if (layer.placedLayer) reasons.push('スマートオブジェクト');
  if (!isGroup && layer.mask && !layer.mask.disabled && hasMaskArea(layer)) reasons.push('レイヤーマスク');
  return reasons;
}

function hasActiveEffects(effects: LayerEffectsInfo | undefined): boolean {
  if (!effects || effects.disabled) return false;
  const { disabled: _disabled, scale: _scale, ...rest } = effects;
  return Object.values(rest).some((value) => {
    const list: unknown[] = Array.isArray(value) ? value : [value];
    return list.some((e) => typeof e === 'object' && e !== null && (e as { enabled?: boolean }).enabled !== false);
  });
}

function hasMaskArea(layer: Layer): boolean {
  const m = layer.mask;
  if (!m) return false;
  // 画素の無いマスクでも、既定色が黒なら全体が隠れる
  return (m.right ?? 0) > (m.left ?? 0) || (m.bottom ?? 0) > (m.top ?? 0) || (m.defaultColor ?? 0) !== 255;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, i) => from + i);
}

// 16bit・32bit の画素も 8bit にそろえる（32bit は ag-psd と同じくガンマ 2.2 で戻す）
export function toRgba8(pixels: PixelData | undefined): RgbaImage | null {
  if (!pixels || pixels.width <= 0 || pixels.height <= 0) return null;
  const { width, height, data } = pixels;
  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
    return { width, height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  }
  const out = new Uint8Array(data.length);
  if (data instanceof Uint16Array) {
    for (let i = 0; i < data.length; i++) out[i] = Math.round((data[i]! * 255) / 65535);
  } else {
    const unit = (v: number): number => Math.min(1, Math.max(0, v));
    for (let i = 0; i < data.length; i++) {
      const v = unit(data[i]!);
      out[i] = Math.round((i % 4 === 3 ? v : Math.pow(v, 1 / 2.2)) * 255);
    }
  }
  return { width, height, data: out };
}

let agPsdReady = false;

// ag-psd は 8bit の画素を作るのにキャンバスを使う。ImageData を直接作るようにして、
// キャンバスの無い環境（テストの node）でも、WebView2 でも同じように読めるようにする
function prepareAgPsd(): void {
  if (agPsdReady) return;
  agPsdReady = true;
  initializeCanvas(
    (width, height) => {
      if (typeof document === 'undefined') throw new Error('この環境ではキャンバスを作れない');
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    (width, height) =>
      typeof ImageData === 'undefined'
        ? ({ width, height, data: new Uint8ClampedArray(width * height * 4) } as unknown as ImageData)
        : new ImageData(width, height),
  );
}
