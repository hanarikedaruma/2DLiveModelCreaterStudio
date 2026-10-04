// 標準パーツの枠の並び（部位ごと）。★（recommended）は推奨
import type { StandardPartType } from '@app/schema';

// 素材を割り当てる標準パーツ（変形グループは除く）
export type AssignableType = Exclude<
  StandardPartType,
  | 'bodyRoot'
  | 'armRootL'
  | 'armRootR'
  | 'neckRoot'
  | 'headRoot'
  | 'faceGroup'
  | 'eyeGroupL'
  | 'eyeGroupR'
  | 'mouthGroup'
>;

export interface SlotDef {
  type: AssignableType;
  label: string;
  recommended?: boolean;
}

export interface SlotSection {
  id: string;
  title: string;
  slots: SlotDef[];
}

function eye(side: 'L' | 'R'): SlotDef[] {
  return [
    { type: `eyeWhite${side}`, label: '白目', recommended: true },
    { type: `iris${side}`, label: '瞳', recommended: true },
    { type: `highlight${side}`, label: 'ハイライト' },
    { type: `upperLid${side}`, label: '上まぶた', recommended: true },
    { type: `lowerLid${side}`, label: '下まぶた' },
    { type: `eyeWhole${side}`, label: '目（まとめて）' },
  ];
}

export const SLOT_SECTIONS: SlotSection[] = [
  {
    id: 'face',
    title: '顔',
    slots: [
      { type: 'face', label: '顔' },
      { type: 'earL', label: '耳 L' },
      { type: 'earR', label: '耳 R' },
      { type: 'cheek', label: '頬染め' },
    ],
  },
  { id: 'eyeL', title: '左目', slots: eye('L') },
  { id: 'eyeR', title: '右目', slots: eye('R') },
  {
    id: 'brow',
    title: '眉',
    slots: [
      { type: 'browL', label: '眉 L' },
      { type: 'browR', label: '眉 R' },
    ],
  },
  {
    id: 'mouth',
    title: '口',
    slots: [
      { type: 'upperLip', label: '上唇', recommended: true },
      { type: 'lowerLip', label: '下唇', recommended: true },
      { type: 'mouthInside', label: '口の中', recommended: true },
      { type: 'teeth', label: '歯' },
      { type: 'tongue', label: '舌' },
      { type: 'mouthWhole', label: '口（まとめて）' },
    ],
  },
  {
    id: 'hair',
    title: '髪',
    slots: [
      { type: 'frontHair', label: '前髪' },
      { type: 'sideHairL', label: '横髪 L' },
      { type: 'sideHairR', label: '横髪 R' },
      { type: 'backHair', label: '後ろ髪' },
    ],
  },
  {
    id: 'body',
    title: '体',
    slots: [
      { type: 'neck', label: '首' },
      { type: 'torso', label: '胴体' },
      { type: 'armL', label: '腕 L' },
      { type: 'armR', label: '腕 R' },
    ],
  },
];

export const ASSIGNABLE_TYPES: ReadonlySet<StandardPartType> = new Set(
  SLOT_SECTIONS.flatMap((s) => s.slots.map((slot) => slot.type)),
);

export function isAssignableType(type: StandardPartType | null): type is AssignableType {
  return type !== null && ASSIGNABLE_TYPES.has(type);
}
