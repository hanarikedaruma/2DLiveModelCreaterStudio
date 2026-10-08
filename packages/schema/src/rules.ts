import type {
  BlendMode,
  BlendOp,
  ModeId,
  Parameter,
  ParameterGroup,
  ParameterGroupId,
  StandardPartType,
  TrackingInput,
} from './types';

// Record のキーで列挙するので、型の値をすべて書かないと型検査で落ちる
function keysOf<T extends string>(record: Record<T, true>): [T, ...T[]] {
  return Object.keys(record) as [T, ...T[]];
}

// 1つのバインディングのパラメータの数の上限（I-028 で 2 から増やした。3つ以上は組み合わせのキー）
export const MAX_BINDING_PARAMETERS = 4;

export const BLEND_MODES = keysOf<BlendMode>({ normal: true, multiply: true, screen: true, add: true });
export const BLEND_OPS = keysOf<BlendOp>({ override: true, add: true, multiply: true, max: true });
export const MODE_IDS = keysOf<ModeId>({ modeling: true, animation: true, studio: true });
export const TRACKING_INPUTS = keysOf<TrackingInput>({
  faceYaw: true,
  facePitch: true,
  faceRoll: true,
  eyeOpenL: true,
  eyeOpenR: true,
  eyeBallX: true,
  eyeBallY: true,
  mouthOpen: true,
  mouthForm: true,
  mouthWidth: true,
  browY: true,
});

// face 顔 / eye 目 / brow 眉 / mouth 口 / cheek 頬 / body 体 / armL 左腕 / armR 右腕 / sway 揺れもの / other その他
export const PARAMETER_GROUPS: ParameterGroup[] = [
  { id: 'face', name: '顔' },
  { id: 'eye', name: '目' },
  { id: 'brow', name: '眉' },
  { id: 'mouth', name: '口' },
  { id: 'cheek', name: '頬' },
  { id: 'body', name: '体' },
  { id: 'armL', name: '左腕' },
  { id: 'armR', name: '右腕' },
  { id: 'sway', name: '揺れもの' },
  { id: 'other', name: 'その他' },
];
export const PARAMETER_GROUP_IDS = PARAMETER_GROUPS.map((g) => g.id) as [ParameterGroupId, ...ParameterGroupId[]];

export type StandardPhase = 'mvp' | 'step1' | 'step2';

function param(
  id: string,
  name: string,
  groupId: ParameterGroupId,
  min: number,
  max: number,
  defaultValue: number,
  phase: StandardPhase,
): Parameter & { phase: StandardPhase } {
  return { id, name, groupId, min, max, default: defaultValue, standard: true, phase };
}

const STANDARD_PARAMETER_TABLE = [
  param('FaceAngleX', '顔 左右', 'face', -30, 30, 0, 'mvp'),
  param('FaceAngleY', '顔 上下', 'face', -30, 30, 0, 'mvp'),
  param('FaceAngleZ', '顔 傾き', 'face', -30, 30, 0, 'mvp'),
  param('EyeOpenL', '目 開閉 L', 'eye', 0, 1, 1, 'mvp'),
  param('EyeOpenR', '目 開閉 R', 'eye', 0, 1, 1, 'mvp'),
  param('EyeBallX', '瞳 左右', 'eye', -1, 1, 0, 'mvp'),
  param('EyeBallY', '瞳 上下', 'eye', -1, 1, 0, 'mvp'),
  param('MouthOpen', '口 開閉', 'mouth', 0, 1, 0, 'mvp'),
  param('EyeSmileL', '目 笑顔 L', 'eye', 0, 1, 0, 'step1'),
  param('EyeSmileR', '目 笑顔 R', 'eye', 0, 1, 0, 'step1'),
  param('BrowYL', '眉 上下 L', 'brow', -1, 1, 0, 'step1'),
  param('BrowYR', '眉 上下 R', 'brow', -1, 1, 0, 'step1'),
  param('BrowFormL', '眉 形 L', 'brow', -1, 1, 0, 'step1'), // 困り〜怒り
  param('BrowFormR', '眉 形 R', 'brow', -1, 1, 0, 'step1'),
  param('MouthForm', '口 形', 'mouth', -1, 1, 0, 'step1'), // への字〜笑顔
  param('MouthWidth', '口 横幅', 'mouth', -1, 1, 0, 'step1'), // すぼめ〜横に開く
  param('Cheek', '頬染め', 'cheek', 0, 1, 0, 'step1'),
  param('BodyAngleX', '体 左右', 'body', -10, 10, 0, 'step1'),
  param('BodyAngleY', '体 上下', 'body', -10, 10, 0, 'step1'),
  param('BodyAngleZ', '体 傾き', 'body', -10, 10, 0, 'step1'),
  param('Breath', '呼吸', 'body', 0, 1, 0, 'step2'),
  param('ArmL', '腕 L', 'armL', -1, 1, 0, 'step2'),
  param('ArmR', '腕 R', 'armR', -1, 1, 0, 'step2'),
  param('HairFront', '髪揺れ 前', 'sway', -1, 1, 0, 'step2'),
  param('HairSide', '髪揺れ 横', 'sway', -1, 1, 0, 'step2'),
  param('HairBack', '髪揺れ 後ろ', 'sway', -1, 1, 0, 'step2'),
];

// 標準パラメータの表（standard: true）
export const CHEST_PARAMETERS: Parameter[] = [
  { id: 'BustX', name: '胸揺れ 左右', groupId: 'sway', min: -1, max: 1, default: 0, standard: true },
  { id: 'BustY', name: '胸揺れ 上下', groupId: 'sway', min: -1, max: 1, default: 0, standard: true },
];
export const STANDARD_PARAMETERS: Parameter[] = [
  ...STANDARD_PARAMETER_TABLE.map(({ phase: _phase, ...p }) => p),
  ...CHEST_PARAMETERS,
];

// 標準パラメータの id → 使い始めるフェーズ
export const STANDARD_PARAMETER_PHASES: Record<string, StandardPhase> = Object.fromEntries(
  STANDARD_PARAMETER_TABLE.map((p) => [p.id, p.phase]),
);

const PHASE_RANK: Record<StandardPhase, number> = { mvp: 0, step1: 1, step2: 2 };

// そのフェーズまでに使う標準パラメータ（表の順）
export function standardParametersFor(phase: StandardPhase): Parameter[] {
  return STANDARD_PARAMETERS.filter(
    (p) =>
      STANDARD_PARAMETER_PHASES[p.id] !== undefined &&
      PHASE_RANK[STANDARD_PARAMETER_PHASES[p.id]!] <= PHASE_RANK[phase],
  );
}

// 日本語の表示名
export const STANDARD_PART_NAMES: Record<StandardPartType, string> = {
  face: '顔',
  earL: '耳 L',
  earR: '耳 R',
  cheek: '頬',
  eyeWhiteL: '白目 L',
  irisL: '瞳 L',
  highlightL: 'ハイライト L',
  upperLidL: '上まぶた L',
  lowerLidL: '下まぶた L',
  eyeWholeL: '目全体 L',
  eyeWhiteR: '白目 R',
  irisR: '瞳 R',
  highlightR: 'ハイライト R',
  upperLidR: '上まぶた R',
  lowerLidR: '下まぶた R',
  eyeWholeR: '目全体 R',
  browL: '眉 L',
  browR: '眉 R',
  upperLip: '上唇',
  lowerLip: '下唇',
  mouthInside: '口の中',
  teeth: '歯',
  tongue: '舌',
  mouthWhole: '口全体',
  frontHair: '前髪',
  sideHairL: '横髪 L',
  sideHairR: '横髪 R',
  backHair: '後ろ髪',
  neck: '首',
  torso: '胴体',
  chest: '胸',
  armL: '腕 L',
  armR: '腕 R',
  bodyRoot: '体の変形',
  armRootL: '腕の変形 L',
  armRootR: '腕の変形 R',
  neckRoot: '首の変形',
  headRoot: '頭の変形',
  faceGroup: '顔の変形',
  eyeGroupL: '目の変形 L',
  eyeGroupR: '目の変形 R',
  mouthGroup: '口の変形',
};
export const STANDARD_PART_TYPES = Object.keys(STANDARD_PART_NAMES) as [StandardPartType, ...StandardPartType[]];

// 背面 → 前面
export const STANDARD_DRAW_ORDER: StandardPartType[] = [
  'backHair',
  'torso',
  'chest',
  'armL',
  'armR',
  'neck',
  'earL',
  'earR',
  'face',
  'cheek',
  'mouthInside',
  'teeth',
  'tongue',
  'upperLip',
  'lowerLip',
  'mouthWhole',
  'eyeWhiteL',
  'eyeWhiteR',
  'eyeWholeL',
  'eyeWholeR',
  'irisL',
  'irisR',
  'highlightL',
  'highlightR',
  'lowerLidL',
  'lowerLidR',
  'upperLidL',
  'upperLidR',
  'browL',
  'browR',
  'sideHairL',
  'sideHairR',
  'frontHair',
];

export const DEFAULT_DEPTH: Partial<Record<StandardPartType, number>> = {
  frontHair: 1.0,
  browL: 0.6,
  browR: 0.6,
  eyeWhiteL: 0.5,
  irisL: 0.5,
  highlightL: 0.5,
  upperLidL: 0.5,
  lowerLidL: 0.5,
  eyeWholeL: 0.5,
  eyeWhiteR: 0.5,
  irisR: 0.5,
  highlightR: 0.5,
  upperLidR: 0.5,
  lowerLidR: 0.5,
  eyeWholeR: 0.5,
  upperLip: 0.5,
  lowerLip: 0.5,
  mouthInside: 0.5,
  teeth: 0.5,
  tongue: 0.5,
  mouthWhole: 0.5,
  sideHairL: 0.4,
  sideHairR: 0.4,
  cheek: 0.4,
  face: 0.2,
  earL: -0.5,
  earR: -0.5,
  backHair: -1.0,
};

export const PARALLAX_RATIO = 0.08;

// 奥行きによる移動量（px）。faceWidth は standardType 'face' の素材の幅
export function depthParallaxOffset(depth: number, value: number, faceWidth: number, axis: 'x' | 'y'): number {
  const d = depth * (value / 30) * faceWidth * PARALLAX_RATIO;
  return axis === 'x' ? d : -d; // y は上が負
}
