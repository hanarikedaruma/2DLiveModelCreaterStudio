// PNG・PSD の取り込み（カード13）
import { newId, type Asset } from '@app/schema';
import { sha256Hex, type ImportWarning, type ImportedAsset } from '@app/contracts';
import type { ImportProgress } from './workerMessages';
import { MIN_CANVAS_SIDE, MAX_CANVAS_SIDE, type ImportFile } from './importer';
import { decodePng, encodePng, hasPngSignature } from './png';
import { hasPsdSignature, readPsdDocument, type PsdMergeTarget, type PsdRasterLayer } from './psd';
import { coversCanvas, crop, opaqueBounds, type RgbaImage, type Size } from './rgba';

// 1つのファイルから取り出した画像（PNG は1枚、PSD はレイヤーの数だけ）
interface SourceFile {
  kind: 'png' | 'psd';
  canvas: Size;
  images: PsdRasterLayer[];
  mergeTargets: PsdMergeTarget[];
}

export async function importFiles(
  files: ImportFile[],
  report: (progress: ImportProgress) => void = () => {},
): Promise<{ assets: ImportedAsset[]; warnings: ImportWarning[] }> {
  // 形式は先にまとめて確かめる（途中で止まらないように）
  const unsupported = files.filter((f) => !hasPngSignature(f.data) && !hasPsdSignature(f.data));
  if (unsupported.length > 0) {
    throw new Error(`PNG と PSD 以外のファイルは取り込めない: ${unsupported.map((f) => f.name).join(', ')}`);
  }

  const assets: ImportedAsset[] = [];
  const warnings: ImportWarning[] = [];
  let first: { name: string; canvas: Size } | null = null;

  for (const [fileIndex, file] of files.entries()) {
    const base = { fileName: file.name, fileIndex: fileIndex + 1, fileCount: files.length };
    report({ ...base, phase: 'reading', layerIndex: 0, layerCount: 0 });
    const source = readSource(file);
    first ??= { name: file.name, canvas: source.canvas };
    const mismatch = !sameSize(first.canvas, source.canvas);

    const fileAssets: (ImportedAsset | null)[] = [];
    const opaque: ImportedAsset[] = [];
    for (const [layerIndex, image] of source.images.entries()) {
      report({
        ...base,
        phase: 'layers',
        layerIndex: layerIndex + 1,
        layerCount: source.images.length,
        layerName: image.name ?? file.name,
      });
      const imported = await toAsset(file.name, source, image, source.kind === 'png' && mismatch);
      fileAssets.push(imported);
      if (!imported || !image.image) continue;
      assets.push(imported);
      if (coversCanvas(image.image, { x: image.left, y: image.top }, source.canvas)) opaque.push(imported);
    }
    const imported = fileAssets.filter((a): a is ImportedAsset => a !== null);

    if (mismatch) {
      warnings.push({
        kind: 'canvasMismatch',
        assetIds: imported.map((a) => a.asset.id),
        layerNames: displayNames(file.name, imported),
        message:
          `${file.name} の大きさ（${sizeText(source.canvas)}）が最初のファイル ${first.name}（${sizeText(first.canvas)}）と違う。` +
          (source.kind === 'png' ? '位置は左上 (0, 0) にした' : '位置がずれている可能性がある'),
      });
    }
    const longSide = Math.max(source.canvas.width, source.canvas.height);
    if (longSide < MIN_CANVAS_SIDE || longSide > MAX_CANVAS_SIDE) {
      warnings.push({
        kind: 'resolution',
        assetIds: imported.map((a) => a.asset.id),
        layerNames: displayNames(file.name, imported),
        message:
          `${file.name} のキャンバスの長辺が ${longSide}px で${longSide < MIN_CANVAS_SIDE ? '小さすぎる' : '大きすぎる'}。` +
          `長辺は ${MIN_CANVAS_SIDE}〜${MAX_CANVAS_SIDE}px を勧める`,
      });
    }
    if (opaque.length > 0) {
      warnings.push({
        kind: 'noTransparency',
        assetIds: opaque.map((a) => a.asset.id),
        layerNames: displayNames(file.name, opaque),
        message: `透明な部分がほとんど無い（背景が塗られている可能性がある）: ${displayNames(file.name, opaque).join(', ')}`,
      });
    }
    if (source.mergeTargets.length > 0) {
      const ids = source.mergeTargets.flatMap((t) =>
        t.layerIndexes.map((i) => fileAssets[i]?.asset.id).filter((id): id is string => id !== undefined),
      );
      warnings.push({
        kind: 'needsMerge',
        assetIds: [...new Set(ids)],
        layerNames: source.mergeTargets.map((t) => t.name),
        message:
          `${file.name} に統合が必要なレイヤーがある。通常の画像として取り込んだ（見た目を合わせるには元のファイルで統合する）: ` +
          source.mergeTargets.map((t) => `${t.name}（${t.reasons.join('・')}）`).join(', '),
      });
    }
  }
  return { assets, warnings };
}

function readSource(file: ImportFile): SourceFile {
  if (hasPngSignature(file.data)) {
    let image: RgbaImage;
    try {
      image = decodePng(file.data);
    } catch (e) {
      throw new Error(`PNG を読めない（${file.name}）: ${errorText(e)}`);
    }
    return {
      kind: 'png',
      canvas: { width: image.width, height: image.height },
      images: [{ name: null, path: [], left: 0, top: 0, image, opacity: 1, hidden: false, blendMode: 'normal' }],
      mergeTargets: [],
    };
  }
  let doc: ReturnType<typeof readPsdDocument>;
  try {
    doc = readPsdDocument(file.data);
  } catch (e) {
    throw new Error(`PSD を読めない（${file.name}）: ${errorText(e)}`);
  }
  return {
    kind: 'psd',
    canvas: doc.canvas,
    images: doc.layers,
    mergeTargets: doc.mergeTargets,
  };
}

// 透明な余白を切り落として素材にする。すべて透明なら null
async function toAsset(
  fileName: string,
  source: SourceFile,
  image: PsdRasterLayer,
  atOrigin: boolean,
): Promise<ImportedAsset | null> {
  if (!image.image) return null;
  const bounds = opaqueBounds(image.image);
  if (!bounds) return null;
  const png = encodePng(crop(image.image, bounds));
  const id = newId();
  const asset: Asset = {
    id,
    path: `assets/${id}.png`,
    hash: await sha256Hex(png),
    width: bounds.width,
    height: bounds.height,
    offset: atOrigin ? { x: 0, y: 0 } : { x: image.left + bounds.x, y: image.top + bounds.y },
    canvasSize: { ...source.canvas },
    source:
      source.kind === 'png'
        ? { kind: 'png', file: fileName }
        : {
            kind: 'psd',
            file: fileName,
            ...(image.name !== null ? { layerName: image.name } : {}),
            layerPath: image.path,
            hidden: image.hidden,
          },
    sourceBlendMode: image.blendMode,
    sourceOpacity: clamp01(image.opacity),
  };
  return { asset, png };
}

function displayNames(fileName: string, assets: ImportedAsset[]): string[] {
  return assets.map((a) => a.asset.source.layerName ?? fileName);
}

function sameSize(a: Size, b: Size): boolean {
  return a.width === b.width && a.height === b.height;
}

function sizeText(s: Size): string {
  return `${s.width}×${s.height}`;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
