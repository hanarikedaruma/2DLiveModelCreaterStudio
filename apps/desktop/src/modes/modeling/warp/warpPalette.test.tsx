// ワープのパレットの手順とグループの選び方（モデリングのツールとパレットの整理。docs/modeling-palette-design.md）。
// ツールを選んだら、キャンバスでパーツを押してグループを選ぶ（格子の付いたいちばん近い祖先のグループ）。
// 手順 ①②③ の ✓、「対象を変える」、編集中の切り替え（D1）と、何も無い所のクリック・Esc の2段（D2）、右クリックを確かめる
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject, type Part, type Project, type Vec2, type Warp } from '@app/schema';
import { createBindingEvaluator, createDeformPipeline } from '@app/core';
import { createKeyEditor } from '../../../services/keyEditor';
import { registry } from '../../../shell/registry';
import { register as registerCanvasEdit } from '../canvas';
import { pointer, renderShell, stubSize } from '../canvas/testUtils';
import { register, warpEditor } from './index';
import { rectMesh, testAsset } from './testProject';
import { WARP_PICK_PROMPT } from './warpGuide';

// 体（body・格子あり）の子に 腕（arm）と 胸（chest）。腕の子に 手（hand）。髪（hair）はグループに入っていない。
// 手 200..400 × 300..500、胸 500..800 × 500..700 の外接矩形に 5% の余白で、体の格子は 170..830 × 280..720（4×4）
const BOUNDS = { x: 170, y: 280, width: 660, height: 440 };
const HAND = { x: 300, y: 400 };
const CHEST = { x: 620, y: 650 };
const HAIR = { x: 50, y: 50 };
const EMPTY = { x: 950, y: 950 };
const EMPTY_2 = { x: 900, y: 880 }; // すぐに同じ所を2回押さない（ダブルクリックの判定を避ける）

function part(id: string, name: string, kind: 'image' | 'group', parentId: string | null): Part {
  return {
    id,
    name,
    kind,
    standardType: null,
    assetId: kind === 'image' ? `asset-${id}` : null,
    meshId: kind === 'image' ? `mesh-${id}` : null,
    parentId,
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    pivot: { x: 500, y: 500 },
    opacity: 1,
    blendMode: 'normal',
    depth: 0,
    mask: null,
    physicsId: null,
    visible: true,
    locked: false,
  };
}

function bodyWarp(): Warp {
  const points: Vec2[] = [];
  for (let j = 0; j <= 4; j++)
    for (let i = 0; i <= 4; i++)
      points.push({ x: BOUNDS.x + (BOUNDS.width * i) / 4, y: BOUNDS.y + (BOUNDS.height * j) / 4 });
  return { id: 'w-body', partId: 'body', columns: 4, rows: 4, bounds: BOUNDS, points };
}

function project(warps: Warp[] = [bodyWarp()]): Project {
  const p = createEmptyProject('ワープのパレットのテスト');
  return {
    ...p,
    assets: [
      testAsset('asset-hand', { x: 200, y: 300 }, 200, 200),
      testAsset('asset-chest', { x: 500, y: 500 }, 300, 200),
      testAsset('asset-hair', { x: 0, y: 0 }, 100, 100),
    ],
    model: {
      ...p.model,
      parts: [
        part('body', '体', 'group', null),
        part('arm', '腕', 'group', 'body'),
        part('hand', '手', 'image', 'arm'),
        part('chest', '胸', 'image', 'body'),
        part('hair', '髪', 'image', null),
      ],
      meshes: [
        rectMesh('mesh-hand', 200, 300, 200, 200),
        rectMesh('mesh-chest', 500, 500, 300, 200),
        rectMesh('mesh-hair', 0, 0, 100, 100),
      ],
      drawOrder: ['hair', 'hand', 'chest'],
      warps,
    },
  };
}

let restoreSize: () => void = () => {};
beforeEach(() => {
  registry.reset();
  registerCanvasEdit();
  register();
  restoreSize = stubSize(800, 600);
});
afterEach(() => restoreSize());

async function open(initial: Project, select: string[] = []) {
  const shell = renderShell(() => ({
    pipeline: createDeformPipeline(),
    evaluator: createBindingEvaluator(),
    keyEditor: createKeyEditor(),
  }));
  act(() => shell.services.store.load(initial));
  await waitFor(() => expect(shell.canvas.lastDeformed()?.items.length).toBe(3));
  await waitFor(() => expect(shell.canvas.getState().view.scale).toBeCloseTo(0.54));
  act(() => shell.services.editor.set({ selectedPartIds: select }));
  fireEvent.click(screen.getByRole('button', { name: 'ワープ編集' }));
  const palette = () => within(document.querySelector<HTMLElement>('[data-panel-id="warp"]')!);
  const steps = () => Array.from(document.querySelectorAll('.warp-step')).map((li) => li.classList[1]);
  const selected = () => shell.services.editor.get().selectedPartIds;
  return { ...shell, palette, steps, selected, ptr: pointer(shell.canvas) };
}

describe('ワープのパレットの手順', () => {
  it('何も選ばずにツールにすると ① がいまの段で、パレットの案内はキャンバスの帯と同じ文', async () => {
    const shell = await open(project());
    expect(shell.steps()).toEqual(['current', 'todo', 'todo']);
    expect(shell.palette().getByRole('note').textContent).toBe(WARP_PICK_PROMPT);
    expect(warpEditor.tool.target!.prompt).toBe(WARP_PICK_PROMPT);
    expect(document.querySelector('[aria-current="step"]')!.textContent).toMatch(/① パーツを選ぶ/);
  });

  it('画像を押すと、格子の付いたいちばん近い祖先のグループを選び、①② に ✓ が付いて ③ がいまの段になる', async () => {
    const shell = await open(project());
    shell.ptr.click(HAND);
    expect(shell.selected()).toEqual(['body']);
    expect(shell.steps()).toEqual(['done', 'done', 'current']);
    expect(shell.palette().getByText('対象: 体')).toBeTruthy();
    expect(shell.palette().getByTestId('warp-info').textContent).toBe('格子 4×4（制御点 25）');
    expect(shell.palette().getAllByText('✓', { exact: false })).toHaveLength(2);
  });

  it('「対象を変える」で、祖先と、画像を含む一段下の子のグループに替えられる。格子の無いグループは ② がいまの段', async () => {
    const shell = await open(project(), ['body']);
    const choose = shell.palette().getByRole('combobox', { name: '対象を変える' }) as HTMLSelectElement;
    expect([...choose.options].map((o) => [o.value, o.textContent])).toEqual([
      ['body', '体（格子あり）'],
      ['arm', '　腕'],
      ['hand', '　　手'],
      ['chest', '　胸'],
    ]);
    fireEvent.change(choose, { target: { value: 'arm' } });
    expect(shell.selected()).toEqual(['arm']);
    expect(shell.steps()).toEqual(['done', 'current', 'todo']);
    expect((shell.palette().getByRole('button', { name: 'ワープを追加' }) as HTMLButtonElement).disabled).toBe(false);
    // 腕から見た候補は、祖先の体と腕
    const again = shell.palette().getByRole('combobox', { name: '対象を変える' }) as HTMLSelectElement;
    expect([...again.options].map((o) => o.value)).toEqual(['body', 'arm', 'hand']);
  });

  it('祖先にも格子が無ければ、押した画像を直接追加の対象にする', async () => {
    const shell = await open(project([]));
    shell.ptr.click(HAND);
    expect(shell.selected()).toEqual(['hand']);
    // 腕の外の髪を押すと髪（グループに入っていない画像）を選び、グループを選ぶ段に戻る
    shell.ptr.click(HAIR);
    expect(shell.selected()).toEqual(['hair']);
    expect(shell.steps()).toEqual(['done', 'current', 'todo']);
    expect(shell.palette().queryByRole('button', { name: 'グループを作る' })).toBeNull();
    expect((shell.palette().getByRole('button', { name: 'ワープを追加' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('ワープ編集中の選択の切り替えと外し方', () => {
  it('選んでいるグループの中のパーツを押しても替えず、外のパーツを押すとそのグループに替える（D1）', async () => {
    const shell = await open(project(), ['body']);
    shell.ptr.click(HAND);
    expect(shell.selected()).toEqual(['body']);
    act(() => shell.services.editor.set({ selectedPartIds: ['arm'] }));
    shell.ptr.click(CHEST);
    expect(shell.selected()).toEqual(['body']);
  });

  it('何も無い所のクリックは、1回目で制御点の選択を、2回目でグループの選択を外す（D2）', async () => {
    const shell = await open(project(), ['body']);
    // 何も無い所から上の行の左 3 つ（x = 170・335・500）を囲む
    shell.ptr.drag({ x: 150, y: 260 }, { x: 520, y: 300 });
    expect([...warpEditor.selection.get().indices].sort((a, b) => a - b)).toEqual([0, 1, 2]);
    shell.ptr.click(EMPTY);
    expect(warpEditor.selection.get().indices).toEqual([]);
    expect(shell.selected()).toEqual(['body']);
    shell.ptr.click(EMPTY_2);
    expect(shell.selected()).toEqual([]);
    expect(shell.steps()).toEqual(['current', 'todo', 'todo']);
  });

  it('右クリックで制御点とグループの選択を外し、グループを選ぶ段に戻る。Esc も2段で外す', async () => {
    const shell = await open(project(), ['body']);
    shell.ptr.drag({ x: 150, y: 260 }, { x: 520, y: 300 });
    shell.ptr.rightClick(HAND);
    expect(shell.selected()).toEqual([]);
    expect(warpEditor.selection.get().indices).toEqual([]);

    shell.ptr.click(HAND);
    expect(shell.selected()).toEqual(['body']);
    shell.ptr.drag({ x: 150, y: 260 }, { x: 520, y: 300 });
    const stage = screen.getByTestId('canvas-stage');
    fireEvent.keyDown(stage, { key: 'Escape' });
    expect(warpEditor.selection.get().indices).toEqual([]);
    expect(shell.selected()).toEqual(['body']);
    fireEvent.keyDown(stage, { key: 'Escape' });
    expect(shell.selected()).toEqual([]);
  });
});
