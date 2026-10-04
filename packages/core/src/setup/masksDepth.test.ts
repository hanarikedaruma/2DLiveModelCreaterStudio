import { createEmptyProject, type Model, type Part } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { newGroupPart } from './hierarchy';
import { applyMasksAndDepth } from './masksDepth';

function image(id: string, patch: Partial<Part> = {}): Part {
  return { ...newGroupPart(id, 'bodyRoot'), kind: 'image', standardType: null, name: id, ...patch };
}
function model(parts: Part[]): Model {
  return { ...createEmptyProject('t').model, parts };
}
const get = (m: Model, id: string) => m.parts.find((p) => p.id === id)!;

describe('applyMasksAndDepth', () => {
  it('瞳・ハイライトは同じ側の白目、歯・舌は口の中でマスクする（1つずつ、反転なし）', () => {
    const out = applyMasksAndDepth(
      model([
        image('wL', { standardType: 'eyeWhiteL' }),
        image('wR', { standardType: 'eyeWhiteR' }),
        image('iL', { standardType: 'irisL' }),
        image('hR', { standardType: 'highlightR', mask: { sourcePartIds: ['x', 'y'], inverted: true } }),
        image('in', { standardType: 'mouthInside' }),
        image('teeth', { standardType: 'teeth' }),
        image('tongue', { standardType: 'tongue' }),
        image('lip', { standardType: 'upperLip' }),
      ]),
    );
    expect(get(out, 'iL').mask).toEqual({ sourcePartIds: ['wL'], inverted: false });
    expect(get(out, 'hR').mask).toEqual({ sourcePartIds: ['wR'], inverted: false });
    expect(get(out, 'teeth').mask).toEqual({ sourcePartIds: ['in'], inverted: false });
    expect(get(out, 'tongue').mask).toEqual({ sourcePartIds: ['in'], inverted: false });
    expect(get(out, 'lip').mask).toBeNull();
    expect(get(out, 'wL').mask).toBeNull();
  });

  it('マスクの元が無ければマスクはそのまま', () => {
    const own = { sourcePartIds: ['mine'], inverted: true };
    const out = applyMasksAndDepth(model([image('iL', { standardType: 'irisL', mask: own })]));
    expect(get(out, 'iL').mask).toBe(own);
  });

  it('depth が 0 のパーツだけ DEFAULT_DEPTH を入れ、ユーザーが変えた値は残す', () => {
    const out = applyMasksAndDepth(
      model([
        image('front', { standardType: 'frontHair' }),
        image('back', { standardType: 'backHair', depth: -0.3 }),
        image('ear', { standardType: 'earL' }),
        image('torso', { standardType: 'torso' }),
        image('free'),
      ]),
    );
    expect(get(out, 'front').depth).toBe(1);
    expect(get(out, 'back').depth).toBe(-0.3);
    expect(get(out, 'ear').depth).toBe(-0.5);
    expect(get(out, 'torso').depth).toBe(0);
    expect(get(out, 'free').depth).toBe(0);
  });

  it('変わらなければ同じ参照', () => {
    const once = applyMasksAndDepth(
      model([image('wL', { standardType: 'eyeWhiteL' }), image('iL', { standardType: 'irisL' })]),
    );
    expect(applyMasksAndDepth(once)).toBe(once);
  });
});
