// カード42 自動セットアップの拡張（STEP1）。MVP の計画（planMotions）に、曲面の顔の向き・斜め方向の合成・
// 曲線のまばたき・目 笑顔・眉・口の形と横幅・体の追従・頬染めを足す。
// キーは source 'auto'（曲面の ±10・±20 は代表の間の中間キーなので 'generated'）。再実行では manual と locked のキーを残す
import type { Binding, Mesh, Model, ParameterKey, Part, Vec2 } from '@app/schema';
import { isUsableWarp } from '../deform/warp';
import { generateBetweenKeys, type Interpolator } from '../generate/between';
import { unionRects, type Rect } from '../generate/bounds';
import { deepEqual } from '../generate/equal';
import {
  clean,
  defaultKey,
  findTransformBindingIndex,
  sameCoord,
  sortedUnique,
  transformDelta,
  withDefaultOffset,
  type DeltaParts,
  type KeySpec,
} from '../generate/keys';
import {
  SURFACE_ANCHOR_VALUES,
  SURFACE_STEP,
  generateSurfaceKeys,
  surfaceInterpolator,
  type SurfaceParameter,
} from '../generate/surface';
import { closedEyeLinePoints, closedLineY, meshSpanAt, normalizeClosedLine } from './closedLine';
import { faceTurnCrossTerm, faceWarpOf } from './faceTurn';
import { blinkMethod, keepOnRerun, type BindingPlan } from './motions';
import type { BoundsOf } from './pivots';
import { SIDES, eyeTypes, indexStandardParts, type ImageType } from './standardParts';

// 動きの量（カード42の表）
export const STEP1_MOTION = {
  eyeSmileLowerLid: 0.25, // 目 笑顔 1 で下まぶたが上がる量（白目の高さに対する割合）
  eyeSmileWhite: 0.6, // 目 笑顔 1 での白目の縦の倍率（ピボットは白目の下端）
  browRaise: 0.8, // 眉 上下 1 で眉が上がる量（眉の高さに対する割合）
  browAngle: 12, // 眉 形 1（怒り）で内側を下げる回転（度）
  mouthCorner: 0.2, // 口 形で動かす両端の幅（口の幅に対する割合）
  mouthCornerRaise: 0.06, // 口 形 1 で両端が上がる量（口の幅に対する割合）
  mouthWiden: 1.2, // 口 横幅 1 での横の倍率
  mouthNarrow: 0.75, // 口 横幅 −1 での横の倍率
  bodyTilt: 4, // 体 傾き 10 での回転（度）
  bodyShift: 0.03, // 体 左右 10 での横の移動（胴体の幅に対する割合）
};

// 斜め方向の合成のキーの位置（FaceAngleX・FaceAngleY。方向グリッドと同じ −30 / 0 / 30）
export const FACE_DIRECTION_VALUES = [-30, 0, 30];

const FACE_ANGLES: readonly SurfaceParameter[] = ['FaceAngleX', 'FaceAngleY'];

// 頂点（mesh）・制御点（warp）のバインディングの計画
export interface PointPlan {
  target: { type: 'mesh' | 'warp'; id: string };
  parameterIds: string[]; // 1 か 2。keys の coords はこの順
  generation: Binding['generation'];
  keys: { coords: number[]; delta: Vec2[] }[];
  between?: { interpolate: Interpolator; step: number }; // 1パラメータで、代表のキーの間に中間キーを作る
}

export interface Step1Plan {
  transforms: BindingPlan[]; // MVP の計画（閉じた線で置き換えるものを除く）と STEP1 の transform
  partOpacities: ReadonlyMap<string, number>; // 基準の不透明度（Part.opacity）を変えるパーツ（頬染め。I-026）
  points: PointPlan[];
  // 自動セットアップが作る頂点・制御点のバインディングか（計画に無く、残すキーも無ければ消す）
  owns(binding: Binding): boolean;
}

const zeros = (n: number): Vec2[] => Array.from({ length: n }, () => ({ x: 0, y: 0 }));
const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));
const channelOf = (target: PointPlan['target']): Binding['channel'] =>
  target.type === 'warp' ? 'warpPoints' : 'vertices';

export function planStep1(
  model: Model,
  basePlans: readonly BindingPlan[],
  boundsOf: BoundsOf,
  surfaceFaceTurn = true,
): Step1Plan {
  const index = indexStandardParts(model.parts);
  const meshes = new Map(model.meshes.map((m) => [m.id, m]));
  const meshOf = (part: Part): Mesh | null => {
    const mesh = part.meshId !== null ? meshes.get(part.meshId) : undefined;
    return mesh && mesh.vertices.length > 0 ? mesh : null;
  };
  const rectOf = (type: ImageType): Rect | null => {
    const part = index.first(type);
    return part ? boundsOf(part) : null;
  };
  const childrenOf = new Map<string, Part[]>();
  for (const part of model.parts) {
    if (part.parentId !== null) childrenOf.set(part.parentId, [...(childrenOf.get(part.parentId) ?? []), part]);
  }
  // 子孫の画像パーツのうちメッシュのあるもの（parts の順ではなく、親から順に）
  const descendantMeshes = (root: Part): { part: Part; mesh: Mesh }[] => {
    const out: { part: Part; mesh: Mesh }[] = [];
    const seen = new Set([root.id]);
    const queue = [...(childrenOf.get(root.id) ?? [])];
    for (let part = queue.shift(); part; part = queue.shift()) {
      if (seen.has(part.id)) continue;
      seen.add(part.id);
      const mesh = part.kind === 'image' ? meshOf(part) : null;
      if (mesh) out.push({ part, mesh });
      queue.push(...(childrenOf.get(part.id) ?? []));
    }
    return out;
  };
  const transforms: BindingPlan[] = [];
  const points: PointPlan[] = [];
  const owned = new Map<string, string[][]>(); // 対象の id → 自動セットアップが作るパラメータの組
  const own = (id: string, parameterIds: string[]) => owned.set(id, [...(owned.get(id) ?? []), parameterIds]);
  const replaced = new Set<string>(); // MVP の閉じ方を頂点の閉じ方に置き換えるパーツ

  const zero = transformDelta();
  const add = (part: Part | undefined, parameterId: string, keys: KeySpec[]) => {
    if (part) transforms.push({ partId: part.id, parameterId, generation: 'linear', keys });
  };
  // −v・0・v（値 v で at(1)、−v で at(−1)）
  const symmetric = (v: number, at: (sign: number) => DeltaParts): KeySpec[] => [
    { coord: -v, delta: transformDelta(at(-1)) },
    { coord: 0, delta: zero },
    { coord: v, delta: transformDelta(at(1)) },
  ];
  // 0・1（値 1 で delta）
  const atOne = (delta: DeltaParts): KeySpec[] => [
    { coord: 0, delta: zero },
    { coord: 1, delta: transformDelta(delta) },
  ];
  // MVP の transform のバインディングに、手で直したキー（manual・locked）があるか
  const keptTransform = (part: Part, parameterId: string) => {
    const binding = model.bindings[findTransformBindingIndex(model.bindings, part.id, parameterId)];
    return binding?.keys.some(keepOnRerun) ?? false;
  };
  const keptPoints = (meshId: string, parameterId: string) =>
    model.bindings.some(
      (b) =>
        b.channel === 'vertices' &&
        b.target.id === meshId &&
        sameSet(b.parameterIds, [parameterId]) &&
        b.keys.some(keepOnRerun),
    );

  // ---- 顔の向き（曲面）と斜め方向の合成 ----
  const faceGroup = index.group('faceGroup');
  for (const w of model.warps) {
    if (w.partId !== faceGroup?.id) continue;
    for (const id of FACE_ANGLES) own(w.id, [id]);
    own(w.id, [...FACE_ANGLES]);
  }
  const warp = faceWarpOf(model);
  // 奥行き方式では曲面の計画を出さない。既存の自動キーだけを除き、手動・ロックは applyPointPlans が保護する。
  if (surfaceFaceTurn && warp && isUsableWarp(warp)) {
    const target = { type: 'warp' as const, id: warp.id };
    for (const parameterId of FACE_ANGLES) {
      const deltas = generateSurfaceKeys(warp, parameterId, SURFACE_ANCHOR_VALUES);
      points.push({
        target,
        parameterIds: [parameterId],
        generation: 'surface',
        keys: SURFACE_ANCHOR_VALUES.map((value, i) => ({ coords: [value], delta: deltas[i]! })),
        between: { interpolate: surfaceInterpolator(warp, parameterId), step: SURFACE_STEP },
      });
    }
    // 基準（0, 0）と斜めの4つ。軸の上のキーは作らない（左右・上下のバインディングの和のまま）
    const corners: PointPlan['keys'] = [{ coords: [0, 0], delta: zeros(warp.points.length) }];
    for (const x of FACE_DIRECTION_VALUES) {
      for (const y of FACE_DIRECTION_VALUES) {
        if (x !== 0 && y !== 0) corners.push({ coords: [x, y], delta: faceTurnCrossTerm(warp, x, y) });
      }
    }
    points.push({ target, parameterIds: [...FACE_ANGLES], generation: 'linear', keys: corners });
  }

  for (const side of SIDES) {
    const t = eyeTypes(side);
    const open = `EyeOpen${side}`;
    const white = rectOf(t.eyeWhite);

    // ---- 目 開閉（曲線）。閉じた線があれば、値 0 で上まぶたを線に沿わせ、白目を線へ閉じる ----
    const line = normalizeClosedLine(closedEyeLinePoints(model, side));
    const lids = blinkMethod(index, side) === 'lids';
    const lineY = (x: number) => (line ? closedLineY(line, x) : 0);
    let band = 0; // 線に沿わせた上まぶたの帯の厚み（白目を閉じる位置に使う）
    for (const part of index.images(t.upperLid)) {
      const mesh = meshOf(part);
      if (!mesh) continue;
      own(mesh.id, [open]);
      // 子（まつげなど）は親の transform とワープは受け継ぐが、頂点の差分は受け継がない
      const children = descendantMeshes(part);
      for (const child of children) own(child.mesh.id, [open]);
      // MVP の閉じ方を手で直していれば重ねない
      if (!line || !lids || keptTransform(part, open)) continue;
      // まつげなどの子も一緒に下がるよう、MVP の平行移動は残し、線に沿わせる残りの分だけを頂点で足す
      const plan = basePlans.find((p) => p.partId === part.id && p.parameterId === open);
      const drop = plan?.keys.find((k) => sameCoord(k.coord, 0))?.delta.position.y ?? 0;
      const closed = lidAlongLine(mesh, lineY);
      band = band || closed.thickness;
      points.push(
        closePlan(
          mesh,
          open,
          mesh.vertices.map((p, i) => ({ x: 0, y: clean(closed.ys[i]! - p.y - drop) })),
        ),
      );
      // 子の頂点にも、その x での上まぶたの下端の動きのうち MVP の平行移動の残りの分を足す（I-040）。
      // 子の閉じ方を手で直していれば重ねない
      const shift = lowerEdgeShift(mesh, closed.ys);
      for (const child of children) {
        if (keptTransform(child.part, open)) continue;
        points.push(
          closePlan(
            child.mesh,
            open,
            child.mesh.vertices.map((p) => {
              const s = shift(p.x);
              return { x: 0, y: s === null ? 0 : clean(s - drop) };
            }),
          ),
        );
      }
    }
    for (const part of index.images(t.eyeWhite)) {
      const mesh = meshOf(part);
      if (!mesh) continue;
      own(mesh.id, [open]);
      if (keptTransform(part, open)) continue;
      if (keptPoints(mesh.id, open)) replaced.add(part.id);
      if (!line || !lids) continue;
      replaced.add(part.id);
      // 上側も下側も線へ寄せて閉じる（線より下に白目と瞳が残らないように）。曲線に沿って縮んだ白目の細い残りが
      // 見えないよう、線に沿わせた上まぶたの帯の真ん中（線から厚みの半分だけ上）に寄せる
      points.push(
        closePlan(
          mesh,
          open,
          mesh.vertices.map((p) => ({ x: 0, y: clean(lineY(p.x) - band / 2 - p.y) })),
        ),
      );
    }

    // ---- 目 笑顔: 値 1 で下まぶたが上がり、白目が縦に縮む（ピボットは白目の下端） ----
    if (white) {
      const smile = `EyeSmile${side}`;
      for (const part of index.images(t.lowerLid)) {
        add(part, smile, atOne({ y: -white.height * STEP1_MOTION.eyeSmileLowerLid }));
      }
      for (const part of index.images(t.eyeWhite)) add(part, smile, atOne({ scaleY: STEP1_MOTION.eyeSmileWhite }));
    }

    // ---- 眉: 上下は値 1 で上がる。形は値 1（怒り）で内側（顔の中心の側）を下げる ----
    // L は画面の右に描かれるので内側は左端。左端を下げるのは反時計回り（負）。R はその逆
    const inward = side === 'L' ? -1 : 1;
    for (const brow of index.images(side === 'L' ? 'browL' : 'browR')) {
      const r = boundsOf(brow);
      if (r)
        add(
          brow,
          `BrowY${side}`,
          symmetric(1, (s) => ({ y: -s * r.height * STEP1_MOTION.browRaise })),
        );
      add(
        brow,
        `BrowForm${side}`,
        symmetric(1, (s) => ({ rotation: s * inward * STEP1_MOTION.browAngle })),
      );
    }
  }

  // ---- 口 形: 値 1 で上唇・下唇の両端（口の幅の 20%）の頂点が上がる。−1 で下がる ----
  const lips = [...index.images('upperLip'), ...index.images('lowerLip')];
  const mouth = unionRects(lips.map(boundsOf));
  for (const part of lips) {
    const mesh = meshOf(part);
    if (!mesh) continue;
    own(mesh.id, ['MouthForm']);
    if (!mouth) continue;
    const edge = mouth.width * STEP1_MOTION.mouthCorner;
    const atEnd = (x: number) => x <= mouth.x + edge || x >= mouth.x + mouth.width - edge;
    const lift = mouth.width * STEP1_MOTION.mouthCornerRaise;
    points.push({
      target: { type: 'mesh', id: mesh.id },
      parameterIds: ['MouthForm'],
      generation: 'linear',
      keys: [-1, 0, 1].map((value) => ({
        coords: [value],
        delta: mesh.vertices.map((p) => ({ x: 0, y: atEnd(p.x) ? clean(-value * lift) : 0 })),
      })),
    });
  }

  // ---- 口 横幅: 唇と口の中を横に伸ばす（値 1）・縮める（値 −1） ----
  for (const part of [...lips, ...index.images('mouthInside')]) {
    add(
      part,
      'MouthWidth',
      symmetric(1, (s) => ({ scaleX: s > 0 ? STEP1_MOTION.mouthWiden : STEP1_MOTION.mouthNarrow })),
    );
  }

  // ---- 体の追従: 体の変形グループ（ピボットは胴体の下端中央）を傾け、左右に動かす ----
  const body = index.group('bodyRoot');
  add(
    body,
    'BodyAngleZ',
    symmetric(10, (s) => ({ rotation: s * STEP1_MOTION.bodyTilt })),
  );
  const torso = rectOf('torso');
  if (torso)
    add(
      body,
      'BodyAngleX',
      symmetric(10, (s) => ({ x: s * torso.width * STEP1_MOTION.bodyShift })),
    );

  // ---- 頬染め: 不透明度のバインディングで、値 0（デフォルト値）で消え、値 1 で見える（I-026） ----
  // 初めては、いまの不透明度を値 1 の不透明度にし、基準の不透明度（Part.opacity。値 0 での値）を 0 にする。
  // すでに不透明度のバインディングなら、基準の不透明度と値 1 の不透明度はそのまま
  const cheekBases = new Map<string, number>();
  for (const cheek of index.images('cheek')) {
    const existing = model.bindings.find(
      (b) =>
        b.channel === 'transform' &&
        b.target.id === cheek.id &&
        b.parameterIds.length === 1 &&
        b.parameterIds[0] === 'Cheek',
    );
    const keyed = existing?.controlsOpacity === true;
    const shownKey = keyed ? existing.keys.find((k) => k.coords.length === 1 && sameCoord(k.coords[0]!, 1)) : undefined;
    const shown = shownKey && !Array.isArray(shownKey.delta) ? shownKey.delta.opacity : cheek.opacity;
    const hidden = keyed ? cheek.opacity : 0;
    if (!keyed) cheekBases.set(cheek.id, 0);
    transforms.push({
      partId: cheek.id,
      parameterId: 'Cheek',
      generation: 'linear',
      controlsOpacity: true,
      keys: [
        { coord: 0, delta: transformDelta({ opacity: hidden }) },
        { coord: 1, delta: transformDelta({ opacity: shown }) },
      ],
    });
  }

  const base = basePlans.filter((p) => !(replaced.has(p.partId) && p.parameterId.startsWith('EyeOpen')));
  return {
    transforms: [...base, ...transforms],
    partOpacities: cheekBases,
    points,
    owns: (b) =>
      b.channel !== 'transform' && (owned.get(b.target.id) ?? []).some((ids) => sameSet(ids, b.parameterIds)),
  };
}

// 閉じたときの上まぶたの頂点の高さ（ys）と帯の厚み。各列の上端〜下端を、下端が線に乗る一定の厚み
// （横の真ん中の列の厚み）の帯に収める。真ん中の列の厚みが分からなければ、各列の厚みのまま下端を線に乗せる（厚みは 0）
export function lidAlongLine(mesh: Mesh, lineY: (x: number) => number): { ys: number[]; thickness: number } {
  const xs = mesh.vertices.map((p) => p.x);
  const middle = meshSpanAt(mesh, (Math.min(...xs) + Math.max(...xs)) / 2);
  const thickness = middle && middle.bottom - middle.top > 1e-9 ? middle.bottom - middle.top : 0;
  const ys = mesh.vertices.map((p) => {
    const to = lineY(p.x);
    const span = meshSpanAt(mesh, p.x);
    const height = span ? span.bottom - span.top : 0;
    if (!span || height <= 1e-9) return to;
    if (thickness === 0) return to - (span.bottom - p.y);
    return to - thickness + ((p.y - span.top) / height) * thickness;
  });
  return { ys, thickness };
}

// 閉じたときの上まぶたの下端の動き（x の関数）。閉じた形（頂点の高さ ys）の下端 − もとの下端。
// x は上まぶたの横の範囲に収める（範囲の外にはみ出す子は端の列と一緒に動く）。下端が分からなければ null
export function lowerEdgeShift(mesh: Mesh, ys: readonly number[]): (x: number) => number | null {
  const closed = { vertices: mesh.vertices.map((p, i) => ({ x: p.x, y: ys[i]! })), triangles: mesh.triangles };
  const xs = mesh.vertices.map((p) => p.x);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  return (x) => {
    const at = Math.min(Math.max(x, left), right);
    const from = meshSpanAt(mesh, at);
    const to = meshSpanAt(closed, at);
    return from && to ? to.bottom - from.bottom : null;
  };
}

// まばたきの頂点の計画（値 0 で delta、値 1 で差分 0）
function closePlan(mesh: Mesh, parameterId: string, delta: Vec2[]): PointPlan {
  return {
    target: { type: 'mesh', id: mesh.id },
    parameterIds: [parameterId],
    generation: 'linear',
    keys: [
      { coords: [0], delta },
      { coords: [1], delta: zeros(mesh.vertices.length) },
    ],
  };
}

const sameCoords = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((v, i) => sameCoord(v, b[i]!));

function compareCoords(a: ParameterKey, b: ParameterKey): number {
  for (let i = 0; i < Math.max(a.coords.length, b.coords.length); i++) {
    const d = (a.coords[i] ?? 0) - (b.coords[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// 計画の頂点・制御点のバインディングを作り直す。既存のキーのうち manual と locked は残し、同じ位置には新しいキーを作らない。
// parameterIds の順・divisions は既存のものを使う。内容が同じなら既存をそのまま返す
function rebuildPointBinding(
  existing: Binding | undefined,
  plan: PointPlan,
  model: Model,
  newId: () => string,
): Binding {
  const parameterIds = existing ? [...existing.parameterIds] : [...plan.parameterIds];
  const order = (coords: number[]) => parameterIds.map((id) => coords[plan.parameterIds.indexOf(id)]!);
  const kept = (existing?.keys ?? []).filter((k) => keepOnRerun(k) && k.coords.length === parameterIds.length);
  const origin = defaultKey(
    existing,
    parameterIds.map((id) => model.parameters.find((p) => p.id === id)?.default ?? 0),
  );
  const fresh: ParameterKey[] = [];
  for (const key of plan.keys) {
    const coords = order(key.coords);
    if (kept.some((k) => sameCoords(k.coords, coords))) continue;
    fresh.push({ coords, delta: withDefaultOffset(key.delta, origin?.delta), source: 'auto', locked: false });
  }
  const keys = [...kept, ...fresh].sort(compareCoords);
  let next: Binding = {
    id: existing?.id ?? newId(),
    target: { type: plan.target.type, id: plan.target.id },
    channel: channelOf(plan.target),
    parameterIds,
    keyValues: parameterIds.map((_, i) => sortedUnique(keys.map((k) => k.coords[i]!))),
    keys,
    generation: plan.generation,
    divisions: existing?.divisions ?? null,
  };
  if (plan.between) {
    next = generateBetweenKeys(next, plan.between.interpolate, {
      divisions: next.divisions,
      step: plan.between.step,
      within: null,
      generation: plan.generation,
    });
  }
  return existing && deepEqual(existing, next) ? existing : next;
}

// 頂点・制御点の計画をバインディングに入れる。計画に無くなった、自動セットアップの頂点・制御点のバインディング
// （owns が true で、残すキーが無いもの）は消す。変わらなければ同じ model を返す
export function applyPointPlans(
  model: Model,
  plans: readonly PointPlan[],
  owns: (binding: Binding) => boolean,
  newId: () => string,
): Model {
  const bindings = model.bindings.slice();
  const planned = new Set<string>();
  for (const plan of plans) {
    const channel = channelOf(plan.target);
    const at = bindings.findIndex(
      (b) =>
        b.channel === channel &&
        b.target.type === plan.target.type &&
        b.target.id === plan.target.id &&
        sameSet(b.parameterIds, plan.parameterIds),
    );
    const binding = rebuildPointBinding(bindings[at], plan, model, newId);
    planned.add(binding.id);
    if (at >= 0) bindings[at] = binding;
    else bindings.push(binding);
  }
  const next = bindings.filter((b) => planned.has(b.id) || !owns(b) || b.keys.some(keepOnRerun));
  const same = next.length === model.bindings.length && next.every((b, i) => b === model.bindings[i]);
  return same ? model : { ...model, bindings: next };
}
