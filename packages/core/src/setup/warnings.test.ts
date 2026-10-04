import { createEmptyProject, type Model, type Part, type StandardPartType } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { newGroupPart } from './hierarchy';
import { setupWarnings } from './warnings';

function model(types: StandardPartType[]): Model {
  const parts: Part[] = types.map((t, i) => ({
    ...newGroupPart(`p${i}`, 'bodyRoot'),
    kind: 'image',
    standardType: t,
    name: t,
  }));
  return { ...createEmptyProject('t').model, parts };
}

const FULL_EYES: StandardPartType[] = ['eyeWhiteL', 'irisL', 'upperLidL', 'eyeWhiteR', 'irisR', 'upperLidR'];
const FULL_MOUTH: StandardPartType[] = ['upperLip', 'lowerLip', 'mouthInside'];

describe('setupWarnings', () => {
  it('推奨パーツがそろっていれば警告は無い（目全体・口全体・頬などは推奨ではない）', () => {
    expect(setupWarnings(model([...FULL_EYES, ...FULL_MOUTH, 'face']))).toEqual([]);
  });

  it('口のパーツが1つも無ければ、口の開閉が作られないと伝える', () => {
    expect(setupWarnings(model([...FULL_EYES, 'face']))).toEqual([
      '上唇・下唇・口の中がないため、口の開閉は作られません',
    ]);
  });

  it('白目が無く目全体があれば、瞳の動く幅は目全体の大きさで決める', () => {
    const types = FULL_EYES.filter((t) => t !== 'eyeWhiteR');
    expect(setupWarnings(model([...types, 'eyeWholeR', ...FULL_MOUTH]))).toEqual([
      '白目 R がないため、まばたきは目全体を縦に縮める方式になります',
      '白目 R がないため、瞳 R は白目の形で切り抜かれず、動く幅は目全体 R の大きさで決めます',
    ]);
  });

  it('下唇が無ければ口全体を伸ばす方式になる', () => {
    expect(setupWarnings(model([...FULL_EYES, 'upperLip', 'mouthInside']))).toEqual([
      '下唇がないため、口の開閉は口全体を縦に伸ばす方式になります',
    ]);
  });
});
