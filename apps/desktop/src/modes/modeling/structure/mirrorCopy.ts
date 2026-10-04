// 左右反転コピー。パーツ（グループなら子孫ごと）を複製し、中心線（bodyRoot があればそのピボットの x、無ければキャンバスの中央）で左右反転する。
// 素材は左右反転した PNG を作って新しい Asset にする。頂点・uv・pivot を反転する。
// そのパーツを対象にするバインディングも複製し、差分の x と回転の符号を反転し、パラメータ id と standardType の末尾の L / R を入れ替える
import { newId as defaultNewId, STANDARD_PART_NAMES } from '@app/schema';
import type { Asset, Binding, Model, ParameterKey, Project, StandardPartType, TransformDelta, Vec2 } from '@app/schema';
import type { Command, Services } from '@app/contracts';
import { duplicateParts } from './commands';
import { idSequence, subtreeIds } from './modelOps';

// 左右反転した PNG を作る関数（テストでは差し替える）
export type PngFlipper = (png: Uint8Array) => Promise<Uint8Array>;

// 本物: createImageBitmap で読み、OffscreenCanvas に左右反転して描き、PNG に戻す
export const flipPngHorizontally: PngFlipper = async (png) => {
  const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas の 2D コンテキストを作れない');
    ctx.translate(bitmap.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
};

// 画面の「左右反転コピー」が使う関数。テスト（jsdom には createImageBitmap が無い）で差し替える
let currentFlipper: PngFlipper = flipPngHorizontally;
export function setPngFlipper(flip: PngFlipper | null): void {
  currentFlipper = flip ?? flipPngHorizontally;
}
export function pngFlipper(): PngFlipper {
  return currentFlipper;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- L / R の入れ替え ----

// 末尾の L / R を入れ替える。直前が英大文字のもの（例: BALL）は名前の一部とみなして入れ替えない。入れ替えられなければ null
export function swapLR(text: string): string | null {
  const m = /^(.*[^A-Z])?([LR])$/.exec(text);
  if (!m) return null;
  return `${m[1] ?? ''}${m[2] === 'L' ? 'R' : 'L'}`;
}

export function mirrorStandardType(type: StandardPartType | null): StandardPartType | null {
  if (type === null) return null;
  const swapped = swapLR(type);
  return swapped !== null && swapped in STANDARD_PART_NAMES ? (swapped as StandardPartType) : null;
}

// 入れ替えた id のパラメータが無ければ元のまま
export function mirrorParameterId(model: Model, id: string): string {
  const swapped = swapLR(id);
  return swapped !== null && model.parameters.some((p) => p.id === swapped) ? swapped : id;
}

const neg = (v: number) => (v === 0 ? 0 : -v);

export function mirrorKey(key: ParameterKey): ParameterKey {
  const delta: TransformDelta | Vec2[] = Array.isArray(key.delta)
    ? key.delta.map((d) => ({ x: neg(d.x), y: d.y }))
    : {
        ...key.delta,
        position: { x: neg(key.delta.position.x), y: key.delta.position.y },
        rotation: neg(key.delta.rotation),
      };
  return { ...key, delta };
}

export function mirrorBinding(model: Model, binding: Binding): Binding {
  return {
    ...binding,
    parameterIds: binding.parameterIds.map((id) => mirrorParameterId(model, id)),
    keys: binding.keys.map(mirrorKey),
  };
}

// ---- 中心線と素材 ----

export function mirrorCenterX(project: Project, assetIds: readonly string[] = []): number {
  const bodyRoot = project.model.parts.find((p) => p.standardType === 'bodyRoot');
  if (bodyRoot) return bodyRoot.pivot.x;
  const asset = project.assets.find((a) => assetIds.includes(a.id)) ?? project.assets[0];
  return asset ? asset.canvasSize.width / 2 : 0;
}

export function mirroredAsset(asset: Asset, id: string, hash: string, centerX: number): Asset {
  const layerName = asset.source.layerName;
  return {
    ...asset,
    id,
    path: `assets/${id}.png`,
    hash,
    offset: { x: 2 * centerX - asset.offset.x - asset.width, y: asset.offset.y },
    source: {
      ...asset.source,
      ...(layerName !== undefined ? { layerName: swapLR(layerName) ?? `${layerName}（反転）` } : {}),
    },
  };
}

export interface MirrorPrepared {
  centerX: number;
  assets: Asset[]; // 足す素材（反転した PNG は assets.put 済み）
  assetMap: Record<string, string>; // 元の assetId → 反転した素材の id
}

// 反転した素材を作る。PNG が無い素材があれば失敗する
export async function prepareMirror(
  services: Pick<Services, 'store' | 'assets'>,
  ids: readonly string[],
  options: { flip?: PngFlipper; newId?: () => string } = {},
): Promise<MirrorPrepared> {
  const flip = options.flip ?? flipPngHorizontally;
  const makeId = options.newId ?? defaultNewId;
  const project = services.store.get();
  const inside = subtreeIds(project.model, ids);
  const assetIds = [
    ...new Set(
      project.model.parts.filter((p) => inside.has(p.id) && p.kind === 'image' && p.assetId).map((p) => p.assetId!),
    ),
  ];
  const centerX = mirrorCenterX(project, assetIds);
  const assets: Asset[] = [];
  const assetMap: Record<string, string> = {};
  for (const assetId of assetIds) {
    const asset = project.assets.find((a) => a.id === assetId);
    const png = services.assets.getPng(assetId);
    if (!asset || !png) throw new Error(`素材の画像が無い（${assetId}）`);
    const flipped = await flip(png);
    const id = makeId();
    await services.assets.put(id, flipped);
    assets.push(mirroredAsset(asset, id, await sha256Hex(flipped), centerX));
    assetMap[assetId] = id;
  }
  return { centerX, assets, assetMap };
}

// ---- コマンド ----

export function mirrorCopy(
  ids: readonly string[],
  prepared: MirrorPrepared,
  options: { newId?: () => string } = {},
): Command {
  const seq = idSequence(options.newId);
  const c = prepared.centerX;
  const mx = (x: number) => 2 * c - x;
  return {
    label: '左右反転コピー',
    apply(project) {
      const have = new Set(project.assets.map((a) => a.id));
      const added = prepared.assets.filter((a) => !have.has(a.id));
      const withAssets = added.length > 0 ? { ...project, assets: [...project.assets, ...added] } : project;
      const { model } = withAssets;
      const next = duplicateParts(withAssets, ids, seq(), {
        part: (original, copy, isRoot) => ({
          ...copy,
          standardType: mirrorStandardType(original.standardType),
          name: swapLR(original.name) ?? (isRoot ? `${original.name}（左右反転）` : original.name),
          pivot: { x: mx(original.pivot.x), y: original.pivot.y },
          position: { x: neg(original.position.x), y: original.position.y },
          rotation: neg(original.rotation),
        }),
        mesh: (original, copy) => ({
          ...copy,
          vertices: original.vertices.map((v) => ({ x: mx(v.x), y: v.y })),
          uvs: original.uvs.map((uv) => ({ x: 1 - uv.x, y: uv.y })),
          // 反転で向きが変わるので、三角形の頂点の順も逆にして向きを保つ
          triangles: original.triangles.map(([a, b, d]) => [a, d, b] as [number, number, number]),
        }),
        binding: (copy) => mirrorBinding(model, copy),
        assetId: (id) => (id !== null ? (prepared.assetMap[id] ?? id) : null),
      });
      return next === withAssets ? project : next;
    },
  };
}

// 画面から呼ぶ。反転した素材を作ってからコマンドを実行する
export async function runMirrorCopy(
  services: Services,
  ids: readonly string[],
  notify: (message: string) => void,
  flip: PngFlipper = pngFlipper(),
): Promise<boolean> {
  try {
    const prepared = await prepareMirror(services, ids, { flip });
    services.store.dispatch(mirrorCopy(ids, prepared));
    return true;
  } catch (e) {
    notify(`左右反転コピーができない: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
