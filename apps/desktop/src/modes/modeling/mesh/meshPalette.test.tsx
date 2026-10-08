// メッシュのパレットと選択の外し方（モデリングのツールとパレットの整理。docs/modeling-palette-design.md）。
// パレットはメッシュ編集ツールのときだけ出る。画像パーツを選ぶまでは枠が対象を選ぶ段を受け持つ。
// 右クリックで選択を外して選び直せる（目の編集中に誤って顔を押した場面）。何も無い所のクリック・Esc は2段で外す
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Mesh, Project } from '@app/schema';
import { registry } from '../../../shell/registry';
import { register as registerCanvasEdit } from '../canvas';
import { openSample, pointer, renderShell, sampleProject, stubSize } from '../canvas/testUtils';
import { meshEditor, register } from './index';
import { MESH_PICK_PROMPT } from './meshTool';

const FACE = { x: 400, y: 650 }; // 顔（目の外）
const IRIS_L = { x: 595, y: 480 }; // 瞳 L（顔の手前）
const TORSO = { x: 500, y: 1300 }; // 胴体だけがある所
const EMPTY = { x: 50, y: 50 };
// 同じ所をすぐに2回押すと頂点を足すダブルクリックになるので、2回目は少し離れた何も無い所を押す
const EMPTY_2 = { x: 100, y: 100 };

// sample-model の画像パーツに、素材の矩形の 3×3 の格子のメッシュを付けたもの
function withGridMeshes(): Project {
  const p = sampleProject();
  const meshes: Mesh[] = [];
  const parts = p.model.parts.map((part) => {
    const a = p.assets.find((x) => x.id === part.assetId);
    if (!a) return part;
    const uvs = [0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => ({ x, y })));
    meshes.push({
      id: `mesh-${part.id}`,
      vertices: uvs.map((v) => ({ x: a.offset.x + a.width * v.x, y: a.offset.y + a.height * v.y })),
      uvs,
      triangles: [
        [0, 1, 3],
        [1, 4, 3],
        [1, 2, 4],
        [2, 5, 4],
        [3, 4, 6],
        [4, 7, 6],
        [4, 5, 7],
        [5, 8, 7],
      ],
      density: 'custom',
      edited: false,
    });
    return { ...part, meshId: `mesh-${part.id}` };
  });
  return { ...p, model: { ...p.model, parts, meshes } };
}

let restoreSize: () => void = () => {};
beforeEach(() => {
  registry.reset();
  registerCanvasEdit();
  register();
  restoreSize = stubSize(800, 600);
});
afterEach(() => restoreSize());

async function open(select: string[] = []) {
  const shell = renderShell();
  await openSample(shell, withGridMeshes());
  act(() => shell.services.editor.set({ selectedPartIds: select }));
  const panelEl = () => document.querySelector<HTMLElement>('[data-panel-id="mesh"]');
  const selected = () => shell.services.editor.get().selectedPartIds;
  const useMeshTool = () => fireEvent.click(screen.getByRole('button', { name: 'メッシュ編集' }));
  return { ...shell, panelEl, selected, useMeshTool, ptr: pointer(shell.canvas) };
}

describe('メッシュのパレット', () => {
  it('メッシュ編集ツールのときだけ、色付きのツールのパレットとして右の列の上に出る。ツールにするボタンは無い', async () => {
    const shell = await open(['part-torso']);
    expect(shell.panelEl()).toBeNull();
    shell.useMeshTool();
    const el = shell.panelEl()!;
    expect(el.classList.contains('object')).toBe(true);
    expect(el.getAttribute('data-object')).toBe('tool');
    expect(el.parentElement!.firstElementChild).toBe(el);
    expect(within(el).queryByRole('button', { name: 'メッシュ編集ツールにする' })).toBeNull();
    expect(within(el).getByRole('button', { name: '自動生成' })).toBeTruthy();
    // ⓘ で目的と流れを出す
    fireEvent.click(within(el).getByRole('button', { name: '「メッシュ」の説明' }));
    const note = screen.getByRole('note', { name: '「メッシュ」の説明' });
    expect(note.textContent).toMatch(/画像パーツに網（メッシュ）を張り/);
    expect(within(note).getAllByRole('listitem')).toHaveLength(5);
    // ほかのツールにすると消える
    fireEvent.click(screen.getByRole('button', { name: '選択・変形' }));
    expect(shell.panelEl()).toBeNull();
  });

  it('何も選ばずにツールにすると、パレットにもキャンバスと同じ「画像パーツをクリックして選ぶ」の案内を出し、押した所のパーツを選ぶ', async () => {
    const shell = await open();
    shell.useMeshTool();
    expect(within(shell.panelEl()!).getByText(MESH_PICK_PROMPT)).toBeTruthy();
    shell.ptr.click(TORSO);
    expect(shell.selected()).toEqual(['part-torso']);
    expect(within(shell.panelEl()!).getByText('胴体')).toBeTruthy();
  });
});

describe('メッシュ編集中の選択の外し方', () => {
  it('目の編集中に顔を押して顔に替わっても、右クリックで外してから目を押せば目に戻れる', async () => {
    const shell = await open(['part-irisL']);
    shell.useMeshTool();
    // 誤って顔（目の外）を押すと、顔に切り替わる（D1: 今のまま）
    shell.ptr.click(FACE);
    expect(shell.selected()).toEqual(['part-face']);
    // 顔のメッシュの内側にある目を押しても、顔のまま（これまで、体などを選んでから戻る必要があった）
    shell.ptr.click(IRIS_L);
    expect(shell.selected()).toEqual(['part-face']);
    // 右クリックで選択を外し、目を押すと目に戻る
    shell.ptr.rightClick(IRIS_L);
    expect(shell.selected()).toEqual([]);
    shell.ptr.click(IRIS_L);
    expect(shell.selected()).toEqual(['part-irisL']);
  });

  it('右クリックで、頂点とパーツの選択をまとめて外す。同じパーツを選び直しても前の頂点の選択は残らない', async () => {
    const shell = await open(['part-torso']);
    shell.useMeshTool();
    shell.ptr.drag({ x: 100, y: 1100 }, { x: 900, y: 1250 });
    expect(meshEditor.selection.get().indices.length).toBeGreaterThan(0);
    shell.ptr.rightClick(TORSO);
    expect(shell.selected()).toEqual([]);
    expect(meshEditor.selection.get().indices).toEqual([]);
    shell.ptr.click(TORSO);
    expect(shell.selected()).toEqual(['part-torso']);
    expect(meshEditor.selection.get().indices).toEqual([]);
  });

  it('何も無い所のクリックは、1回目で頂点の選択を、2回目でパーツの選択を外す（D2）', async () => {
    const shell = await open(['part-torso']);
    shell.useMeshTool();
    shell.ptr.drag({ x: 100, y: 1100 }, { x: 900, y: 1250 });
    const indices = meshEditor.selection.get().indices;
    expect(indices.length).toBeGreaterThan(0);
    shell.ptr.click(EMPTY);
    expect(meshEditor.selection.get().indices).toEqual([]);
    expect(shell.selected()).toEqual(['part-torso']);
    shell.ptr.click(EMPTY_2);
    expect(shell.selected()).toEqual([]);
    // Shift を押しながらのクリックでは外さない
    shell.ptr.click(TORSO);
    shell.ptr.click(EMPTY, { shiftKey: true });
    expect(shell.selected()).toEqual(['part-torso']);
  });

  it('Esc も同じ2段で外す', async () => {
    const shell = await open(['part-torso']);
    shell.useMeshTool();
    shell.ptr.drag({ x: 100, y: 1100 }, { x: 900, y: 1250 });
    const stage = screen.getByTestId('canvas-stage');
    fireEvent.keyDown(stage, { key: 'Escape' });
    expect(meshEditor.selection.get().indices).toEqual([]);
    expect(shell.selected()).toEqual(['part-torso']);
    fireEvent.keyDown(stage, { key: 'Escape' });
    expect(shell.selected()).toEqual([]);
  });
});
