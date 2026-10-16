// I-039・I-067 頭の向き。顔の向き（FaceAngleX・FaceAngleY）を、頭（headRoot）の共通の姿勢として1つ決め、
// 顔・目鼻口・髪・耳のそれぞれを、パーツの種類ごとの規則で動かす（同じワープを全部に掛けない）。
//
// 左右（FaceAngleX）は I-067 の体系（docs/i-067-face-turn-plan.md の「手で直した所の体系」）の規則。
// 量はユーザーが手で直したモデルの最終的な動きを、顔の幅などに対する割合にしたもの:
// - 顔の表面（顔・頬など）: 輪郭の縁も向きへ動き、内側はふくらんで大きく動く（頂上は近い側の目のあたり）。
//   あごへ向かって小さくなる。立ち絵の頭が傾いていても、頭の向きに沿って回す（あご先と両目の中点を結ぶ線を頭の
//   縦の軸とし、横の位置と動く向きはそれと直角の軸で測る。A1〜A3）。
// - 目: 目の中心の表面の動きを目のグループの位置のキーにし、遠い側の目は目のグループのワープで、目の中心を基準に横へ
//   詰める（A8、W1。目頭を基準にすると目が内へずれる）。目のグループが無ければ、目の部品の頂点で同じ動きを作る。
// - 眉・口: 中心の表面の動きで平行に動かし、遠い側の眉と口を横に詰める（口は口のグループで）。
// - 耳は見える側を大きく、後ろ髪は向きと逆へ、前髪は顔より少なく上へ、横髪は向く側を詰め、首はあごの影だけ
//   あごに付けて動かす（A6・A9〜A12）。
// 上下（FaceAngleY）は、頭を楕円体とみなして表面に沿って回す（あごと頭の上端は動かない）。後ろ髪・耳は逆へ少し動く。
//
// キーは 0 と ±30（間は直線。ユーザーは中間のキーを消して ±30 だけで直していた）。斜めは ±30 の4隅の補正
// （左右だけ・上下だけの和からの差）。手で直したキー・ロックしたキーは、自動セットアップの再実行で残る
import type { Mesh, Model, Part, Vec2, Warp } from '@app/schema';
import type { TargetDeltas } from '@app/contracts';
import { pointsToAncestorSpace, pointsToModelSpace } from '../deform/space';
import { isUsableWarp } from '../deform/warp';
import { rectOfPoints, type Rect } from '../generate/bounds';
import { clean, transformDelta } from '../generate/keys';
import { withGroupWarp } from './faceTurn';
import type { BindingPlan } from './motions';
import type { BoundsOf } from './pivots';
import type { PointPlan } from './step1';
import { indexStandardParts, type ImageType } from './standardParts';

const NO_DELTAS: TargetDeltas = { transforms: {}, vertices: {}, warpPoints: {} };
const DEG = Math.PI / 180;

// 頭の楕円（headRoot の空間）。顔の素材の形から求める。上下（FaceAngleY）に使う
export interface HeadShape {
  cx: number;
  cy: number;
  ax: number; // 横の半径
  ay: number; // 縦の半径（あごが下端、上は顔の上端より上まで）
}

// パラメータ ±30 のときの上下の角度（度）。モデルごとに求める
export interface HeadLimits {
  pitch: number;
}

// 上下（FaceAngleY）の層。surface = 頭の表面に沿って回す（gain は表面からの浮き。前髪は少し大きく、横髪は小さく）、
// behind = 頭の後ろ側で、向きと逆へ平行に動く（後ろ髪・耳）
export type HeadLayer = { kind: 'surface'; gain: number } | { kind: 'behind'; gain: number };

// 頭の寸法の決め方（顔の素材の外接矩形に対する割合）
export const HEAD_SHAPE = {
  widthRatio: 1.05, // 横の半径 = 顔の幅 / 2 × これ
  topRatio: 0.3, // 顔の上端より、顔の高さ × これだけ上まで頭とみなす（前髪の付け根まで回す）
};
// 上下の角度の上限を決める目安（目・眉・口の頂点が、回したあと楕円の中心からこの角度を超えない）と、上限・下限
export const HEAD_LIMIT = {
  featurePitch: 55,
  maxPitch: 14,
  minPitch: 4,
};
// 斜め（左右 ±30 と上下 ±30 を同時）は、左右・上下それぞれのこの割合の動きにする。
// そのまま足すと目鼻が四隅へ寄りすぎるため（左右と上下の和で動く量を抑える）
export const HEAD_DIAGONAL_SCALE = 0.75;

// 左右（FaceAngleX）±30 の顔の表面の動き。量は顔の幅に対する割合。横の位置 q は、頭の横の軸に沿った顔の中心からの
// 位置を顔の幅の半分で割り、近い側（向きと逆の側）を負にしたもの。頭の横の軸は、あご先と両目の中点を結ぶ線
// （頭の縦の軸）と直角の向き。ユーザーは傾いた頭を正方向（この縦の軸がまっすぐ）に直してから左右を付けていたので、
// 量はその座標で測った（I-067 の計画の「頭の傾き」）
export const HEAD_YAW = {
  rim: 0.05, // 輪郭の縁の動き（近い側・遠い側とも向きへ）
  bulge: 0.1, // 内側のふくらみ（縁の動きに足す）
  peak: -0.5, // ふくらみの頂上の q（近い側の目のあたり）
  chinFade: 0.8, // 顔の高さの 1/4 より下で、あご先までにふくらみが減る割合
  maxRoll: 20, // 頭の傾きとみなす上限（度）
};
// 顔の部品の形（±30 での横の幅の比）
export const FEATURE_YAW = {
  eyeFar: 0.81, // 遠い側の目（目のグループのワープで、目の中心を基準に詰める）
  eyeCornerX: 0.03, // 遠い側の目の下の目尻を、さらに内へ（目の幅に対する割合）
  eyeCornerY: 0.05, // 同じく上へ（目の高さに対する割合）
  browFar: 0.87, // 遠い側の眉（中心を基準に詰める）
  mouth: 0.94, // 口（中心を基準に、どちらを向いても）
};
// 耳・髪・首の規則（±30。移動は顔の幅に対する割合）
export const LAYER_YAW = {
  sideReach: 0.35, // 標準でない後ろのパーツは、中心が顔の中心からこれ（顔の幅に対する割合）より外なら横髪の規則
  earMoveVisible: 0.058, // 見える側（近い側）の耳は向きへ
  earMoveHidden: 0.027, // 隠れる側の耳は少しだけ向きへ（輪郭の縁より少なく動き、顔に隠れていく）
  earVisible: { x: 1.15, y: 1.05 }, // 見える側（近い側）の耳の拡大
  earHidden: 0.94, // 隠れる側の耳の縮小
  sideHairMove: 0.07, // 横髪は向きへ
  sideHairTurnSide: 0.85, // 向く側の横髪の横の倍率（中心を基準に）
  frontHairFlow: 0.55, // 前髪は、その所の顔の表面の動き × これ
  frontHairLift: 0.01, // 前髪を上へ（上端を基準に小さくする分と合わせて、顔の幅の 2〜3%）
  frontHairScale: 0.97, // 前髪の大きさ（上端の中央を基準に）
  backHairMove: -0.042, // 後ろ髪は向きと逆へ
  backHairScaleX: 0.97, // 後ろ髪の横の倍率（中心を基準に）
  neckBand: 0.35, // あごの動きに付ける首の上部（首の高さに対する割合）
  neckEdge: 0.15, // 動かさない首の縁（首の幅に対する割合、左右それぞれ）
};

// 上下の層の表（標準パーツの種類 → 層）
const SURFACE: ImageType[] = [
  'face',
  'cheek',
  'eyeWhiteL',
  'irisL',
  'highlightL',
  'upperLidL',
  'lowerLidL',
  'eyeWholeL',
  'eyeWhiteR',
  'irisR',
  'highlightR',
  'upperLidR',
  'lowerLidR',
  'eyeWholeR',
  'browL',
  'browR',
  'upperLip',
  'lowerLip',
  'mouthInside',
  'teeth',
  'tongue',
  'mouthWhole',
];
// 上下の角度の上限を決める部品（目・眉・口）
const FEATURES: ImageType[] = SURFACE.filter((t) => t !== 'face' && t !== 'cheek');
const EYE_TYPES: ImageType[] = SURFACE.filter((t) => /^(eyeWhite|iris|highlight|upperLid|lowerLid|eyeWhole)/.test(t));
const MOUTH_PARTS: ImageType[] = ['upperLip', 'lowerLip', 'mouthInside', 'teeth', 'tongue', 'mouthWhole'];

export function layerOfType(type: ImageType | null, depth: number): HeadLayer {
  if (type === 'frontHair') return { kind: 'surface', gain: 1.05 };
  if (type === 'sideHairL' || type === 'sideHairR') return { kind: 'surface', gain: 0.55 };
  if (type === 'backHair') return { kind: 'behind', gain: 0.35 };
  if (type === 'earL' || type === 'earR') return { kind: 'behind', gain: 0.25 };
  if (type && SURFACE.includes(type)) return { kind: 'surface', gain: 1 };
  // 標準パーツでないもの: 手前（奥行きが 0 以上）なら表面、後ろなら後ろ側
  return depth >= 0 ? { kind: 'surface', gain: 1 } : { kind: 'behind', gain: 0.35 };
}

// 左右の規則。eye・mouth は、目・口のグループ（group）の子孫ならグループのキーで動かす
type YawRole =
  | { kind: 'surface' }
  | { kind: 'eye'; group: Part | null; key: string }
  | { kind: 'brow' }
  | { kind: 'mouth'; group: Part | null }
  | { kind: 'ear' }
  | { kind: 'sideHair' }
  | { kind: 'frontHair' }
  | { kind: 'backHair' };

function roleOf(type: ImageType | null, layer: HeadLayer, eyeGroup: Part | null, mouthGroup: Part | null): YawRole {
  if (eyeGroup) return { kind: 'eye', group: eyeGroup, key: eyeGroup.id };
  if (mouthGroup) return { kind: 'mouth', group: mouthGroup };
  if (type && EYE_TYPES.includes(type)) return { kind: 'eye', group: null, key: type.endsWith('L') ? 'L' : 'R' };
  if (type === 'browL' || type === 'browR') return { kind: 'brow' };
  if (type && MOUTH_PARTS.includes(type)) return { kind: 'mouth', group: null };
  if (type === 'earL' || type === 'earR') return { kind: 'ear' };
  if (type === 'sideHairL' || type === 'sideHairR') return { kind: 'sideHair' };
  if (type === 'frontHair') return { kind: 'frontHair' };
  if (type === 'backHair') return { kind: 'backHair' };
  return layer.kind === 'surface' ? { kind: 'surface' } : { kind: 'backHair' };
}

// ---- 1つの点の動き（headRoot の空間） ----

const clampUnit = (v: number, m = 0.999) => Math.min(m, Math.max(-m, v));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
type Mat2 = [number, number, number, number];
const apply2 = ([a, b, c, d]: Mat2, v: Vec2): Vec2 => ({ x: a * v.x + b * v.y, y: c * v.x + d * v.y });
const add = (p: Vec2, q: Vec2): Vec2 => ({ x: p.x + q.x, y: p.y + q.y });
const sub = (p: Vec2, q: Vec2): Vec2 => ({ x: p.x - q.x, y: p.y - q.y });
const scaleVec = (p: Vec2, k: number): Vec2 => ({ x: p.x * k, y: p.y * k });
const ZERO: Vec2 = { x: 0, y: 0 };

// 表面の層の点を、上下 pitch（ラジアン。上が正）だけ回した位置
function pitchOnSurface(p: Vec2, head: HeadShape, gain: number, pitch: number): Vec2 {
  const { cx, cy, ax, ay } = head;
  if (pitch === 0) return p;
  const h = ay * Math.sqrt(1 - clampUnit((p.x - cx) / ax) ** 2);
  const v = (p.y - cy) / h;
  if (Math.abs(v) >= 1) return p;
  const g = Math.asin(v); // 下が正
  return { x: p.x, y: cy + h * Math.sin(g - pitch * gain * Math.cos(g)) };
}

// 上下の動き（後ろ側の層は向きと逆へ平行に動く。上を向くと下へ）
export function pitchPoint(p: Vec2, head: HeadShape, layer: HeadLayer, pitch: number): Vec2 {
  return layer.kind === 'surface'
    ? pitchOnSurface(p, head, layer.gain, pitch)
    : { x: p.x, y: p.y + layer.gain * head.ay * Math.sin(pitch) * 0.5 };
}

// 左右の動きの基準（headRoot の空間）。頭の横の軸 ax・縦の軸 ay と、その軸で測った顔の範囲
interface YawFrame {
  origin: Vec2; // 頭の座標の原点（顔の外接矩形の中心）
  ax: Vec2; // 頭の横の軸（画面の右寄りの向き）
  ay: Vec2; // 頭の縦の軸（下向き。あご先の向き）
  center: number; // 横の軸に沿った顔の中心（原点から）
  top: number; // 縦の軸に沿った顔の上端（原点から）
  width: number; // 横の軸に沿った顔の幅
  height: number; // 縦の軸に沿った顔の高さ
}

const dot = (p: Vec2, q: Vec2) => p.x * q.x + p.y * q.y;
// 頭の座標（u = 横の軸に沿った顔の中心からの位置、w = 縦の軸に沿った顔の上端からの位置）
const toHead = (p: Vec2, f: YawFrame) => {
  const d = sub(p, f.origin);
  return { u: dot(d, f.ax) - f.center, w: dot(d, f.ay) - f.top };
};

// 顔の表面の、左右 s（値 / 30。−1〜1）での動き（頭の横の軸の向き）
export function yawSurface(p: Vec2, frame: YawFrame, s: number): Vec2 {
  if (s === 0) return ZERO;
  const { u, w } = toHead(p, frame);
  const q = clamp((u / (frame.width / 2)) * Math.sign(s), -1, 1);
  const peak = HEAD_YAW.peak;
  const phi =
    q <= peak ? Math.sin(((Math.PI / 2) * (q + 1)) / (peak + 1)) : Math.cos(((Math.PI / 2) * (q - peak)) / (1 - peak));
  const v = w / frame.height;
  const psi = 1 - HEAD_YAW.chinFade * clamp((v - 0.25) / 0.75, 0, 1);
  const d = s * frame.width * (HEAD_YAW.rim + HEAD_YAW.bulge * phi * psi);
  return scaleVec(frame.ax, d);
}

// 遠い側か（その点が、頭の横の軸で s の向きの側にあるか）
const isFar = (p: Vec2, frame: YawFrame, s: number) => toHead(p, frame).u * s > 0;

// ---- モデルから ----

interface HeadPart {
  part: Part;
  mesh: Mesh | null; // メッシュが無ければ素材の矩形の点で動かし、位置のキーにする
  type: ImageType | null;
  layer: HeadLayer;
  role: YawRole;
  points: Vec2[]; // headRoot の空間の頂点
  back: Mat2; // headRoot の空間の差分を、パーツの空間（頂点の差分の空間）へ戻す行列
}

function imageTypeOfPart(part: Part): ImageType | null {
  return part.kind === 'image' && part.standardType !== null ? (part.standardType as ImageType) : null;
}

// fromId の空間の小さな移動を headRoot の空間へ写す線形部分の逆（near のまわり）
function backMatrix(model: Model, fromId: string, headId: string, near: Vec2, toModel = false): Mat2 {
  const lift = (pts: Vec2[]) =>
    toModel
      ? pointsToModelSpace(model, NO_DELTAS, fromId, pts)
      : pointsToAncestorSpace(model, NO_DELTAS, fromId, headId, pts);
  const [o, ex, ey] = lift([near, { x: near.x + 1, y: near.y }, { x: near.x, y: near.y + 1 }]);
  const a = ex!.x - o!.x;
  const b = ey!.x - o!.x;
  const c = ex!.y - o!.y;
  const d = ey!.y - o!.y;
  const det = a * d - b * c;
  return Math.abs(det) > 1e-12 ? [d / det, -b / det, -c / det, a / det] : [1, 0, 0, 1];
}

const centerOf = (points: readonly Vec2[]): Vec2 => {
  const r = rectOfPoints(points);
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : ZERO;
};

// headRoot の子孫の画像パーツと規則。標準パーツでないものは、いちばん近い標準の画像の祖先の種類を使う。
// 目・口のグループの子孫は、種類によらずグループで動かす。
// メッシュが無いパーツは素材の矩形の 3×3 の点を使う（boundsOf が無いか矩形が無ければ除く）
function headParts(model: Model, headId: string, boundsOf?: BoundsOf): HeadPart[] {
  const parts = new Map(model.parts.map((p) => [p.id, p]));
  const meshes = new Map(model.meshes.map((m) => [m.id, m]));
  const index = indexStandardParts(model.parts);
  const featureGroups = new Map(
    (['eyeGroupL', 'eyeGroupR', 'mouthGroup'] as const).flatMap((t) => {
      const g = index.group(t);
      return g ? [[g.id, g] as const] : [];
    }),
  );
  const out: HeadPart[] = [];
  for (const part of model.parts) {
    if (part.kind !== 'image') continue;
    const found = part.meshId !== null ? meshes.get(part.meshId) : undefined;
    const mesh = found && found.vertices.length > 0 ? found : null;
    const rect = mesh ? null : boundsOf?.(part);
    const vertices: Vec2[] = mesh
      ? mesh.vertices
      : rect
        ? // 素材の矩形の 3×3 の点（四隅だけだと楕円の縁に乗って動かないため、中ほどの点も入れる）
          [0, 0.5, 1].flatMap((fy) =>
            [0, 0.5, 1].map((fx) => ({ x: rect.x + rect.width * fx, y: rect.y + rect.height * fy })),
          )
        : [];
    if (vertices.length === 0) continue;
    let type: ImageType | null = imageTypeOfPart(part);
    let underHead = false;
    let eyeGroup: Part | null = null;
    let mouthGroup: Part | null = null;
    const seen = new Set<string>();
    for (let id = part.parentId; id !== null && !seen.has(id); id = parts.get(id)?.parentId ?? null) {
      seen.add(id);
      if (id === headId) {
        underHead = true;
        break;
      }
      const group = featureGroups.get(id);
      if (group && !eyeGroup && !mouthGroup) {
        if (group.standardType === 'mouthGroup') mouthGroup = group;
        else eyeGroup = group;
      }
      const ancestor = parts.get(id);
      if (!type && ancestor) type = imageTypeOfPart(ancestor);
    }
    if (!underHead) continue;
    const points = pointsToAncestorSpace(model, NO_DELTAS, part.id, headId, vertices);
    const layer = layerOfType(type, part.depth);
    out.push({
      part,
      mesh,
      type,
      layer,
      role: roleOf(type, layer, eyeGroup, mouthGroup),
      points,
      back: backMatrix(model, part.id, headId, centerOf(vertices)),
    });
  }
  return out;
}

// 頭の楕円。顔（標準パーツ face）の頂点の外接矩形から求める。顔が無ければ null
export function headShapeOf(parts: readonly { type: ImageType | null; points: Vec2[] }[]): HeadShape | null {
  const face = faceRectOf(parts);
  if (!face) return null;
  const headTop = face.y - face.height * HEAD_SHAPE.topRatio;
  const bottom = face.y + face.height;
  return {
    cx: face.x + face.width / 2,
    cy: (headTop + bottom) / 2,
    ax: (face.width / 2) * HEAD_SHAPE.widthRatio,
    ay: (bottom - headTop) / 2,
  };
}

function faceRectOf(parts: readonly { type: ImageType | null; points: Vec2[] }[]): Rect | null {
  const r = rectOfPoints(parts.filter((p) => p.type === 'face').flatMap((p) => p.points));
  return r && r.width > 0 && r.height > 0 ? r : null;
}

// 上下の角度の上限（度）。目・眉・口の頂点の、楕円の中心から見た角度が、回したあと目安の角度を超えない最大の角度
export function headLimitsOf(parts: readonly HeadPart[], head: HeadShape): HeadLimits {
  let pitch: number = HEAD_LIMIT.maxPitch;
  for (const p of parts) {
    if (!p.type || !FEATURES.includes(p.type) || p.layer.kind !== 'surface') continue;
    for (const v of p.points) {
      const h = head.ay * Math.sqrt(1 - clampUnit((v.x - head.cx) / head.ax) ** 2);
      const g = Math.asin(clampUnit((v.y - head.cy) / h));
      pitch = Math.min(pitch, (HEAD_LIMIT.featurePitch * DEG - Math.abs(g)) / (p.layer.gain * Math.cos(g)) / DEG);
    }
  }
  return { pitch: Math.max(HEAD_LIMIT.minPitch, pitch) };
}

// 頭の傾き（ラジアン。頭の横の軸の、画面の右からの傾き）。あご先（顔のいちばん下の点）と両目の中点を結ぶ線を頭の
// 縦の軸とする。目・眉・口の線は、少し斜めから描いた絵では縦の軸と直角にならないので使わない
// （このモデルでは目の線 −12.7°、縦の軸からは −8.1°。ユーザーは頭を +7.98° 回して正方向に直していた）。
// 両目が無ければ 0
export function headRollOf(facePoints: readonly Vec2[], eyeCenters: readonly Vec2[]): number {
  if (facePoints.length === 0 || eyeCenters.length !== 2) return 0;
  const bottom = Math.max(...facePoints.map((q) => q.y));
  const height = bottom - Math.min(...facePoints.map((q) => q.y));
  // あご先は、いちばん下の点のまわり（顔の高さの 1% 以内）の平均
  const chin = facePoints.filter((q) => q.y >= bottom - height * 0.01);
  const c = { x: chin.reduce((s, q) => s + q.x, 0) / chin.length, y: bottom };
  const mid = { x: (eyeCenters[0]!.x + eyeCenters[1]!.x) / 2, y: (eyeCenters[0]!.y + eyeCenters[1]!.y) / 2 };
  const up = sub(mid, c);
  if (!(Math.hypot(up.x, up.y) > height * 0.1)) return 0;
  // 縦の軸（上向き）を 90° 回した、右向きの横の軸の傾き
  const roll = Math.atan2(up.x, -up.y);
  return clamp(roll, -HEAD_YAW.maxRoll * DEG, HEAD_YAW.maxRoll * DEG);
}

// 左右の動きの基準。頭の傾きは、顔の点と左右の目（目のグループか目の部品）の中心から求める
function yawFrameOf(parts: readonly HeadPart[], face: Rect): YawFrame {
  const eyes = new Map<string, Vec2[]>();
  for (const p of parts) {
    if (p.role.kind !== 'eye') continue;
    eyes.set(p.role.key, [...(eyes.get(p.role.key) ?? []), ...p.points]);
  }
  const facePoints = parts.filter((p) => p.type === 'face').flatMap((p) => p.points);
  const roll = headRollOf(facePoints, [...eyes.values()].map(centerOf));
  const ax = { x: Math.cos(roll), y: Math.sin(roll) };
  const ay = { x: -ax.y, y: ax.x };
  const origin = { x: face.x + face.width / 2, y: face.y + face.height / 2 };
  const us = facePoints.map((q) => dot(sub(q, origin), ax));
  const ws = facePoints.map((q) => dot(sub(q, origin), ay));
  const [u0, u1, w0, w1] = [Math.min(...us), Math.max(...us), Math.min(...ws), Math.max(...ws)];
  return { origin, ax, ay, center: (u0 + u1) / 2, top: w0, width: u1 - u0, height: w1 - w0 };
}

// グループで動かす目・口の、グループの中の点（headRoot の空間）の中心と範囲
interface GroupInfo {
  group: Part;
  rect: Rect;
  center: Vec2;
  back: Mat2; // headRoot の空間の差分を、グループの位置のキーの空間（親の空間）へ戻す行列
}

// 左右 s での、パーツの点の動き（headRoot の空間）。total = 全体の動き、vertex = 頂点のキーに入れる分
// （グループの位置のキーで動かす分を除いたもの）
function yawMotion(
  p: HeadPart,
  frame: YawFrame,
  groups: ReadonlyMap<string, GroupInfo>,
  rects: ReadonlyMap<string, Rect>,
  s: number,
): { total: Vec2[]; vertex: Vec2[] } {
  const none = p.points.map(() => ZERO);
  if (s === 0) return { total: none, vertex: none };
  const a = Math.abs(s);
  const role = p.role;
  const { ax, ay } = frame;
  // anchor を基準に、頭の横の軸に沿って ratio 倍にする動き
  const alongAxis = (ratio: number, anchor: Vec2) =>
    p.points.map((q) => scaleVec(ax, dot(sub(q, anchor), ax) * (ratio - 1)));
  switch (role.kind) {
    case 'surface': {
      const total = p.points.map((q) => yawSurface(q, frame, s));
      return { total, vertex: total };
    }
    case 'eye': {
      const info = role.group ? groups.get(role.group.id) : undefined;
      if (info) {
        // グループの位置のキーで平行に動かす（形はグループのワープ）
        const move = yawSurface(info.center, frame, s);
        return { total: p.points.map(() => move), vertex: none };
      }
      // グループが無ければ、目の部品の頂点で動かし、遠い側を目の中心を基準に詰める
      const r = rects.get(role.key)!;
      const center = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      const move = yawSurface(center, frame, s);
      const squash = isFar(center, frame, s) ? alongAxis(1 + (FEATURE_YAW.eyeFar - 1) * a, center) : none;
      const total = squash.map((d) => add(d, move));
      return { total, vertex: total };
    }
    case 'brow': {
      const r = rectOfPoints(p.points)!;
      const center = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      const move = yawSurface(center, frame, s);
      const squash = isFar(center, frame, s) ? alongAxis(1 + (FEATURE_YAW.browFar - 1) * a, center) : none;
      const total = squash.map((d) => add(d, move));
      return { total, vertex: total };
    }
    case 'mouth': {
      const info = role.group ? groups.get(role.group.id) : undefined;
      const r = info?.rect ?? rects.get('mouth')!;
      const center = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      const move = yawSurface(center, frame, s);
      const total = alongAxis(1 + (FEATURE_YAW.mouth - 1) * a, center).map((d) => add(d, move));
      // 口のグループがあれば、グループの位置と横の倍率のキーで動かす
      return { total, vertex: info ? none : total };
    }
    case 'ear': {
      const r = rectOfPoints(p.points)!;
      const center = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      const visible = !isFar(center, frame, s);
      const move = scaleVec(ax, s * frame.width * (visible ? LAYER_YAW.earMoveVisible : LAYER_YAW.earMoveHidden));
      const kx = visible ? LAYER_YAW.earVisible.x : LAYER_YAW.earHidden;
      const ky = visible ? LAYER_YAW.earVisible.y : LAYER_YAW.earHidden;
      // 頭の横の軸・縦の軸に沿って拡大縮小
      const total = p.points.map((q) => {
        const d = sub(q, center);
        return add(move, add(scaleVec(ax, dot(d, ax) * (kx - 1) * a), scaleVec(ay, dot(d, ay) * (ky - 1) * a)));
      });
      return { total, vertex: total };
    }
    case 'sideHair': {
      const r = rectOfPoints(p.points)!;
      const center = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      const move = scaleVec(ax, s * frame.width * LAYER_YAW.sideHairMove);
      const squash = isFar(center, frame, s) ? alongAxis(1 + (LAYER_YAW.sideHairTurnSide - 1) * a, center) : none;
      const total = squash.map((d) => add(d, move));
      return { total, vertex: total };
    }
    case 'frontHair': {
      // 列ごとの横の流れ（その所の顔の表面の動き × 割合）、頭の上へ、上端の中央（頭の座標）を基準に少し小さく
      const us = p.points.map((q) => dot(sub(q, frame.origin), ax));
      const ws = p.points.map((q) => dot(sub(q, frame.origin), ay));
      const top = add(
        frame.origin,
        add(scaleVec(ax, (Math.min(...us) + Math.max(...us)) / 2), scaleVec(ay, Math.min(...ws))),
      );
      const lift = scaleVec(ay, -frame.width * LAYER_YAW.frontHairLift * a);
      const k = (LAYER_YAW.frontHairScale - 1) * a;
      const total = p.points.map((q) =>
        add(add(scaleVec(yawSurface(q, frame, s), LAYER_YAW.frontHairFlow), lift), scaleVec(sub(q, top), k)),
      );
      return { total, vertex: total };
    }
    case 'backHair': {
      const move = scaleVec(ax, s * frame.width * LAYER_YAW.backHairMove);
      const total = alongAxis(1 + (LAYER_YAW.backHairScaleX - 1) * a, centerOf(p.points)).map((d) => add(d, move));
      return { total, vertex: total };
    }
  }
}

// 遠い側の目のワープの制御点の差分（目のグループのワープの空間）。目の中心 center を基準に、頭の横の軸 axis に沿って
// 詰め、下の目尻の角をさらに内（目頭の向き）・上（頭の上 up）へ。outward は目尻の向き（+1 = axis の向き）
export function eyeWarpSquash(warp: Warp, center: Vec2, axis: Vec2, up: Vec2, outward: number, a: number): Vec2[] {
  const { width, height } = warp.bounds;
  const ratio = 1 + (FEATURE_YAW.eyeFar - 1) * a;
  const bottomOuter = outward > 0 ? warp.columns : 0;
  return warp.points.map((p, k) => {
    const i = k % (warp.columns + 1);
    const j = Math.floor(k / (warp.columns + 1));
    let d = scaleVec(axis, dot(sub(p, center), axis) * (ratio - 1));
    if (j === warp.rows) {
      // 下の目尻の角（と隣の列を半分）
      const near = i === bottomOuter ? 1 : Math.abs(i - bottomOuter) === 1 ? 0.5 : 0;
      d = add(d, scaleVec(axis, -outward * width * FEATURE_YAW.eyeCornerX * near * a));
      d = add(d, scaleVec(up, height * FEATURE_YAW.eyeCornerY * near * a));
    }
    return { x: clean(d.x), y: clean(d.y) };
  });
}

const VALUES = [-30, 0, 30];
const CORNERS = [-30, 0, 30];

export interface HeadPosePlan {
  points: PointPlan[]; // 頂点（頭のパーツ・首）と、目のグループのワープの制御点
  transforms: BindingPlan[]; // メッシュの無いパーツの位置のキー（左右・上下）と、目・口のグループの左右のキー
  head: HeadShape | null;
  limits: HeadLimits | null;
}

const mean = (deltas: Vec2[]) => ({
  x: clean(deltas.reduce((s, d) => s + d.x, 0) / deltas.length),
  y: clean(deltas.reduce((s, d) => s + d.y, 0) / deltas.length),
});
const toPart = (back: Mat2, d: Vec2): Vec2 => {
  const v = apply2(back, d);
  return { x: clean(v.x), y: clean(v.y) };
};

// 頭の向きの計画（headRoot の子孫の画像パーツのメッシュごとに、左右・上下・斜めの補正。目・口のグループの左右のキー、
// 目のグループのワープの左右のキー、首のあごの影）
export function planHeadPose(model: Model, boundsOf?: BoundsOf): HeadPosePlan {
  const none: HeadPosePlan = { points: [], transforms: [], head: null, limits: null };
  const index = indexStandardParts(model.parts);
  const headRoot = index.group('headRoot');
  if (!headRoot) return none;
  const parts = headParts(model, headRoot.id, boundsOf);
  const head = headShapeOf(parts);
  const face = faceRectOf(parts);
  if (!head || !face) return none;
  const limits = headLimitsOf(parts, head);
  const frame = yawFrameOf(parts, face);
  // 標準でない後ろのパーツで、顔の横にあるもの（耳の後ろの髪など）は横髪の規則にする
  for (const p of parts) {
    if (p.role.kind !== 'backHair' || p.type === 'backHair') continue;
    if (Math.abs(toHead(centerOf(p.points), frame).u) > frame.width * LAYER_YAW.sideReach)
      p.role = { kind: 'sideHair' };
  }
  const pitchOf = (value: number) => (value / 30) * limits.pitch * DEG;

  // 目・口のグループ（子孫の点の範囲）と、グループの無い目・口の範囲
  const groups = new Map<string, GroupInfo>();
  const rects = new Map<string, Rect>();
  const collect = new Map<string, Vec2[]>();
  for (const p of parts) {
    const key =
      p.role.kind === 'eye'
        ? (p.role.group?.id ?? p.role.key)
        : p.role.kind === 'mouth'
          ? (p.role.group?.id ?? 'mouth')
          : null;
    if (key) collect.set(key, [...(collect.get(key) ?? []), ...p.points]);
  }
  for (const [key, pts] of collect) {
    const r = rectOfPoints(pts);
    if (!r) continue;
    rects.set(key, r);
    const group = model.parts.find((g) => g.id === key && g.kind === 'group');
    if (!group) continue;
    const center = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    const back =
      group.parentId !== null && group.parentId !== headRoot.id
        ? backMatrix(model, group.parentId, headRoot.id, center)
        : ([1, 0, 0, 1] as Mat2);
    groups.set(key, { group, rect: r, center, back });
  }

  const points: PointPlan[] = [];
  const transforms: BindingPlan[] = [];
  const yawAt = (p: HeadPart, value: number) => yawMotion(p, frame, groups, rects, value / 30);
  const pitchAt = (p: HeadPart, pts: readonly Vec2[], value: number) =>
    pts.map((q) => sub(pitchPoint(q, head, p.layer, pitchOf(value)), q));
  // 左右をグループのキーで動かす部品（目・口のグループの子孫）
  const byGroup = (p: HeadPart) =>
    (p.role.kind === 'eye' || p.role.kind === 'mouth') && p.role.group !== null && groups.has(p.role.group.id);
  for (const p of parts) {
    const vertexX = (v: number) => yawAt(p, v).vertex.map((d) => toPart(p.back, d));
    const vertexY = (v: number) => pitchAt(p, p.points, v).map((d) => toPart(p.back, d));
    if (!p.mesh) {
      // メッシュが無ければ、矩形の点の動きの平均だけパーツを動かす（形は変えられない）
      for (const [parameterId, of] of [
        ['FaceAngleX', vertexX],
        ['FaceAngleY', vertexY],
      ] as const) {
        if (parameterId === 'FaceAngleX' && byGroup(p)) continue;
        transforms.push({
          partId: p.part.id,
          parameterId,
          generation: 'linear',
          keys: VALUES.map((v) => ({ coord: v, delta: transformDelta(mean(of(v))) })),
        });
      }
      continue;
    }
    const target = { type: 'mesh' as const, id: p.mesh.id };
    if (!byGroup(p)) {
      points.push({
        target,
        parameterIds: ['FaceAngleX'],
        generation: 'linear',
        keys: VALUES.map((v) => ({ coords: [v], delta: vertexX(v) })),
      });
    }
    points.push({
      target,
      parameterIds: ['FaceAngleY'],
      generation: 'linear',
      keys: VALUES.map((v) => ({ coords: [v], delta: vertexY(v) })),
    });
    const keys: PointPlan['keys'] = [];
    for (const x of CORNERS) {
      for (const y of CORNERS) {
        // 斜めの合計を、左右・上下それぞれ HEAD_DIAGONAL_SCALE の動きにする（軸の上では補正 0）。
        // 斜めの形 = 左右の動きのあと、その位置で上下に回したもの。補正 = それ − 左右だけ − 上下だけ
        const scale = x !== 0 && y !== 0 ? HEAD_DIAGONAL_SCALE : 1;
        const yaw = yawAt(p, x * scale).total;
        const moved = p.points.map((q, i) => add(q, yaw[i]!));
        const both = pitchAt(p, moved, y * scale).map((d, i) => add(d, yaw[i]!));
        const onlyX = yawAt(p, x).total;
        const onlyY = pitchAt(p, p.points, y);
        keys.push({
          coords: [x, y],
          delta: both.map((d, i) => toPart(p.back, sub(sub(d, onlyX[i]!), onlyY[i]!))),
        });
      }
    }
    points.push({ target, parameterIds: ['FaceAngleX', 'FaceAngleY'], generation: 'linear', keys });
  }

  // 目・口のグループの左右のキー（目は位置、口は位置と横の倍率）と、目のグループのワープ
  for (const info of groups.values()) {
    const mouth = info.group.standardType === 'mouthGroup';
    transforms.push({
      partId: info.group.id,
      parameterId: 'FaceAngleX',
      generation: 'linear',
      keys: VALUES.map((v) => {
        const move = toPart(info.back, yawSurface(info.center, frame, v / 30));
        return {
          coord: v,
          delta: transformDelta({
            x: move.x,
            y: move.y,
            scaleX: mouth && v !== 0 ? FEATURE_YAW.mouth : 1,
          }),
        };
      }),
    });
    if (mouth) continue;
    const warp = model.warps.find((w) => w.partId === info.group.id && isUsableWarp(w));
    if (!warp) continue;
    // 目の中心と頭の軸は、ワープの空間で測る（グループの子孫の点の範囲。グループが回っていれば軸も回る）
    const local = eyeLocalRect(model, info.group, boundsOf);
    if (!local) continue;
    const middle = { x: local.x + local.width / 2, y: local.y + local.height / 2 };
    const toWarp = backMatrix(model, info.group.id, headRoot.id, middle);
    const unit = (v: Vec2) => scaleVec(v, 1 / (Math.hypot(v.x, v.y) || 1));
    const axis = unit(apply2(toWarp, frame.ax));
    const up = unit(apply2(toWarp, scaleVec(frame.ay, -1)));
    const outward = toHead(info.center, frame).u > 0 ? 1 : -1; // 頭の右にある目は、目尻が右
    points.push({
      target: { type: 'warp', id: warp.id },
      parameterIds: ['FaceAngleX'],
      generation: 'linear',
      keys: VALUES.map((v) => ({
        coords: [v],
        delta:
          v !== 0 && isFar(info.center, frame, v / 30)
            ? eyeWarpSquash(warp, middle, axis, up, outward, Math.abs(v) / 30)
            : warp.points.map(() => ({ x: 0, y: 0 })),
      })),
    });
  }

  // 首: 上部の内側（あごの影）だけを、あご先の動きに付けて動かす（A6）。首の縁は動かさない
  points.push(...neckPlans(model, index, headRoot, frame));
  return { points, transforms, head, limits };
}

// 目のグループの子孫の画像パーツの点の範囲（グループのワープの空間）
function eyeLocalRect(model: Model, group: Part, boundsOf?: BoundsOf): Rect | null {
  const parts = new Map(model.parts.map((p) => [p.id, p]));
  const meshes = new Map(model.meshes.map((m) => [m.id, m]));
  const pts: Vec2[] = [];
  for (const part of model.parts) {
    if (part.kind !== 'image') continue;
    let under = false;
    const seen = new Set<string>();
    for (let id = part.parentId; id !== null && !seen.has(id); id = parts.get(id)?.parentId ?? null) {
      seen.add(id);
      if (id === group.id) {
        under = true;
        break;
      }
    }
    if (!under) continue;
    const mesh = part.meshId !== null ? meshes.get(part.meshId) : undefined;
    const r = mesh && mesh.vertices.length > 0 ? null : boundsOf?.(part);
    const verts =
      mesh && mesh.vertices.length > 0
        ? mesh.vertices
        : r
          ? [
              { x: r.x, y: r.y },
              { x: r.x + r.width, y: r.y + r.height },
            ]
          : [];
    pts.push(...pointsToAncestorSpace(model, NO_DELTAS, part.id, group.id, verts));
  }
  return rectOfPoints(pts);
}

// 首（標準の neck）のメッシュの、左右のあごの影の頂点のキー
function neckPlans(
  model: Model,
  index: ReturnType<typeof indexStandardParts>,
  headRoot: Part,
  frame: YawFrame,
): PointPlan[] {
  const out: PointPlan[] = [];
  // あご先（頭の座標で顔の下端の中央、headRoot の空間）の動きを、キャンバスの空間へ
  const chin = add(frame.origin, add(scaleVec(frame.ax, frame.center), scaleVec(frame.ay, frame.top + frame.height)));
  const [hc, hx, hy] = pointsToModelSpace(model, NO_DELTAS, headRoot.id, [
    chin,
    { x: chin.x + 1, y: chin.y },
    { x: chin.x, y: chin.y + 1 },
  ]);
  const toModel: Mat2 = [hx!.x - hc!.x, hy!.x - hc!.x, hx!.y - hc!.y, hy!.y - hc!.y];
  for (const neck of index.images('neck')) {
    const mesh = neck.meshId !== null ? model.meshes.find((m) => m.id === neck.meshId) : undefined;
    if (!mesh || mesh.vertices.length === 0) continue;
    const pts = pointsToModelSpace(model, NO_DELTAS, neck.id, mesh.vertices);
    const r = rectOfPoints(pts);
    if (!r || !(r.height > 0) || !(r.width > 0)) continue;
    const back = backMatrix(model, neck.id, headRoot.id, centerOf(mesh.vertices), true);
    const band = r.height * LAYER_YAW.neckBand;
    const edge = r.width * LAYER_YAW.neckEdge;
    const cx = r.x + r.width / 2;
    const weights = pts.map((q) => {
      const wy = clamp(1 - (q.y - r.y) / band, 0, 1);
      const wx = clamp((r.width / 2 - Math.abs(q.x - cx)) / edge, 0, 1);
      return wy * wx;
    });
    // 動いた点は、縁の帯の内側に収める（細い首であごが大きく動いても、首の外へ出さない）
    const inner = { left: r.x + edge, right: r.x + r.width - edge };
    out.push({
      target: { type: 'mesh', id: mesh.id },
      parameterIds: ['FaceAngleX'],
      generation: 'linear',
      keys: VALUES.map((v) => {
        const move = apply2(toModel, yawSurface(chin, frame, v / 30));
        return {
          coords: [v],
          delta: weights.map((w, i) => {
            // 縁の帯の内側を越えて動かさない（もとから帯の中にある点は、そこより外へは動かさない）
            const q = pts[i]!;
            const to = q.x + move.x * w;
            const x = move.x > 0 ? Math.min(to, Math.max(q.x, inner.right)) : Math.max(to, Math.min(q.x, inner.left));
            return toPart(back, { x: x - q.x, y: move.y * w });
          }),
        };
      }),
    });
  }
  return out;
}

// 目のグループに、遠近（A8）のワープが無ければ足す（見た目は変わらない）。すでにあるワープはそのまま使う
export function withEyeWarps(model: Model, boundsOf: BoundsOf, newId: () => string): Model {
  const index = indexStandardParts(model.parts);
  let next = model;
  for (const type of ['eyeGroupL', 'eyeGroupR'] as const) {
    const group = index.group(type);
    if (group) next = withGroupWarp(next, boundsOf, newId, group);
  }
  return next;
}

// 自動セットアップが作る、頭の向きのバインディングか（頭の画像のメッシュ・首のメッシュの頂点、目のグループの
// ワープの制御点の FaceAngleX・Y）
export function isHeadPoseBinding(model: Model, ids: ReadonlySet<string>, b: Model['bindings'][number]): boolean {
  return (
    (b.channel === 'vertices' || b.channel === 'warpPoints') &&
    ids.has(b.target.id) &&
    b.parameterIds.length >= 1 &&
    b.parameterIds.length <= 2 &&
    b.parameterIds.every((id) => id === 'FaceAngleX' || id === 'FaceAngleY') &&
    (model.meshes.some((m) => m.id === b.target.id) || model.warps.some((w) => w.id === b.target.id))
  );
}

// headRoot の子孫の画像パーツのメッシュ・首のメッシュ・目のグループのワープの id
export function headMeshIds(model: Model): Set<string> {
  const index = indexStandardParts(model.parts);
  const headRoot = index.group('headRoot');
  if (!headRoot) return new Set();
  const ids = new Set(headParts(model, headRoot.id).flatMap((p) => (p.mesh ? [p.mesh.id] : [])));
  for (const neck of index.images('neck')) if (neck.meshId !== null) ids.add(neck.meshId);
  for (const type of ['eyeGroupL', 'eyeGroupR'] as const) {
    const group = index.group(type);
    for (const w of model.warps) if (group && w.partId === group.id) ids.add(w.id);
  }
  return ids;
}
