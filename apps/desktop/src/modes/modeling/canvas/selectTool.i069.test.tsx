import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Part, Vec2 } from '@app/schema';
import type { ProjectStoreWithHistory } from '@app/core';
import type { CanvasController } from '../../../shell/canvas/controller';
import { registry } from '../../../shell/registry';
import { register, selectTool } from './index';
import { ROTATE_HANDLE_DISTANCE } from './selectTool';
import { RecordingContext, openSample, pointer, renderShell, stubSize } from './testUtils';

let restoreSize: () => void = () => {};
beforeEach(() => {
  registry.reset();
  register();
  restoreSize = stubSize(800, 600);
});
afterEach(() => restoreSize());

async function open() {
  const shell = renderShell();
  await openSample(shell);
  const store = shell.services.store as ProjectStoreWithHistory;
  const part = (id: string): Part => store.get().model.parts.find((p) => p.id === id)!;
  const selected = () => shell.services.editor.get().selectedPartIds;
  return { ...shell, store, part, selected, ptr: pointer(shell.canvas) };
}

const near = (a: Vec2, b: Vec2, digits = 3) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};
const cursor = () => screen.getByTestId('canvas-overlay').style.cursor;
const texts = (canvas: CanvasController) => {
  const ctx = new RecordingContext();
  selectTool.tool.drawOverlay!(ctx.asContext(), canvas.getState().view);
  return ctx.texts;
};

// fixtures の点（キャンバス座標）。全体表示で倍率 0.36（余白 24px はキャンバスで約 67）
const TORSO = { x: 500, y: 1300 }; // 胴体だけがある所
const ARM_ON_TORSO = { x: 760, y: 1000 }; // 胴体の枠の中で、腕 L が手前にある所
const BACK_HAIR_ABOVE_TORSO = { x: 420, y: 825 }; // 胴体の枠のすぐ上の外（画面で約 5px。ハンドルから離れた所）。後ろ髪がある
const FACE = { x: 400, y: 650 }; // 胴体の枠から画面で約 68px 上
const EMPTY = { x: 50, y: 50 };
const TORSO_PIVOT = { x: 500, y: 1170 };
const BACK_HAIR_ONLY = { x: 230, y: 820 }; // 後ろ髪だけがある所
const BACK_HAIR_PIVOT = { x: 500, y: 505 }; // 後ろ髪の◎。手前に顔がある

describe('I-069: 操作中の対象を固定する（選択・変形）', () => {
  it('枠の中で手前に別のパーツ（腕）があっても、選んでいる胴体を動かし、切り替えない', async () => {
    const { ptr, part, selected } = await open();
    ptr.click(TORSO);
    ptr.drag(ARM_ON_TORSO, { x: ARM_ON_TORSO.x + 30, y: ARM_ON_TORSO.y });
    expect(selected()).toEqual(['part-torso']);
    near(part('part-torso').position, { x: 30, y: 0 });
    expect(part('part-armL').position).toEqual({ x: 0, y: 0 });
  });

  it('枠のすぐ外（余白の中）で後ろの後ろ髪を押しても、胴体の操作になる', async () => {
    const { ptr, part, selected } = await open();
    ptr.click(TORSO);
    ptr.drag(BACK_HAIR_ABOVE_TORSO, { x: BACK_HAIR_ABOVE_TORSO.x, y: BACK_HAIR_ABOVE_TORSO.y + 40 });
    expect(selected()).toEqual(['part-torso']);
    near(part('part-torso').position, { x: 0, y: 40 });
    expect(part('part-backHair').position).toEqual({ x: 0, y: 0 });
  });

  it('余白より外のパーツを押すと切り替わり、最初の操作は選ぶだけ（I-050）。遠くの何も無い所で外れる', async () => {
    const { ptr, part, selected } = await open();
    ptr.click(TORSO);
    ptr.drag(FACE, { x: FACE.x - 30, y: FACE.y });
    expect(selected()).toEqual(['part-face']);
    expect(part('part-face').position).toEqual({ x: 0, y: 0 });
    ptr.click(EMPTY);
    expect(selected()).toEqual([]);
  });

  it('Ctrl+クリックで、枠の中でも押した所のパーツへ切り替える（動かさない）。何も無い所なら外す', async () => {
    const { ptr, part, selected } = await open();
    ptr.click(TORSO);
    ptr.drag(ARM_ON_TORSO, { x: ARM_ON_TORSO.x + 30, y: ARM_ON_TORSO.y }, { ctrlKey: true });
    expect(selected()).toEqual(['part-armL']);
    expect(part('part-armL').position).toEqual({ x: 0, y: 0 });
    expect(part('part-torso').position).toEqual({ x: 0, y: 0 });
    ptr.click(EMPTY, { ctrlKey: true });
    expect(selected()).toEqual([]);
  });

  it('Shift+クリックは今と同じく、枠の中でも押した所のパーツを足す', async () => {
    const { ptr, selected } = await open();
    ptr.click(TORSO);
    ptr.click(ARM_ON_TORSO, { shiftKey: true });
    expect(selected()).toEqual(['part-torso', 'part-armL']);
  });

  it('◎は中心から画面で 10px の所でもつかめる', async () => {
    const { ptr, part, canvas } = await open();
    ptr.click(TORSO);
    const scale = canvas.getState().view.scale;
    ptr.drag({ x: TORSO_PIVOT.x + 10 / scale, y: TORSO_PIVOT.y }, { x: TORSO_PIVOT.x + 10 / scale, y: 1250 });
    expect(part('part-torso').pivot.y).toBeCloseTo(1250, 0);
    expect(part('part-torso').position).toEqual({ x: 0, y: 0 });
  });

  it('動かせない◎（パラメータの編集中）を押しても、◎の上の顔には切り替わらない', async () => {
    const { ptr, selected, services } = await open();
    ptr.click(BACK_HAIR_ONLY);
    expect(selected()).toEqual(['part-backHair']);
    act(() => services.editor.set({ activeParameterIds: ['FaceAngleX'] }));
    ptr.click(BACK_HAIR_PIVOT);
    expect(selected()).toEqual(['part-backHair']);
  });

  it('マウスの形: 選ぶ前は既定、範囲の中は移動、拡縮・回転・◎はそれぞれ、余白より外は既定', async () => {
    const { ptr, canvas } = await open();
    ptr.hover(TORSO);
    expect(cursor()).toBe('default');
    ptr.click(TORSO);
    ptr.hover(TORSO);
    expect(cursor()).toBe('move');
    ptr.hover(ARM_ON_TORSO);
    expect(cursor()).toBe('move');
    ptr.hover({ x: 800, y: 1500 });
    expect(cursor()).toBe('nwse-resize');
    ptr.hover({ x: 800, y: 1170 });
    expect(cursor()).toBe('ew-resize');
    ptr.hover({ x: 500, y: 1500 });
    expect(cursor()).toBe('ns-resize');
    ptr.hover({ x: 200, y: 1500 });
    expect(cursor()).toBe('nesw-resize');
    ptr.hover({ x: 500, y: 840 - ROTATE_HANDLE_DISTANCE / canvas.getState().view.scale });
    expect(cursor()).toBe('grab');
    ptr.hover(TORSO_PIVOT);
    expect(cursor()).toBe('grab');
    ptr.hover(FACE);
    expect(cursor()).toBe('default');
  });

  it('余白より外で別のパーツの上にマウスがあると、押すと切り替わる先の名前を出す。範囲の中では出さない', async () => {
    const { ptr, canvas, part } = await open();
    ptr.click(TORSO);
    ptr.hover(FACE);
    expect(texts(canvas)).toContain(part('part-face').name);
    ptr.hover(ARM_ON_TORSO);
    expect(texts(canvas)).not.toContain(part('part-armL').name);
    ptr.hover(BACK_HAIR_ABOVE_TORSO);
    expect(texts(canvas)).not.toContain(part('part-backHair').name);
  });
});
