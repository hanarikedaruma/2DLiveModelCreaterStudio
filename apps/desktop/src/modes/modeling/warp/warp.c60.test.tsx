// カード60（ワープの導線と範囲・I-052・I-009）のテスト。テストの担当は CL（実装の担当は CO）
// 本物の画面（Shell・パーツの設定・キャンバス）と本物の評価・変形パイプライン・KeyEditor を通して、
// 案内が4つの状態を見分けること、「ワープを追加」からそのまま制御点の編集・キーへの記録・Undo まで進めること、
// 範囲の合わせ直しで見た目とキーを変えないこと、既存のワープのキーを作り直さないことを確かめる
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyProject,
  type Binding,
  type Mesh,
  type Model,
  type ParameterKey,
  type Part,
  type Project,
  type Vec2,
  type Warp,
} from '@app/schema';
import type { EditorState, KeyGenerator } from '@app/contracts';
import {
  createBindingEvaluator,
  createDeformPipeline,
  patchPart,
  regularWarpPoints,
  type ProjectStoreWithHistory,
} from '@app/core';
import { createKeyEditor } from '../../../services/keyEditor';
import { registry } from '../../../shell/registry';
import { register as registerCanvasEdit } from '../canvas';
import { RecordingContext, pointer, redrawn, renderShell, stubSize } from '../canvas/testUtils';
import { register as registerStructure } from '../structure';
import { register, warpEditor } from './index';
import { testAsset } from './testProject';
import { refitWarpCommand, warpNeedsRefit } from './warpOps';

// ---- プロジェクト ----
// 体（g）の子に 腕（a）: 200..400 × 300..700 の一部、袖（b）: 500..800 × 500..700。外接矩形 200..800 × 300..700 に
// 5% の余白で、ワープを追加したときの格子の範囲は 170..830 × 280..720。
// 髪（c）はグループに入っていない画像（20..180 × 20..180）。空（empty）は子の無いグループ。
// 頭（head）の子に 顔（h）。頭にはキーのあるワープ（w-head）が最初から付いている

const G_BOUNDS = { x: 170, y: 280, width: 660, height: 440 };
const C_BOUNDS = { x: 12, y: 12, width: 176, height: 176 };
const HEAD_BOUNDS = { x: 594, y: 54, width: 132, height: 132 };

function part(id: string, name: string, kind: 'image' | 'group', patch: Partial<Part> = {}): Part {
  return {
    id,
    name,
    kind,
    standardType: null,
    assetId: kind === 'image' ? `asset-${id}` : null,
    meshId: kind === 'image' ? `mesh-${id}` : null,
    parentId: null,
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
    ...patch,
  };
}

// 四隅と真ん中の頂点のメッシュ（真ん中は 4 番）
function centerMesh(id: string, x: number, y: number, w: number, h: number): Mesh {
  return {
    id,
    vertices: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
      { x: x + w / 2, y: y + h / 2 },
    ],
    uvs: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0.5, y: 0.5 },
    ],
    triangles: [
      [4, 0, 1],
      [4, 1, 2],
      [4, 2, 3],
      [4, 3, 0],
    ],
    density: 'custom',
    edited: false,
  };
}

function wave(n: number, ax: number, ay: number, phase: number): Vec2[] {
  return Array.from({ length: n }, (_, i) => ({
    x: ax * Math.sin(phase + i * 1.1),
    y: ay * Math.cos(phase + i * 0.6),
  }));
}
const zeros = (n: number): Vec2[] => Array.from({ length: n }, () => ({ x: 0, y: 0 }));

function key(coords: number[], delta: Vec2[], source: ParameterKey['source'], locked = false): ParameterKey {
  return { coords, delta, source, locked };
}

function warpBinding(id: string, warpId: string, parameterId: string, keys: ParameterKey[]): Binding {
  return {
    id,
    target: { type: 'warp', id: warpId },
    channel: 'warpPoints',
    parameterIds: [parameterId],
    keyValues: [keys.map((k) => k.coords[0]!)],
    keys,
    generation: 'linear',
    divisions: null,
  };
}

// 基準の制御点を手で動かした格子
function editedWarp(id: string, partId: string, bounds: Warp['bounds'], columns = 4, rows = 4, amount = 6): Warp {
  return {
    id,
    partId,
    columns,
    rows,
    bounds,
    points: regularWarpPoints(bounds, columns, rows).map((p, k) => ({
      x: p.x + amount * Math.sin(k * 1.7),
      y: p.y + amount * Math.cos(k * 0.9),
    })),
  };
}

const headWarp = () => editedWarp('w-head', 'head', HEAD_BOUNDS, 2, 2, 4);
const headBinding = () =>
  warpBinding('b-head', 'w-head', 'FaceAngleX', [
    key([-30], wave(9, 7, 5, 0.4), 'manual', true),
    key([0], zeros(9), 'auto'),
    key([30], wave(9, -6, 8, 1.2), 'generated'),
  ]);

function project(patch: Partial<Model> = {}): Project {
  const p = createEmptyProject('カード60');
  return {
    ...p,
    assets: [
      testAsset('asset-a', { x: 200, y: 300 }, 200, 200),
      testAsset('asset-b', { x: 500, y: 500 }, 300, 200),
      testAsset('asset-c', { x: 20, y: 20 }, 160, 160),
      testAsset('asset-h', { x: 600, y: 60 }, 120, 120),
    ],
    model: {
      ...p.model,
      parts: [
        part('g', '体', 'group'),
        part('a', '腕', 'image', { parentId: 'g' }),
        part('b', '袖', 'image', { parentId: 'g' }),
        part('c', '髪', 'image'),
        part('empty', '空', 'group'),
        part('head', '頭', 'group'),
        part('h', '顔', 'image', { parentId: 'head' }),
      ],
      meshes: [
        centerMesh('mesh-a', 200, 300, 200, 200),
        centerMesh('mesh-b', 500, 500, 300, 200),
        centerMesh('mesh-c', 20, 20, 160, 160),
        centerMesh('mesh-h', 600, 60, 120, 120),
      ],
      drawOrder: ['c', 'a', 'b', 'h'],
      warps: [headWarp()],
      bindings: [headBinding()],
      ...patch,
    },
  };
}

// ---- 画面 ----

// キーの生成（間を生成・再補間など）が呼ばれたかを記録する
function generatorSpy() {
  const calls: string[] = [];
  function record<T>(name: string, value: T): T {
    calls.push(name);
    return value;
  }
  const generator: KeyGenerator = {
    linear: (b) => record('linear', b),
    depthParallax: () => record('depthParallax', []),
    rotate: (b) => record('rotate', b),
    surface: (b) => record('surface', b),
    ease: (b) => record('ease', b),
    regenerate: (b) => record('regenerate', b),
  };
  return { generator, calls };
}

let restoreSize: () => void = () => {};
beforeEach(() => {
  registry.reset();
  registerCanvasEdit();
  registerStructure();
  register();
  restoreSize = stubSize(800, 600);
});
afterEach(() => {
  restoreSize();
  vi.restoreAllMocks();
});

// 詳細モードで開き、tool なら（既定）ワープ編集ツールにする。ワープのパレットはそのツールのときだけ出る
async function open(initial: Project, select: string[], tool = true) {
  const spy = generatorSpy();
  const shell = renderShell(() => ({
    pipeline: createDeformPipeline(),
    evaluator: createBindingEvaluator(),
    keyEditor: createKeyEditor(),
    keyGenerator: spy.generator,
  }));
  act(() => shell.services.store.load(initial));
  await waitFor(() => expect(shell.canvas.lastDeformed()?.items.length).toBe(4));
  await waitFor(() => expect(shell.canvas.getState().view.scale).toBeCloseTo(0.54));
  act(() => shell.services.editor.set({ selectedPartIds: select }));
  if (tool) fireEvent.click(screen.getByRole('button', { name: 'ワープ編集' }));
  const store = shell.services.store as ProjectStoreWithHistory;
  const section = () => within(document.querySelector<HTMLElement>('[data-section-id="modeling.warp"]')!);
  const notes = () =>
    section()
      .queryAllByRole('note')
      .map((n) => n.textContent);
  const warpOf = (partId: string) => store.get().model.warps.find((w) => w.partId === partId);
  const overlay = () => {
    const ctx = new RecordingContext();
    warpEditor.tool.drawOverlay!(ctx.asContext(), shell.canvas.getState().view);
    return ctx;
  };
  const vertex = (partId: string, index: number): Vec2 => {
    const item = shell.canvas.lastDeformed()!.byPartId[partId]!;
    return { x: item.positions[index * 2]!, y: item.positions[index * 2 + 1]! };
  };
  return {
    ...shell,
    store,
    section,
    notes,
    warpOf,
    overlay,
    vertex,
    generatorCalls: spy.calls,
    ptr: pointer(shell.canvas),
  };
}

const activeTool = () =>
  within(screen.getByRole('toolbar', { name: 'キャンバスのツール' }))
    .getAllByRole('button')
    .find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent;

const near = (a: Vec2, b: Vec2, digits = 3) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

// 評価と変形パイプラインで、いくつかのパラメータの値での全画像パーツの頂点を求める
const evaluator = createBindingEvaluator();
const pipeline = createDeformPipeline();
function appearance(model: Model, combos: Record<string, number>[]): Float32Array[] {
  return combos.flatMap((params) => {
    const out = pipeline.deform(model, evaluator.evaluate(model, params));
    return Object.keys(out.byPartId)
      .sort()
      .map((id) => out.byPartId[id]!.positions);
  });
}
function maxDiff(a: Float32Array[], b: Float32Array[]): number {
  expect(b.length).toBe(a.length);
  let max = 0;
  a.forEach((pa, i) => {
    expect(b[i]!.length).toBe(pa.length);
    pa.forEach((v, k) => (max = Math.max(max, Math.abs(v - b[i]![k]!))));
  });
  return max;
}
function combos(axes: Record<string, number[]>): Record<string, number>[] {
  return Object.entries(axes).reduce<Record<string, number>[]>(
    (acc, [id, values]) => acc.flatMap((c) => values.map((v) => ({ ...c, [id]: v }))),
    [{}],
  );
}

const GUIDE = {
  noGroup: /画像を含むグループを選ぶ/,
  noImage: /子に画像パーツが無い/,
  noWarp: /格子が無い.*ワープを追加/,
  preview: /プレビュー中は編集できない/,
};

// ---- 案内 ----

describe('カード60: ワープのツールを選んだときの案内', () => {
  it('未選択・画像が無い・格子が無い・プレビュー中を見分け、パーツの設定とキャンバスに同じ案内を出す', async () => {
    const shell = await open(project(), []);
    fireEvent.click(screen.getByRole('button', { name: 'ワープ編集' }));
    expect(activeTool()).toBe('ワープ編集');

    const states: { set: Partial<EditorState>; guide: RegExp; add: 'none' | 'disabled' | 'enabled' }[] = [
      { set: { selectedPartIds: [] }, guide: GUIDE.noGroup, add: 'none' },
      { set: { selectedPartIds: ['empty'] }, guide: GUIDE.noImage, add: 'disabled' },
      { set: { selectedPartIds: ['g'] }, guide: GUIDE.noWarp, add: 'enabled' },
      { set: { selectedPartIds: ['g'], editorParamValues: { FaceAngleX: 12 } }, guide: GUIDE.preview, add: 'disabled' },
    ];
    const shown: string[] = [];
    for (const state of states) {
      act(() => shell.services.editor.set({ editorParamValues: {}, ...state.set }));
      const label = JSON.stringify(state.set);
      // パーツの設定の案内は1つだけで、その状態のもの
      expect(shell.notes(), label).toHaveLength(1);
      const text = shell.notes()[0]!;
      expect(text, label).toMatch(state.guide);
      // ほかの状態の案内とは違う
      for (const other of Object.values(GUIDE)) if (other !== state.guide) expect(text, label).not.toMatch(other);
      // キャンバスにも同じ案内を描く（折り返しても文字は同じ）
      expect(shell.overlay().texts.join(''), label).toBe(text);
      const add = shell.section().queryByRole('button', { name: 'ワープを追加' }) as HTMLButtonElement | null;
      if (state.add === 'none') expect(add, label).toBeNull();
      else expect(add!.disabled, label).toBe(state.add === 'disabled');
      shown.push(text);
    }
    expect(new Set(shown).size).toBe(4);
    // どの状態でも何も変えていない
    expect(shell.store.canUndo()).toBe(false);
  });

  it('本物のキャンバスの重ね描きでも、ツールを選ぶだけで案内が出て、状態に合わせて変わる', async () => {
    // jsdom のキャンバスは 2D を持たないので、重ね描きのキャンバスの 2D を記録するものに差し替える
    // 描くたびに最初に clearRect を呼ぶので、そこで記録を空にして描いた回数を数える
    class OverlayContext extends RecordingContext {
      canvas = { clientWidth: 800, width: 800 };
      frames = 0;
      setTransform() {}
      clearRect() {
        this.texts = [];
        this.calls = [];
        this.frames++;
      }
    }
    const ctx = new OverlayContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
      type === '2d' ? ctx.asContext() : null) as unknown as HTMLCanvasElement['getContext']);
    const shell = await open(project(), ['a', 'b'], false);
    // 選択・変形ツールの間はワープの案内を描かない
    expect(activeTool()).not.toBe('ワープ編集');
    await waitFor(() => expect(ctx.frames).toBeGreaterThan(0));
    for (const guide of Object.values(GUIDE)) expect(ctx.texts.join('')).not.toMatch(guide);
    fireEvent.click(screen.getByRole('button', { name: 'ワープ編集' }));
    await waitFor(() => expect(ctx.texts.join('')).toMatch(GUIDE.noGroup));
    act(() => shell.services.editor.set({ selectedPartIds: ['empty'] }));
    await waitFor(() => expect(ctx.texts.join('')).toMatch(GUIDE.noImage));
    act(() => shell.services.editor.set({ selectedPartIds: ['g'] }));
    await waitFor(() => expect(ctx.texts.join('')).toMatch(GUIDE.noWarp));
    act(() => shell.services.editor.set({ editorParamValues: { FaceAngleY: -8 } }));
    await waitFor(() => expect(ctx.texts.join('')).toMatch(GUIDE.preview));
    // 頭（ワープあり）・基準状態なら案内は消え、格子の制御点 9 個を描く
    act(() => shell.services.editor.set({ selectedPartIds: ['head'], editorParamValues: {} }));
    await waitFor(() => expect(ctx.named('arc')).toHaveLength(9));
    expect(ctx.texts).toEqual([]);
  });

  it('画像を選ぶと直接追加でき、対象を変える欄で親も選べる', async () => {
    const shell = await open(project(), ['a']);
    expect(shell.notes()).toHaveLength(1);
    expect(shell.notes()[0]).toMatch(GUIDE.noWarp);
    fireEvent.change(shell.section().getByRole('combobox', { name: '対象を変える' }), { target: { value: 'g' } });
    expect(shell.services.editor.get().selectedPartIds).toEqual(['g']);
    expect(shell.notes()[0]).toMatch(GUIDE.noWarp);
    expect(shell.store.canUndo()).toBe(false);

    act(() => shell.services.editor.set({ selectedPartIds: ['c'] }));
    expect(shell.section().queryByRole('button', { name: /グループ「/ })).toBeNull();
    expect(shell.section().queryByRole('button', { name: 'グループを作る' })).toBeNull();
    expect(shell.section().getByText('対象: 髪')).toBeTruthy();
    expect(shell.notes()[0]).toMatch(GUIDE.noWarp);
    expect(shell.store.get().model.parts.find((p) => p.id === 'c')!.parentId).toBeNull();
    expect(shell.store.canUndo()).toBe(false);
  });

  it('格子があり基準状態なら案内は出さない。プレビュー中は理由を出し、範囲の調整と制御点の移動を止める', async () => {
    // 体の格子は腕のまわりだけ（袖は範囲の外）
    const small = editedWarp('w', 'g', { x: 190, y: 290, width: 220, height: 220 }, 4, 4, 0);
    const shell = await open(project({ warps: [headWarp(), small], bindings: [headBinding()] }), ['g']);
    expect(activeTool()).toBe('ワープ編集');
    // 範囲の外を知らせる注意だけで、ツールの案内は無い
    expect(shell.notes()).toHaveLength(1);
    expect(shell.notes()[0]).toMatch(/格子の範囲の外/);
    const base = shell.overlay();
    expect(base.texts).toEqual([]);
    expect(base.named('arc')).toHaveLength(25);
    const refit = () => shell.section().getByRole('button', { name: '範囲を合わせ直す' }) as HTMLButtonElement;
    expect(refit().disabled).toBe(false);

    act(() => shell.services.editor.set({ editorParamValues: { FaceAngleX: 12 } }));
    expect(shell.notes()).toHaveLength(2);
    expect(shell.notes()[0]).toMatch(GUIDE.preview);
    expect(shell.overlay().texts.join('')).toMatch(GUIDE.preview);
    expect(refit().disabled).toBe(true);
    const before = shell.store.get();
    fireEvent.click(refit());
    // 制御点（真ん中は (300,400)）をドラッグしても動かない
    shell.ptr.drag({ x: 300, y: 400 }, { x: 330, y: 420 });
    expect(shell.store.get()).toBe(before);

    act(() => shell.services.editor.set({ editorParamValues: {} }));
    expect(refit().disabled).toBe(false);
    expect(shell.notes()).toHaveLength(1);
  });
});

// ---- 追加から制御点の編集・キー・Undo ----

describe('カード60: 「ワープを追加」からそのまま制御点の編集に入る', () => {
  it('ワープ編集ツールで追加すると、ツールのまま対象・格子の大きさ・選んだ制御点の数を出し、そのまま制御点を動かせる', async () => {
    const shell = await open(project(), ['g']);
    fireEvent.change(shell.section().getByRole('combobox', { name: '横の分割' }), { target: { value: '5' } });
    fireEvent.change(shell.section().getByRole('combobox', { name: '縦の分割' }), { target: { value: '3' } });
    fireEvent.click(shell.section().getByRole('button', { name: 'ワープを追加' }));

    expect(activeTool()).toBe('ワープ編集');
    const warp = shell.warpOf('g')!;
    expect(warp).toMatchObject({ columns: 5, rows: 3 });
    expect(warp.bounds.x).toBeCloseTo(G_BOUNDS.x);
    expect(warp.bounds.y).toBeCloseTo(G_BOUNDS.y);
    expect(warp.bounds.width).toBeCloseTo(G_BOUNDS.width);
    expect(warp.bounds.height).toBeCloseTo(G_BOUNDS.height);
    expect(shell.section().getByText('対象: 体')).toBeTruthy();
    expect(shell.section().getByTestId('warp-info').textContent).toBe('格子 5×3（制御点 24）');
    expect(shell.section().getByText('選んだ制御点: 0 個')).toBeTruthy();
    expect(shell.notes()).toEqual([]);
    const ctx = shell.overlay();
    expect(ctx.texts).toEqual([]);
    expect(ctx.named('arc')).toHaveLength(24);

    // 何も切り替えずに、横 2・縦 1 番目の制御点（8 番、(434, 426.67)）をドラッグする
    const p8 = { x: 170 + 132 * 2, y: 280 + 440 / 3 };
    shell.ptr.drag(p8, { x: p8.x + 30, y: p8.y + 15 });
    near(shell.warpOf('g')!.points[8]!, { x: p8.x + 30, y: p8.y + 15 });
    expect(shell.section().getByText('選んだ制御点: 1 個')).toBeTruthy();
    expect(shell.store.undoLabel()).toBe('制御点の移動');

    // 何も無い所から矩形で上の行の左 3 つ（x ≤ 450、y ≤ 300）を囲む
    shell.ptr.drag({ x: 150, y: 260 }, { x: 450, y: 300 });
    expect([...warpEditor.selection.get().indices].sort((p, q) => p - q)).toEqual([0, 1, 2]);
    expect(shell.section().getByText('選んだ制御点: 3 個')).toBeTruthy();

    act(() => shell.store.undo());
    near(shell.warpOf('g')!.points[8]!, p8);
    act(() => shell.store.undo());
    expect(shell.warpOf('g')).toBeUndefined();
    expect(shell.notes()[0]).toMatch(GUIDE.noWarp);
  });

  it('画像へ直接追加 → 制御点の移動 → キーへの記録 → Undoまで進める', async () => {
    const shell = await open(project(), ['c']);
    const initial = shell.store.get();
    // 1. 画像を選んでいる: グループを作る道が出る
    expect(shell.notes()[0]).toMatch(GUIDE.noWarp);
    const groupId = shell.services.editor.get().selectedPartIds[0]!;
    // 2. 格子が無い: ワープを追加
    expect(shell.notes()[0]).toMatch(GUIDE.noWarp);
    fireEvent.click(shell.section().getByRole('button', { name: 'ワープを追加' }));
    // 3. そのまま制御点の編集
    expect(activeTool()).toBe('ワープ編集');
    expect(shell.notes()).toEqual([]);
    expect(shell.section().getByText('対象: 髪')).toBeTruthy();
    expect(shell.section().getByTestId('warp-info').textContent).toBe('格子 4×4（制御点 25）');
    const warp = shell.warpOf(groupId)!;
    expect(warp.bounds.x).toBeCloseTo(C_BOUNDS.x);
    expect(warp.bounds.width).toBeCloseTo(C_BOUNDS.width);
    // 真ん中の制御点（12 番）は髪の真ん中の頂点 (100,100) の上
    near(warp.points[12]!, { x: 100, y: 100 });

    // 4. 基準状態で制御点を動かすと、髪の真ん中の頂点も動く
    shell.ptr.drag({ x: 100, y: 100 }, { x: 120, y: 110 });
    near(shell.warpOf(groupId)!.points[12]!, { x: 120, y: 110 });
    await redrawn(shell.canvas, (m) => expect(m.byPartId.c!.positions[8]).toBeCloseTo(120, 3));
    near(shell.vertex('c', 4), { x: 120, y: 110 });

    // 5. 顔 左右を編集中にして 30 にすると、プレビューの制限ではなくキーへの記録になる
    act(() => shell.services.editor.set({ activeParameterIds: ['FaceAngleX'], editorParamValues: { FaceAngleX: 30 } }));
    expect(shell.notes()).toEqual([]);
    expect(shell.section().getByText(/パラメータを編集するとキーに記録する/)).toBeTruthy();
    shell.ptr.drag({ x: 120, y: 110 }, { x: 140, y: 95 });
    expect(shell.store.undoLabel()).toBe('制御点の移動');
    const id = shell.warpOf(groupId)!.id;
    const bindings = shell.store.get().model.bindings.filter((b) => b.target.type === 'warp' && b.target.id === id);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({ channel: 'warpPoints', parameterIds: ['FaceAngleX'], keyValues: [[0, 30]] });
    const k30 = bindings[0]!.keys.find((k) => k.coords[0] === 30)!;
    expect(k30).toMatchObject({ source: 'manual', locked: true });
    near((k30.delta as Vec2[])[12]!, { x: 20, y: -15 });
    // 基準の制御点はそのまま
    near(shell.warpOf(groupId)!.points[12]!, { x: 120, y: 110 });
    await redrawn(shell.canvas, (m) => expect(m.byPartId.c!.positions[8]).toBeCloseTo(140, 3));
    near(shell.vertex('c', 4), { x: 140, y: 95 });
    // キーの間（15）は半分
    act(() => shell.services.editor.set({ editorParamValues: { FaceAngleX: 15 } }));
    await redrawn(shell.canvas, (m) => expect(m.byPartId.c!.positions[8]).toBeCloseTo(130, 3));
    near(shell.vertex('c', 4), { x: 130, y: 102.5 });

    // 6. Undo を1回ずつ: キー → 基準の制御点 → ワープ → グループ
    act(() => shell.store.undo());
    expect(shell.store.get().model.bindings.filter((b) => b.target.id === id)).toEqual([]);
    near(shell.warpOf(groupId)!.points[12]!, { x: 120, y: 110 });
    act(() => shell.store.undo());
    near(shell.warpOf(groupId)!.points[12]!, { x: 100, y: 100 });
    act(() => shell.store.undo());
    expect(shell.warpOf(groupId)).toBeUndefined();
    act(() => shell.services.editor.set({ activeParameterIds: [], editorParamValues: {} }));
    expect(shell.notes()[0]).toMatch(GUIDE.noWarp);
    expect(shell.store.get()).toBe(initial);
    expect(shell.store.canUndo()).toBe(false);
    expect(shell.generatorCalls).toEqual([]);
  });
});

// ---- 既存のキー ----

describe('カード60: 既存のワープのキーを作り直さない', () => {
  it('ワープの追加・制御点の移動・キーの記録で、ほかのワープとそのキーは同じもののまま。キーの生成も呼ばない', async () => {
    const initial = project();
    const shell = await open(initial, ['head']);
    // キーのあるワープを選んでツールにしても何も変えない
    expect(shell.section().getByTestId('warp-info').textContent).toBe('格子 2×2（制御点 9）');
    expect(shell.section().queryByRole('button', { name: 'ワープを追加' })).toBeNull();
    expect(shell.store.get()).toBe(initial);

    act(() => shell.services.editor.set({ selectedPartIds: ['g'] }));
    fireEvent.click(shell.section().getByRole('button', { name: 'ワープを追加' }));
    const center = { x: G_BOUNDS.x + G_BOUNDS.width / 2, y: G_BOUNDS.y + G_BOUNDS.height / 2 };
    shell.ptr.drag(center, { x: center.x + 20, y: center.y - 10 });
    act(() =>
      shell.services.editor.set({ activeParameterIds: ['FaceAngleX'], editorParamValues: { FaceAngleX: -30 } }),
    );
    shell.ptr.drag({ x: center.x + 20, y: center.y - 10 }, { x: center.x + 40, y: center.y });
    const model = shell.store.get().model;
    expect(model.warps).toHaveLength(2);
    expect(model.bindings).toHaveLength(2);
    // 新しいワープには、デフォルト値（0）と編集した値（-30）のキーが記録されている
    const added = model.bindings.find((b) => b.id !== 'b-head')!;
    expect(added.target).toEqual({ type: 'warp', id: shell.warpOf('g')!.id });
    expect(added.keys.map((k) => [k.coords[0], k.source])).toEqual([
      [0, 'auto'],
      [-30, 'manual'],
    ]);
    // 頭のワープとキーは、読み込んだときのオブジェクトのまま
    expect(model.warps.find((w) => w.id === 'w-head')).toBe(initial.model.warps[0]);
    expect(model.bindings.find((b) => b.id === 'b-head')).toBe(initial.model.bindings[0]);
    expect(shell.generatorCalls).toEqual([]);
  });

  it('範囲を合わせ直す: 子が外に出たら知らせ、キーの数・位置・自動/手動・ロックと、どのキーの値での見た目も保つ。1回の Undo/Redo', async () => {
    const warp = editedWarp('w', 'g', G_BOUNDS);
    const n = warp.points.length;
    const bx = warpBinding('b-x', 'w', 'FaceAngleX', [
      key([-30], wave(n, 22, 9, 0.3), 'manual', true),
      key([0], zeros(n), 'auto'),
      key([30], wave(n, -15, 18, 2.1), 'generated'),
    ]);
    const by = warpBinding('b-y', 'w', 'FaceAngleY', [
      key([0], zeros(n), 'auto'),
      key([30], wave(n, 12, -10, 4.2), 'combined', true),
    ]);
    const shell = await open(project({ warps: [headWarp(), warp], bindings: [headBinding(), bx, by] }), ['g']);
    const loaded = shell.store.get();
    // 子が範囲の内側なら知らせない
    expect(shell.section().queryByRole('button', { name: '範囲を合わせ直す' })).toBeNull();
    expect(shell.notes()).toEqual([]);

    // 袖を右下へ動かす（900..1200 × 600..800）
    act(() => shell.store.dispatch(patchPart('袖を動かす', 'b', { position: { x: 400, y: 100 } })));
    await redrawn(shell.canvas, (m) => expect(m.byPartId.b!.positions[0]).toBeGreaterThan(850));
    expect(shell.notes()).toHaveLength(1);
    expect(shell.notes()[0]).toMatch(/格子の範囲の外/);
    const before = shell.store.get();
    const values = combos({ FaceAngleX: [-30, -15, 0, 10, 30, 40], FaceAngleY: [0, 12, 30] });
    const shapes = appearance(before.model, values);
    // ワープは実際に形を変えている（比べる意味がある）
    const withoutWarp = appearance(
      {
        ...before.model,
        warps: before.model.warps.filter((w) => w.id !== 'w'),
        bindings: before.model.bindings.filter((b) => b.target.id !== 'w'),
      },
      values,
    );
    expect(maxDiff(shapes, withoutWarp)).toBeGreaterThan(5);
    const canvasBefore = [0, 1, 2, 3, 4].map((i) => shell.vertex('b', i));
    const drawnBefore = shell.canvas.lastDeformed();

    fireEvent.click(shell.section().getByRole('button', { name: '範囲を合わせ直す' }));
    const after = shell.store.get();
    expect(after).not.toBe(before);
    expect(shell.store.undoLabel()).toBe('ワープの範囲を合わせ直す');
    const next = shell.warpOf('g')!;
    expect(next.id).toBe('w');
    expect(next.columns).toBeGreaterThan(4);
    expect(next.rows).toBeGreaterThan(4);
    // 子の外接矩形 200..1200 × 300..800 を囲む
    expect(next.bounds.x).toBeLessThanOrEqual(200);
    expect(next.bounds.y).toBeLessThanOrEqual(300);
    expect(next.bounds.x + next.bounds.width).toBeGreaterThanOrEqual(1200);
    expect(next.bounds.y + next.bounds.height).toBeGreaterThanOrEqual(800);
    expect(warpNeedsRefit(after, next)).toBe(false);
    expect(shell.section().queryByRole('button', { name: '範囲を合わせ直す' })).toBeNull();
    expect(shell.notes()).toEqual([]);
    expect(shell.section().getByTestId('warp-info').textContent).toBe(
      `格子 ${next.columns}×${next.rows}（制御点 ${next.points.length}）`,
    );

    // キーは作り直さず、差分を新しい格子へ写すだけ
    expect(after.model.bindings.map((b) => b.id)).toEqual(['b-head', 'b-x', 'b-y']);
    expect(after.model.bindings[0]).toBe(before.model.bindings[0]);
    expect(after.model.warps.find((w) => w.id === 'w-head')).toBe(before.model.warps[0]);
    for (const [i, original] of [bx, by].entries()) {
      const { keys, ...meta } = after.model.bindings[i + 1]!;
      const { keys: originalKeys, ...originalMeta } = original;
      expect(meta).toEqual(originalMeta);
      expect(keys.map(({ delta: _, ...k }) => k)).toEqual(originalKeys.map(({ delta: _, ...k }) => k));
      for (const k of keys) expect(k.delta as Vec2[]).toHaveLength(next.points.length);
    }
    // どのキーの値でも、キーの間でも、見た目は 0.01px 以内
    expect(maxDiff(appearance(after.model, values), shapes)).toBeLessThan(0.01);
    // キャンバスも描き直したうえで、袖の頂点が同じ位置
    await waitFor(() => expect(shell.canvas.lastDeformed()).not.toBe(drawnBefore));
    [0, 1, 2, 3, 4].forEach((i) => near(shell.vertex('b', i), canvasBefore[i]!, 2));
    expect(shell.generatorCalls).toEqual([]);

    // 1回の Undo で格子とキーが戻り、Redo でもう一度
    act(() => shell.store.undo());
    expect(shell.store.get()).toBe(before);
    expect(shell.store.get().model.bindings[1]).toBe(loaded.model.bindings[1]);
    act(() => shell.store.redo());
    expect(shell.store.get()).toBe(after);
  });

  it('置き換えられない格子（制御点が 65,536 個を超える）なら、何も変えずに理由を知らせる', async () => {
    // 1px のセルの 8×8 の格子。子を囲むには 65,536 個を超える
    const tiny = editedWarp('w', 'g', { x: 495, y: 495, width: 8, height: 8 }, 8, 8, 0);
    const shell = await open(project({ warps: [headWarp(), tiny], bindings: [headBinding()] }), ['g']);
    const before = shell.store.get();
    expect(shell.notes()[0]).toMatch(/格子の範囲の外/);
    fireEvent.click(shell.section().getByRole('button', { name: '範囲を合わせ直す' }));
    expect(await screen.findByText(/範囲を合わせ直せない/)).toBeTruthy();
    expect(shell.store.get()).toBe(before);
    expect(shell.store.canUndo()).toBe(false);
  });
});

// ---- 画面のコマンド（入れ子・回転した親） ----

describe('カード60: refitWarpCommand', () => {
  it('回転・反転した親のワープの中のグループでも、子の範囲を囲むまで広げ、見た目を変えない', () => {
    const base = project();
    const inner = editedWarp('w', 'g', G_BOUNDS, 3, 3, 8);
    const outer = editedWarp('w-outer', 'outer', { x: 100, y: 200, width: 800, height: 600 }, 2, 2, 10);
    const initial: Project = {
      ...base,
      model: {
        ...base.model,
        parts: [
          part('outer', '上半身', 'group', { rotation: 25, scale: { x: -1.3, y: 0.8 } }),
          ...base.model.parts.map((p) =>
            p.id === 'g'
              ? { ...p, parentId: 'outer', rotation: -15, scale: { x: 1.2, y: 0.9 } }
              : p.id === 'b'
                ? { ...p, position: { x: 300, y: -250 } }
                : p,
          ),
        ],
        warps: [headWarp(), inner, outer],
        bindings: [
          headBinding(),
          warpBinding('b-in', 'w', 'FaceAngleX', [
            key([-30], wave(16, 14, 9, 1), 'manual', true),
            key([0], zeros(16), 'auto'),
            key([30], wave(16, -11, 13, 2), 'manual'),
          ]),
          warpBinding('b-out', 'w-outer', 'FaceAngleY', [
            key([0], zeros(9), 'auto'),
            key([30], wave(9, 16, 10, 3), 'manual'),
          ]),
        ],
      },
    };
    const warp = initial.model.warps[1]!;
    expect(warpNeedsRefit(initial, warp)).toBe(true);
    expect(refitWarpCommand(initial, 'missing')).toBeNull();
    const command = refitWarpCommand(initial, 'w')!;
    expect(command).not.toBeNull();
    expect(command.label).toBe('ワープの範囲を合わせ直す');
    const next = command.apply(initial);
    const refitted = next.model.warps.find((w) => w.id === 'w')!;
    expect(refitted.columns).toBeGreaterThan(3);
    expect(warpNeedsRefit(next, refitted)).toBe(false);
    // 外側のワープとそのキー、頭のキーは同じもの
    expect(next.model.warps.find((w) => w.id === 'w-outer')).toBe(outer);
    expect(next.model.bindings.find((b) => b.id === 'b-out')).toBe(initial.model.bindings[2]);
    expect(next.model.bindings.find((b) => b.id === 'b-head')).toBe(initial.model.bindings[0]);

    const values = combos({ FaceAngleX: [-30, -8, 0, 21, 30], FaceAngleY: [0, 13, 30] });
    const shapes = appearance(initial.model, values);
    const withoutInner = {
      ...initial.model,
      warps: initial.model.warps.filter((w) => w.id !== 'w'),
      bindings: initial.model.bindings.filter((b) => b.target.id !== 'w'),
    };
    expect(maxDiff(shapes, appearance(withoutInner, values))).toBeGreaterThan(5);
    expect(maxDiff(appearance(next.model, values), shapes)).toBeLessThan(0.01);
  });
});
