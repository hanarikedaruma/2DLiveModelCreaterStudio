import { DEFAULT_DEPTH, type Model, type Part } from '@app/schema';
import { imageTypeOf, indexStandardParts, type ImageType } from './standardParts';

// マスクの元（1つずつ、反転なし）
export const MASK_SOURCE: Partial<Record<ImageType, ImageType>> = {
  irisL: 'eyeWhiteL',
  highlightL: 'eyeWhiteL',
  irisR: 'eyeWhiteR',
  highlightR: 'eyeWhiteR',
  teeth: 'mouthInside',
  tongue: 'mouthInside',
};

// マスクを付け、depth が 0 のパーツだけ DEFAULT_DEPTH を入れる（ユーザーが変えた値は残す）。
// マスクの元が無いパーツのマスクはそのまま
export function applyMasksAndDepth(model: Model): Model {
  const index = indexStandardParts(model.parts);
  let changed = false;
  const parts = model.parts.map((part) => {
    const type = imageTypeOf(part);
    if (!type) return part;
    const patch: Partial<Part> = {};
    const sourceType = MASK_SOURCE[type];
    const source = sourceType ? index.first(sourceType) : undefined;
    if (source) {
      const m = part.mask;
      const same = m !== null && !m.inverted && m.sourcePartIds.length === 1 && m.sourcePartIds[0] === source.id;
      if (!same) patch.mask = { sourcePartIds: [source.id], inverted: false };
    }
    const depth = DEFAULT_DEPTH[type];
    if (part.depth === 0 && depth !== undefined && depth !== 0) patch.depth = depth;
    if (Object.keys(patch).length === 0) return part;
    changed = true;
    return { ...part, ...patch };
  });
  return changed ? { ...model, parts } : model;
}
