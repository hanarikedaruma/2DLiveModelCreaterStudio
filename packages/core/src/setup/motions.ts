import type { Binding, Model, ParameterKey, Part } from '@app/schema';
import type { Rect } from '../generate/bounds';
import { depthKeySpecs, faceWidthOf, headImageParts, type FaceAngleParameter } from '../generate/depth';
import {
  findTransformBindingIndex,
  rebuildTransformBinding,
  transformDelta,
  type DeltaParts,
  type KeySpec,
} from '../generate/keys';
import type { BoundsOf } from './pivots';
import {
  MOUTH_TYPES,
  SIDES,
  eyeTypes,
  indexStandardParts,
  type ImageType,
  type Side,
  type StandardIndex,
} from './standardParts';

// かんたんセットアップが transform の動きを作るパラメータ（MVP・STEP1・STEP2。口 形は頂点なので含めない）
export const SETUP_PARAMETER_IDS: readonly string[] = [
  'EyeBallX',
  'EyeBallY',
  'FaceAngleZ',
  'FaceAngleX',
  'FaceAngleY',
  'EyeOpenL',
  'EyeOpenR',
  'MouthOpen',
  // STEP1（カード42）
  'EyeSmileL',
  'EyeSmileR',
  'BrowYL',
  'BrowYR',
  'BrowFormL',
  'BrowFormR',
  'MouthWidth',
  'BodyAngleX',
  'BodyAngleZ',
  'Cheek',
  // STEP2（カード53）。揺れもの（HairFront など）は物理の設定のものなので含めない
  'Breath',
  'ArmL',
  'ArmR',
];

// 動きの量
export const SETUP_MOTION = {
  eyeBallX: 0.25, // 白目の幅に対する瞳の左右の移動
  eyeBallY: 0.2, // 白目の高さに対する瞳の上下の移動
  neckTilt: 9, // FaceAngleZ 30 での首の回転（度）
  headTilt: 21, // FaceAngleZ 30 での頭の回転（度）
  eyeWhiteClosed: 0.08, // 閉じた目の白目の縦の倍率
  lowerLidRaise: 0.1, // 閉じた目で下まぶたが上がる量（白目の高さに対する割合）
  eyeSquash: 0.1, // 目全体を縦に縮める方式の倍率
  lowerLipDrop: 0.6, // 口を開けたときの下唇と舌の移動（口の中の高さに対する割合）
  mouthInsideDrop: 0.3, // 口を開けたときの口の中の移動
  mouthStretch: 1.6, // 口全体を縦に伸ばす方式の倍率
};

export interface BindingPlan {
  partId: string;
  parameterId: string;
  generation: Binding['generation'];
  keys: KeySpec[];
  controlsOpacity?: boolean; // キーの opacity でパーツ自身の不透明度を決める（頬染め。I-026）
}

// まばたきの方式。lids = まぶたを動かす、squash = 目全体を縦に縮める、null = 目のパーツが無い
export type BlinkMethod = 'lids' | 'squash' | null;
// 口の開閉の方式。lips = 下唇と口の中を動かす、stretch = 口全体を縦に伸ばす、null = 口のパーツが無い
export type MouthMethod = 'lips' | 'stretch' | null;

function eyePartTypes(side: Side): ImageType[] {
  const t = eyeTypes(side);
  return [t.eyeWhite, t.iris, t.highlight, t.upperLid, t.lowerLid, t.eyeWhole];
}

export function blinkMethod(index: StandardIndex, side: Side): BlinkMethod {
  const t = eyeTypes(side);
  if (!eyePartTypes(side).some((type) => index.has(type))) return null;
  return index.has(t.upperLid) && index.has(t.eyeWhite) ? 'lids' : 'squash';
}

export function mouthMethod(index: StandardIndex): MouthMethod {
  if (!MOUTH_TYPES.some((type) => index.has(type))) return null;
  return index.has('mouthInside') && index.has('lowerLip') ? 'lips' : 'stretch';
}

// 表のとおりのバインディングの計画（キーの位置は表の値とデフォルト値）
export function planMotions(model: Model, boundsOf: BoundsOf): BindingPlan[] {
  const index = indexStandardParts(model.parts);
  const plans: BindingPlan[] = [];
  const zero = transformDelta();
  const add = (part: Part | undefined, parameterId: string, generation: Binding['generation'], keys: KeySpec[]) => {
    if (part) plans.push({ partId: part.id, parameterId, generation, keys });
  };
  // −v・0・v（値 v で at(1)、−v で at(−1)）
  const symmetric = (v: number, at: (sign: number) => DeltaParts): KeySpec[] => [
    { coord: -v, delta: transformDelta(at(-1)) },
    { coord: 0, delta: zero },
    { coord: v, delta: transformDelta(at(1)) },
  ];
  const firstRect = (types: ImageType[]): Rect | null => {
    for (const type of types) {
      const part = index.first(type);
      const rect = part ? boundsOf(part) : null;
      if (rect) return rect;
    }
    return null;
  };

  // 視線: 瞳・ハイライト（瞳が無ければ作らない）
  for (const side of SIDES) {
    const t = eyeTypes(side);
    const ref = index.has(t.iris) ? firstRect([t.eyeWhite, t.eyeWhole, t.iris]) : null;
    if (!ref) continue;
    for (const part of [...index.images(t.iris), ...index.images(t.highlight)]) {
      add(
        part,
        'EyeBallX',
        'linear',
        symmetric(1, (s) => ({ x: s * ref.width * SETUP_MOTION.eyeBallX })),
      );
      add(
        part,
        'EyeBallY',
        'linear',
        symmetric(1, (s) => ({ y: -s * ref.height * SETUP_MOTION.eyeBallY })),
      );
    }
  }

  // 顔の傾き: 首と頭の変形グループ
  add(
    index.group('neckRoot'),
    'FaceAngleZ',
    'linear',
    symmetric(30, (s) => ({ rotation: s * SETUP_MOTION.neckTilt })),
  );
  add(
    index.group('headRoot'),
    'FaceAngleZ',
    'linear',
    symmetric(30, (s) => ({ rotation: s * SETUP_MOTION.headTilt })),
  );

  // 顔の向き: headRoot 配下の画像パーツ（奥行き）
  const faceWidth = faceWidthOf(model, boundsOf);
  if (faceWidth > 0) {
    for (const part of headImageParts(model)) {
      for (const parameterId of ['FaceAngleX', 'FaceAngleY'] satisfies FaceAngleParameter[]) {
        add(part, parameterId, 'depth', depthKeySpecs(part, parameterId, faceWidth));
      }
    }
  }

  // まばたき: 値 0 で閉じる
  const closed = (delta: DeltaParts): KeySpec[] => [
    { coord: 0, delta: transformDelta(delta) },
    { coord: 1, delta: zero },
  ];
  for (const side of SIDES) {
    const t = eyeTypes(side);
    const parameterId = `EyeOpen${side}`;
    const method = blinkMethod(index, side);
    const white = firstRect([t.eyeWhite]);
    if (method === 'lids' && white) {
      for (const lid of index.images(t.upperLid)) {
        const r = boundsOf(lid);
        if (r) add(lid, parameterId, 'linear', closed({ y: white.y + white.height - (r.y + r.height) }));
      }
      for (const part of index.images(t.eyeWhite)) {
        add(part, parameterId, 'linear', closed({ scaleY: SETUP_MOTION.eyeWhiteClosed }));
      }
      for (const lid of index.images(t.lowerLid)) {
        add(lid, parameterId, 'linear', closed({ y: -white.height * SETUP_MOTION.lowerLidRaise }));
      }
    } else if (method === 'squash') {
      // 目が1枚なら目全体のパーツを、ほかのパーツもあれば目の変形グループごと縮める
      const onlyWhole = eyePartTypes(side).every((type) => type === t.eyeWhole || !index.has(type));
      const targets = onlyWhole ? index.images(t.eyeWhole) : [index.group(t.group)];
      for (const part of targets) add(part, parameterId, 'linear', closed({ scaleY: SETUP_MOTION.eyeSquash }));
    }
  }

  // 口の開閉: 値 1 で開く
  const open = (delta: DeltaParts): KeySpec[] => [
    { coord: 0, delta: zero },
    { coord: 1, delta: transformDelta(delta) },
  ];
  const method = mouthMethod(index);
  const inside = firstRect(['mouthInside']);
  if (method === 'lips' && inside) {
    for (const part of [...index.images('lowerLip'), ...index.images('tongue')]) {
      add(part, 'MouthOpen', 'linear', open({ y: inside.height * SETUP_MOTION.lowerLipDrop }));
    }
    for (const part of index.images('mouthInside')) {
      add(part, 'MouthOpen', 'linear', open({ y: inside.height * SETUP_MOTION.mouthInsideDrop }));
    }
  } else if (method === 'stretch') {
    const onlyWhole = MOUTH_TYPES.every((type) => type === 'mouthWhole' || !index.has(type));
    const targets = onlyWhole ? index.images('mouthWhole') : [index.group('mouthGroup')];
    for (const part of targets) add(part, 'MouthOpen', 'linear', open({ scaleY: SETUP_MOTION.mouthStretch }));
  }
  return plans;
}

// 再実行で残すキー
export function keepOnRerun(key: ParameterKey): boolean {
  return key.source === 'manual' || key.locked;
}

// かんたんセットアップのパラメータの1パラメータ transform バインディングで、残すキーが1つも無いもの
function isDisposable(binding: Binding): boolean {
  return (
    binding.channel === 'transform' &&
    binding.target.type === 'part' &&
    binding.parameterIds.length === 1 &&
    SETUP_PARAMETER_IDS.includes(binding.parameterIds[0]!) &&
    !binding.keys.some(keepOnRerun)
  );
}

// 計画をバインディングに入れる。既存のキーのうち manual と locked は残し、それ以外を作り直す。
// 計画に無くなった自動のバインディング（残すキーが無いもの）は消す
export function applyMotionPlans(model: Model, plans: readonly BindingPlan[], newId: () => string): Model {
  const bindings = model.bindings.slice();
  const planned = new Set<string>();
  for (const plan of plans) {
    const at = findTransformBindingIndex(bindings, plan.partId, plan.parameterId);
    const binding = rebuildTransformBinding({
      existing: bindings[at],
      partId: plan.partId,
      parameterId: plan.parameterId,
      keys: plan.keys,
      keep: keepOnRerun,
      generation: plan.generation,
      newId,
      controlsOpacity: plan.controlsOpacity === true,
      opacityBase: model.parts.find((p) => p.id === plan.partId)?.opacity ?? 1,
    });
    planned.add(binding.id);
    if (at >= 0) bindings[at] = binding;
    else bindings.push(binding);
  }
  const next = bindings.filter((b) => planned.has(b.id) || !isDisposable(b));
  const same = next.length === model.bindings.length && next.every((b, i) => b === model.bindings[i]);
  return same ? model : { ...model, bindings: next };
}
