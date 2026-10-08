import type { Part, StandardPartType } from '@app/schema';

// かんたんセットアップが作る変形グループ（作る順）
export const GROUP_TYPES = [
  'bodyRoot',
  'armRootL',
  'armRootR',
  'neckRoot',
  'headRoot',
  'faceGroup',
  'eyeGroupL',
  'eyeGroupR',
  'mouthGroup',
] as const satisfies readonly StandardPartType[];
export type GroupType = (typeof GROUP_TYPES)[number];
export type ImageType = Exclude<StandardPartType, GroupType>;

const GROUP_SET: ReadonlySet<string> = new Set(GROUP_TYPES);

export function isGroupType(type: StandardPartType): type is GroupType {
  return GROUP_SET.has(type);
}

// 割り当て済みの標準の画像パーツなら、その種類
export function imageTypeOf(part: Part): ImageType | null {
  const type = part.standardType;
  return part.kind === 'image' && type !== null && !isGroupType(type) ? type : null;
}

// かんたんセットアップの変形グループなら、その種類
export function groupTypeOf(part: Part): GroupType | null {
  const type = part.standardType;
  return part.kind === 'group' && type !== null && isGroupType(type) ? type : null;
}

// 階層の木での親（bodyRoot は根）
export const TREE_PARENT: Record<Exclude<StandardPartType, 'bodyRoot'>, GroupType> = {
  torso: 'bodyRoot',
  chest: 'bodyRoot', // 実際の胴体への接続は胸のセットアップで姿勢を保って行う
  armRootL: 'bodyRoot',
  armL: 'armRootL',
  armRootR: 'bodyRoot',
  armR: 'armRootR',
  neckRoot: 'bodyRoot',
  neck: 'neckRoot',
  headRoot: 'neckRoot',
  backHair: 'headRoot',
  faceGroup: 'headRoot',
  face: 'faceGroup',
  eyeGroupL: 'faceGroup',
  eyeWhiteL: 'eyeGroupL',
  irisL: 'eyeGroupL',
  highlightL: 'eyeGroupL',
  upperLidL: 'eyeGroupL',
  lowerLidL: 'eyeGroupL',
  eyeWholeL: 'eyeGroupL',
  eyeGroupR: 'faceGroup',
  eyeWhiteR: 'eyeGroupR',
  irisR: 'eyeGroupR',
  highlightR: 'eyeGroupR',
  upperLidR: 'eyeGroupR',
  lowerLidR: 'eyeGroupR',
  eyeWholeR: 'eyeGroupR',
  browL: 'faceGroup',
  browR: 'faceGroup',
  mouthGroup: 'faceGroup',
  mouthInside: 'mouthGroup',
  teeth: 'mouthGroup',
  tongue: 'mouthGroup',
  upperLip: 'mouthGroup',
  lowerLip: 'mouthGroup',
  mouthWhole: 'mouthGroup',
  cheek: 'faceGroup',
  earL: 'headRoot',
  earR: 'headRoot',
  sideHairL: 'headRoot',
  sideHairR: 'headRoot',
  frontHair: 'headRoot',
};

// 木で上にある変形グループ（近い順、bodyRoot まで）
export function groupChain(type: StandardPartType): GroupType[] {
  const out: GroupType[] = [];
  let t: StandardPartType = type;
  while (t !== 'bodyRoot') {
    const parent: GroupType = TREE_PARENT[t];
    out.push(parent);
    t = parent;
  }
  return out;
}

export type Side = 'L' | 'R';
export const SIDES: Side[] = ['L', 'R'];

// 片目のパーツの種類
export function eyeTypes(side: Side) {
  return {
    eyeWhite: `eyeWhite${side}`,
    iris: `iris${side}`,
    highlight: `highlight${side}`,
    upperLid: `upperLid${side}`,
    lowerLid: `lowerLid${side}`,
    eyeWhole: `eyeWhole${side}`,
    group: `eyeGroup${side}`,
  } as const satisfies Record<string, StandardPartType>;
}

export const MOUTH_TYPES = ['mouthInside', 'teeth', 'tongue', 'upperLip', 'lowerLip', 'mouthWhole'] as const;

// 標準の画像パーツと変形グループを種類ごとにまとめたもの（parts の順）
export interface StandardIndex {
  images(type: ImageType): Part[];
  first(type: ImageType): Part | undefined;
  group(type: GroupType): Part | undefined;
  has(type: ImageType): boolean;
}

export function indexStandardParts(parts: readonly Part[]): StandardIndex {
  const images = new Map<ImageType, Part[]>();
  const groups = new Map<GroupType, Part>();
  for (const part of parts) {
    const image = imageTypeOf(part);
    if (image) images.set(image, [...(images.get(image) ?? []), part]);
    const group = groupTypeOf(part);
    if (group && !groups.has(group)) groups.set(group, part);
  }
  return {
    images: (type) => images.get(type) ?? [],
    first: (type) => images.get(type)?.[0],
    group: (type) => groups.get(type),
    has: (type) => images.has(type),
  };
}
