import { createEmptyProject, type Model, type Part } from '@app/schema';
import { describe, expect, it } from 'vitest';
import type { Rect } from '../generate/bounds';
import { newGroupPart } from './hierarchy';
import { computePivots, imagePivot } from './pivots';

function image(id: string, patch: Partial<Part> = {}): Part {
  return { ...newGroupPart(id, 'bodyRoot'), kind: 'image', standardType: null, name: id, ...patch };
}
const group = (id: string, type: Part['standardType'], parentId: string | null = null): Part => ({
  ...newGroupPart(id, 'bodyRoot'),
  standardType: type,
  parentId,
});

function model(parts: Part[]): Model {
  return { ...createEmptyProject('t').model, parts };
}

const pivotOf = (m: Model, id: string) => m.parts.find((p) => p.id === id)!.pivot;

describe('imagePivot', () => {
  const r: Rect = { x: 10, y: 20, width: 40, height: 60 };
  it('髪は上端中央、白目は下端中央、その他は中心', () => {
    expect(imagePivot('frontHair', r)).toEqual({ x: 30, y: 20 });
    expect(imagePivot('backHair', r)).toEqual({ x: 30, y: 20 });
    expect(imagePivot('sideHairL', r)).toEqual({ x: 30, y: 20 });
    expect(imagePivot('eyeWhiteR', r)).toEqual({ x: 30, y: 80 });
    expect(imagePivot('irisL', r)).toEqual({ x: 30, y: 50 });
    expect(imagePivot('eyeWholeL', r)).toEqual({ x: 30, y: 50 });
  });
});

describe('computePivots', () => {
  const rects: Record<string, Rect> = {
    torso: { x: 100, y: 500, width: 200, height: 300 },
    armL: { x: 300, y: 520, width: 40, height: 200 },
    neck: { x: 180, y: 400, width: 40, height: 120 },
    face: { x: 120, y: 150, width: 160, height: 260 },
    eyeA: { x: 200, y: 250, width: 40, height: 20 },
    eyeB: { x: 210, y: 240, width: 60, height: 20 },
    free: { x: 0, y: 0, width: 10, height: 10 },
  };
  const boundsOf = (p: Part) => rects[p.id] ?? null;

  function full(): Model {
    return model([
      group('body', 'bodyRoot'),
      group('armRoot', 'armRootL', 'body'),
      group('neckRoot', 'neckRoot', 'body'),
      group('head', 'headRoot', 'neckRoot'),
      group('faceG', 'faceGroup', 'head'),
      group('eyeG', 'eyeGroupL', 'faceG'),
      image('torso', { standardType: 'torso', parentId: 'body' }),
      image('armL', { standardType: 'armL', parentId: 'armRoot' }),
      image('neck', { standardType: 'neck', parentId: 'neckRoot' }),
      image('face', { standardType: 'face', parentId: 'faceG' }),
      image('eyeA', { standardType: 'eyeWhiteL', parentId: 'eyeG' }),
      image('eyeB', { standardType: 'upperLidL', parentId: 'eyeG' }),
      image('free', { parentId: 'head', pivot: { x: 7, y: 7 } }),
    ]);
  }

  it('変形グループのピボット', () => {
    const out = computePivots(full(), boundsOf, { width: 1000, height: 2000 });
    expect(pivotOf(out, 'body')).toEqual({ x: 200, y: 800 }); // 胴体の下端中央
    expect(pivotOf(out, 'armRoot')).toEqual({ x: 320, y: 520 }); // 腕の上端中央
    expect(pivotOf(out, 'neckRoot')).toEqual({ x: 200, y: 520 }); // 首の下端中央
    expect(pivotOf(out, 'head')).toEqual({ x: 200, y: 400 }); // 首の上端中央
    expect(pivotOf(out, 'eyeG')).toEqual({ x: 235, y: 255 }); // 子の外接矩形の中心
    expect(pivotOf(out, 'faceG')).toEqual({ x: 200, y: 280 });
  });

  it('画像パーツのピボット。自由パーツはそのまま', () => {
    const out = computePivots(full(), boundsOf, null);
    expect(pivotOf(out, 'eyeA')).toEqual({ x: 220, y: 270 }); // 白目は下端中央
    expect(pivotOf(out, 'face')).toEqual({ x: 200, y: 280 });
    expect(pivotOf(out, 'free')).toEqual({ x: 7, y: 7 });
  });

  it('首が無ければ neckRoot と headRoot は顔の下端中央、胴体が無ければ bodyRoot はキャンバスの下端中央', () => {
    const m = full();
    const out = computePivots({ ...m, parts: m.parts.filter((p) => p.id !== 'neck' && p.id !== 'torso') }, boundsOf, {
      width: 1000,
      height: 2000,
    });
    expect(pivotOf(out, 'neckRoot')).toEqual({ x: 200, y: 410 });
    expect(pivotOf(out, 'head')).toEqual({ x: 200, y: 410 });
    expect(pivotOf(out, 'body')).toEqual({ x: 500, y: 2000 });
  });

  it('決められないピボットはそのまま。変わらなければ同じ参照', () => {
    const m = model([group('armRoot', 'armRootR', null), image('x', { standardType: 'irisL' })]);
    const out = computePivots(m, boundsOf, null);
    expect(out).toBe(m);
    const once = computePivots(full(), boundsOf, null);
    expect(computePivots(once, boundsOf, null)).toBe(once);
  });
});
