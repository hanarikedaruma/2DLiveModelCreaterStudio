import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject, type Binding, type Part, type Project, type Vec2, type Warp } from '@app/schema';
import type { ProjectStoreWithHistory } from '@app/core';
import { createBindingEvaluator, createDeformPipeline, patchPart } from '@app/core';
import { createKeyEditor } from '../../../services/keyEditor';
import { registry } from '../../../shell/registry';
import { register as registerCanvasEdit } from '../canvas';
import { NEEDS_KEY_MESSAGE, PREVIEW_OFF_BASE_MESSAGE } from '../canvas/liveEdit';
import { RecordingContext, pointer, redrawn, renderShell, stubSize } from '../canvas/testUtils';
import { register as registerStructure } from '../structure';
import { WARP_TOOL_ID, register, warpEditor } from './index';
import { rectMesh, testAsset } from './testProject';
import { removeWarpMessage } from './warpOps';
import { GRID_SEGMENTS } from './warpTool';

// g（グループ）の子に a: 200..400 × 300..500、b: 500..800 × 500..700。外に o。
// 子の外接矩形 200..800 × 300..700 に 5% の余白で、格子の範囲は 170..830 × 280..720。
// 4×4 なら制御点は x = 170 + 165i、y = 280 + 110j で、真ん中（12番）は (500,500) = b の左上の頂点
const BOUNDS = { x: 170, y: 280, width: 660, height: 440 };
const CENTER = 12;

function partOf(id: string, patch: Partial<Part> = {}): Part {
  return {
    id,
    name: id,
    kind: 'image',
    standardType: null,
    assetId: `asset-${id}`,
    meshId: `mesh-${id}`,
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

function testProject(group: Partial<Part> = {}, patch: Partial<Project['model']> = {}): Project {
  const p = createEmptyProject('ワープのテスト');
  return {
    ...p,
    assets: [
      testAsset('asset-a', { x: 200, y: 300 }, 200, 200),
      testAsset('asset-b', { x: 500, y: 500 }, 300, 200),
      testAsset('asset-o', { x: 0, y: 0 }, 100, 100),
    ],
    model: {
      ...p.model,
      parts: [
        partOf('g', { kind: 'group', assetId: null, meshId: null, ...group }),
        partOf('a', { parentId: 'g' }),
        partOf('b', { parentId: 'g' }),
        partOf('o'),
        partOf('empty', { kind: 'group', assetId: null, meshId: null }),
      ],
      meshes: [
        rectMesh('mesh-a', 200, 300, 200, 200),
        rectMesh('mesh-b', 500, 500, 300, 200),
        rectMesh('mesh-o', 0, 0, 100, 100),
      ],
      drawOrder: ['o', 'a', 'b'],
      ...patch,
    },
  };
}

function regularWarp(columns = 4, rows = 4): Warp {
  const points: Vec2[] = [];
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= columns; i++)
      points.push({ x: BOUNDS.x + (BOUNDS.width * i) / columns, y: BOUNDS.y + (BOUNDS.height * j) / rows });
  return { id: 'w', partId: 'g', columns, rows, bounds: BOUNDS, points };
}

const DETAIL = { modeling: 'detail', animation: 'easy', studio: 'easy' } as const;

let restoreSize: () => void = () => {};
beforeEach(() => {
  registry.reset();
  registerCanvasEdit();
  registerStructure();
  register();
  restoreSize = stubSize(800, 600);
});
afterEach(() => restoreSize());

async function open(project: Project, options: { detail?: boolean; select?: string[] } = {}) {
  const shell = renderShell(() => ({
    pipeline: createDeformPipeline(),
    evaluator: createBindingEvaluator(),
    keyEditor: createKeyEditor(),
  }));
  act(() => shell.services.store.load(project));
  // 素材のキャンバス 1000×1000 を 800×600 に収める（倍率 0.54）
  await waitFor(() => expect(shell.canvas.lastDeformed()?.items.length).toBe(3));
  await waitFor(() => expect(shell.canvas.getState().view.scale).toBeCloseTo(0.54));
  act(() =>
    shell.services.editor.set({
      selectedPartIds: options.select ?? ['g'],
      ...(options.detail === false ? {} : { uiLevel: DETAIL }),
    }),
  );
  const store = shell.services.store as ProjectStoreWithHistory;
  const sectionEl = () => document.querySelector<HTMLElement>('[data-section-id="modeling.warp"]');
  const section = () => within(sectionEl()!);
  const warp = () => store.get().model.warps[0];
  const positions = (partId: string) => {
    const item = shell.canvas.lastDeformed()!.byPartId[partId]!;
    const out: Vec2[] = [];
    for (let k = 0; k < item.positions.length; k += 2) out.push({ x: item.positions[k]!, y: item.positions[k + 1]! });
    return out;
  };
  return { ...shell, store, sectionEl, section, warp, positions, ptr: pointer(shell.canvas) };
}

const near = (a: Vec2, b: Vec2, digits = 3) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

const activeTool = () =>
  within(screen.getByRole('toolbar', { name: 'キャンバスのツール' }))
    .getAllByRole('button')
    .find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent;

describe('ワープのセクション', () => {
  it('画像から親グループを選べ、親がなければ1回のUndoで戻せるグループを作れる', async () => {
    const shell = await open(testProject(), { select: ['a'] });
    fireEvent.click(shell.section().getByRole('button', { name: 'グループ「g」を選ぶ' }));
    expect(shell.services.editor.get().selectedPartIds).toEqual(['g']);
    act(() => shell.services.editor.set({ selectedPartIds: ['o'] }));
    fireEvent.click(shell.section().getByRole('button', { name: 'グループを作る' }));
    const group = shell.store.get().model.parts.find((p) => p.id === shell.services.editor.get().selectedPartIds[0])!;
    expect(group.kind).toBe('group');
    expect(shell.store.get().model.parts.find((p) => p.id === 'o')!.parentId).toBe(group.id);
    act(() => shell.store.undo());
    expect(shell.store.get().model.parts.find((p) => p.id === 'o')!.parentId).toBeNull();
    expect(shell.store.get().model.parts.some((p) => p.id === group.id)).toBe(false);
  });

  it('プレビュー中は格子を追加できず、値を戻す理由を示す', async () => {
    const shell = await open(testProject());
    act(() => shell.services.editor.set({ editorParamValues: { FaceAngleX: 12 } }));
    expect((shell.section().getByRole('button', { name: 'ワープを追加' }) as HTMLButtonElement).disabled).toBe(true);
    expect(shell.section().getByText(/プレビュー中は編集できない/)).toBeTruthy();
    expect(shell.store.get().model.warps).toEqual([]);
  });

  it('ツールだけを選んでもキャンバスに次の手順が出る', async () => {
    const shell = await open(testProject(), { select: [] });
    fireEvent.click(screen.getByRole('button', { name: 'ワープ編集' }));
    const ctx = new RecordingContext();
    warpEditor.tool.drawOverlay!(ctx.asContext(), shell.canvas.getState().view);
    expect(ctx.texts.join('')).toContain('グループを選ぶ');
  });

  it('詳細モードの「パーツの設定」にだけ出る', async () => {
    const shell = await open(testProject(), { detail: false });
    expect(shell.sectionEl()).toBeNull();
    act(() => shell.services.editor.set({ uiLevel: DETAIL }));
    const settings = within(document.querySelector<HTMLElement>('[data-panel-id="partSettings"]')!);
    expect(settings.getByRole('button', { name: 'ワープを追加' })).toBeTruthy();
  });

  it('グループでなければ案内、画像パーツの無いグループでは追加できない', async () => {
    const shell = await open(testProject(), { select: ['a'] });
    expect(shell.section().getByText(/画像を含むグループを選ぶ/)).toBeTruthy();
    expect(shell.section().queryByRole('button', { name: 'ワープを追加' })).toBeNull();
    act(() => shell.services.editor.set({ selectedPartIds: ['empty'] }));
    expect((shell.section().getByRole('button', { name: 'ワープを追加' }) as HTMLButtonElement).disabled).toBe(true);
    expect(shell.section().getByText(/子に画像パーツが無い/)).toBeTruthy();
  });
});

describe('ワープの追加・削除と Undo', () => {
  it('子が格子外に出たら案内し、範囲と全キーを1回のUndo/Redoで戻す', async () => {
    const warp = regularWarp();
    const key: Binding = {
      id: 'key',
      target: { type: 'warp', id: 'w' },
      channel: 'warpPoints',
      parameterIds: ['FaceAngleX'],
      keyValues: [[0, 30]],
      generation: 'linear',
      divisions: null,
      keys: [0, 30].map((v) => ({
        coords: [v],
        delta: warp.points.map((_, i) => ({ x: v * Math.sin(i), y: v * Math.cos(i) })),
        source: 'manual',
        locked: true,
      })),
    };
    const shell = await open(testProject({}, { warps: [warp], bindings: [key] }));
    act(() => shell.store.dispatch(patchPart('子を移す', 'b', { position: { x: 400, y: 100 } })));
    await redrawn(shell.canvas, (m) => expect(m.byPartId.b!.positions[0]).toBeGreaterThan(800));
    const before = shell.store.get();
    const vertices = shell.positions('b');
    expect(shell.section().getByText(/格子の範囲の外/)).toBeTruthy();
    fireEvent.click(shell.section().getByRole('button', { name: '範囲を合わせ直す' }));
    expect(shell.warp()!.columns).toBeGreaterThan(4);
    expect(shell.store.get().model.bindings[0]!.keys.map((k) => [k.coords, k.source, k.locked])).toEqual(
      key.keys.map((k) => [k.coords, k.source, k.locked]),
    );
    await redrawn(shell.canvas, (m) => expect(m.byPartId.b!.positions[0]).toBeCloseTo(vertices[0]!.x, 2));
    shell.positions('b').forEach((p, i) => near(p, vertices[i]!, 2));
    expect(shell.section().queryByRole('button', { name: '範囲を合わせ直す' })).toBeNull();
    act(() => shell.store.undo());
    expect(shell.store.get()).toBe(before);
    act(() => shell.store.redo());
    expect(shell.warp()!.columns).toBeGreaterThan(4);
  });
  it('追加: 子の外接矩形 + 5% の余白に 4×4 の規則的な格子。見た目は変わらず、ワープ編集ツールになる。Undo で消える', async () => {
    const shell = await open(testProject());
    const before = { a: shell.positions('a'), b: shell.positions('b') };
    fireEvent.click(shell.section().getByRole('button', { name: 'ワープを追加' }));

    const warp = shell.warp()!;
    expect(warp).toMatchObject({ partId: 'g', columns: 4, rows: 4 });
    expect(warp.bounds.x).toBeCloseTo(BOUNDS.x);
    expect(warp.bounds.y).toBeCloseTo(BOUNDS.y);
    expect(warp.bounds.width).toBeCloseTo(BOUNDS.width);
    expect(warp.bounds.height).toBeCloseTo(BOUNDS.height);
    warp.points.forEach((p, k) => near(p, regularWarp().points[k]!));
    expect(shell.store.undoLabel()).toBe('ワープの追加');
    expect(activeTool()).toBe('ワープ編集');
    expect(shell.section().getByTestId('warp-info').textContent).toBe('格子 4×4（制御点 25）');

    // 規則的な格子なので子の頂点は変わらない
    await redrawn(shell.canvas, (m) => expect(m.byPartId.b).toBeDefined());
    shell.positions('a').forEach((p, i) => near(p, before.a[i]!));
    shell.positions('b').forEach((p, i) => near(p, before.b[i]!));

    act(() => shell.store.undo());
    expect(shell.store.get().model.warps).toEqual([]);
    expect(shell.section().getByRole('button', { name: 'ワープを追加' })).toBeTruthy();
  });

  it('分割は横・縦それぞれ 2〜8 から選べる', async () => {
    const shell = await open(testProject());
    const columns = shell.section().getByRole('combobox', { name: '横の分割' }) as HTMLSelectElement;
    expect([...columns.options].map((o) => o.value)).toEqual(['2', '3', '4', '5', '6', '7', '8']);
    expect(columns.value).toBe('4');
    fireEvent.change(columns, { target: { value: '6' } });
    fireEvent.change(shell.section().getByRole('combobox', { name: '縦の分割' }), { target: { value: '3' } });
    fireEvent.click(shell.section().getByRole('button', { name: 'ワープを追加' }));
    expect(shell.warp()).toMatchObject({ columns: 6, rows: 3 });
    expect(shell.warp()!.points).toHaveLength(28);
  });

  it('削除: キーがあれば確認してから、ワープと関係するバインディングを消す。Undo で両方戻る', async () => {
    const key: Binding = {
      id: 'k',
      target: { type: 'warp', id: 'w' },
      channel: 'warpPoints',
      parameterIds: ['FaceAngleX'],
      keyValues: [[0, 30]],
      keys: [
        { coords: [0], delta: regularWarp().points.map(() => ({ x: 0, y: 0 })), source: 'auto', locked: false },
        { coords: [30], delta: regularWarp().points.map(() => ({ x: 5, y: 0 })), source: 'manual', locked: false },
      ],
      generation: 'linear',
      divisions: null,
    };
    const other: Binding = { ...key, id: 'other', target: { type: 'warp', id: 'w-other' } };
    const otherWarp: Warp = { ...regularWarp(), id: 'w-other', partId: 'empty' };
    const shell = await open(testProject({}, { warps: [regularWarp(), otherWarp], bindings: [key, other] }));
    fireEvent.click(shell.section().getByRole('button', { name: 'ワープを削除' }));
    expect(await screen.findByText(removeWarpMessage(2))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(shell.store.get().model.warps.map((w) => w.id)).toEqual(['w-other']));
    expect(shell.store.get().model.bindings.map((b) => b.id)).toEqual(['other']);
    expect(shell.store.undoLabel()).toBe('ワープの削除');
    act(() => shell.store.undo());
    expect(shell.store.get().model.warps.map((w) => w.id)).toEqual(['w', 'w-other']);
    expect(shell.store.get().model.bindings.map((b) => b.id)).toEqual(['k', 'other']);
  });

  it('削除: キーが無ければ確認しない', async () => {
    const shell = await open(testProject({}, { warps: [regularWarp()] }));
    fireEvent.click(shell.section().getByRole('button', { name: 'ワープを削除' }));
    await waitFor(() => expect(shell.store.get().model.warps).toEqual([]));
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
  });
});

describe('ワープ編集ツール', () => {
  async function openWithWarp(group: Partial<Part> = {}, patch: Partial<Project['model']> = {}) {
    const shell = await open(testProject(group, { warps: [regularWarp()], ...patch }));
    fireEvent.click(shell.section().getByRole('button', { name: 'ワープ編集ツールにする' }));
    expect(activeTool()).toBe('ワープ編集');
    return shell;
  }

  it('格子と制御点を変形後の位置に描く', async () => {
    const shell = await openWithWarp({ position: { x: 100, y: 50 } });
    const ctx = new RecordingContext();
    warpEditor.tool.drawOverlay!(ctx.asContext(), shell.canvas.getState().view);
    const expected = regularWarp().points.map((p) => shell.ptr.toScreen({ x: p.x + 100, y: p.y + 50 }));
    const circles = ctx.named('arc');
    expect(circles).toHaveLength(25);
    circles.forEach(([x, y], i) => near({ x: x!, y: y! }, expected[i]!));
    // 横 5 本・縦 5 本の折れ線。各辺を GRID_SEGMENTS 本に分ける
    expect(ctx.named('moveTo')).toHaveLength(10);
    expect(ctx.named('lineTo')).toHaveLength(10 * 4 * GRID_SEGMENTS);
    const [x0, y0] = ctx.named('moveTo')[0]!;
    near({ x: x0!, y: y0! }, expected[0]!);
  });

  it('基準状態: 制御点のドラッグで基準の制御点が動き、子も曲がる。1回のドラッグが1回の Undo', async () => {
    const shell = await openWithWarp();
    shell.ptr.drag({ x: 500, y: 500 }, { x: 540, y: 520 });
    near(shell.warp()!.points[CENTER]!, { x: 540, y: 520 });
    expect(shell.section().getByText('選んだ制御点: 1 個')).toBeTruthy();
    expect(shell.store.undoLabel()).toBe('制御点の移動');
    // b の左上の頂点は真ん中の制御点の上にあるので同じだけ動き、格子の外の o は動かない
    await redrawn(shell.canvas, (m) => expect(m.byPartId.b!.positions[0]).toBeCloseTo(540, 3));
    near(shell.positions('b')[0]!, { x: 540, y: 520 });
    near(shell.positions('o')[2]!, { x: 100, y: 100 });

    act(() => shell.store.undo());
    near(shell.warp()!.points[CENTER]!, { x: 500, y: 500 });
    expect(shell.store.canUndo()).toBe(false);
  });

  it('プレビューが基準状態と違う間は、制御点を動かさずに知らせる。値を戻すと動かせる（I-046）', async () => {
    const shell = await openWithWarp();
    // 表情を作っている途中と同じ状態: 編集中のパラメータは無く、プレビューの値だけがデフォルト値でない
    act(() => shell.services.editor.set({ activeParameterIds: [], editorParamValues: { FaceAngleX: 30 } }));
    shell.ptr.drag({ x: 500, y: 500 }, { x: 540, y: 520 });
    near(shell.warp()!.points[CENTER]!, { x: 500, y: 500 });
    expect(shell.store.canUndo()).toBe(false);
    expect(screen.queryAllByText(PREVIEW_OFF_BASE_MESSAGE)).toHaveLength(1);

    act(() => shell.services.editor.set({ editorParamValues: {} }));
    shell.ptr.drag({ x: 500, y: 500 }, { x: 540, y: 520 });
    near(shell.warp()!.points[CENTER]!, { x: 540, y: 520 });
  });

  it('グループが拡縮されていれば、見た目の移動量を制御点の空間に直す', async () => {
    // ピボット (500,500) を中心に横 2 倍。真ん中の制御点はピボットの上なので (500,500) に見える
    const shell = await openWithWarp({ scale: { x: 2, y: 1 } });
    shell.ptr.drag({ x: 500, y: 500 }, { x: 540, y: 520 });
    near(shell.warp()!.points[CENTER]!, { x: 520, y: 520 });
    await redrawn(shell.canvas, (m) => expect(m.byPartId.b!.positions[0]).toBeCloseTo(540, 3));
  });

  it('矩形選択した制御点をまとめて動かす', async () => {
    const shell = await openWithWarp();
    // 左上の 3×3（x ≤ 500、y ≤ 500）を囲む
    shell.ptr.drag({ x: 150, y: 260 }, { x: 520, y: 520 });
    const selected = [0, 1, 2, 5, 6, 7, 10, 11, 12];
    expect([...warpEditor.selection.get().indices].sort((p, q) => p - q)).toEqual(selected);
    shell.ptr.drag({ x: 335, y: 390 }, { x: 345, y: 380 });
    const regular = regularWarp().points;
    shell
      .warp()!
      .points.forEach((p, k) =>
        near(p, selected.includes(k) ? { x: regular[k]!.x + 10, y: regular[k]!.y - 10 } : regular[k]!),
      );
    // Esc で選択を外す
    act(() => {
      warpEditor.tool.onKeyDown!(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(warpEditor.selection.get().indices).toEqual([]);
  });

  it('キー: 編集中のパラメータがあれば KeyEditor が制御点の差分のキーを作り、基準の制御点はそのまま', async () => {
    const shell = await openWithWarp();
    act(() => shell.services.editor.set({ activeParameterIds: ['FaceAngleX'], editorParamValues: { FaceAngleX: 30 } }));
    shell.ptr.drag({ x: 500, y: 500 }, { x: 540, y: 520 });
    expect(screen.queryByText(NEEDS_KEY_MESSAGE)).toBeNull();
    near(shell.warp()!.points[CENTER]!, { x: 500, y: 500 });
    const bindings = shell.store.get().model.bindings;
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({ target: { type: 'warp', id: 'w' }, channel: 'warpPoints' });
    const key30 = bindings[0]!.keys.find((k) => k.coords[0] === 30)!;
    near((key30.delta as Vec2[])[CENTER]!, { x: 40, y: 20 });
    await redrawn(shell.canvas, (m) => expect(m.byPartId.b!.positions[0]).toBeCloseTo(540, 3));

    // 描く位置もキーの差分を足した位置
    const ctx = new RecordingContext();
    warpEditor.tool.drawOverlay!(ctx.asContext(), shell.canvas.getState().view);
    const [cx, cy] = ctx.named('arc')[CENTER]!;
    near({ x: cx!, y: cy! }, shell.ptr.toScreen({ x: 540, y: 520 }));

    act(() => shell.store.undo());
    expect(shell.store.get().model.bindings).toEqual([]);
  });

  it("'needsKey' なら確認し、承認されたらキーを足してから編集する（まとめて1回の Undo）", async () => {
    const shell = await openWithWarp();
    act(() => shell.services.editor.set({ activeParameterIds: ['FaceAngleX'], editorParamValues: { FaceAngleX: 30 } }));
    shell.ptr.drag({ x: 500, y: 500 }, { x: 540, y: 520 });
    const keyed = shell.store.get();

    // 15 にはキーが無い。見えている位置は補間で (520,510)
    act(() => shell.services.editor.set({ editorParamValues: { FaceAngleX: 15 } }));
    await redrawn(shell.canvas, (m) => expect(m.byPartId.b!.positions[0]).toBeCloseTo(520, 3));
    shell.ptr.drag({ x: 520, y: 510 }, { x: 530, y: 510 });
    expect(await screen.findByText(NEEDS_KEY_MESSAGE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(shell.store.get().model.bindings[0]!.keys).toHaveLength(3));
    await warpEditor.settled();
    const key15 = shell.store.get().model.bindings[0]!.keys.find((k) => k.coords[0] === 15)!;
    near((key15.delta as Vec2[])[CENTER]!, { x: 30, y: 10 });
    expect(shell.store.get().model.bindings[0]!.keyValues).toEqual([[0, 15, 30]]);

    act(() => shell.store.undo());
    expect(shell.store.get()).toBe(keyed);
  });

  it("'needsKey' で断れば何も変えない", async () => {
    const shell = await openWithWarp();
    act(() => shell.services.editor.set({ activeParameterIds: ['FaceAngleX'], editorParamValues: { FaceAngleX: 30 } }));
    shell.ptr.drag({ x: 500, y: 500 }, { x: 540, y: 520 });
    const keyed = shell.store.get();
    act(() => shell.services.editor.set({ editorParamValues: { FaceAngleX: 15 } }));
    await redrawn(shell.canvas, (m) => expect(m.byPartId.b!.positions[0]).toBeCloseTo(520, 3));
    shell.ptr.drag({ x: 520, y: 510 }, { x: 530, y: 510 });
    fireEvent.click(await screen.findByRole('button', { name: 'キャンセル' }));
    await warpEditor.settled();
    expect(shell.store.get()).toBe(keyed);
  });

  it('ワープの無いグループや画像パーツを選んでいるときは何も描かず、何も動かさない', async () => {
    const shell = await openWithWarp();
    act(() => shell.services.editor.set({ selectedPartIds: ['a'] }));
    const ctx = new RecordingContext();
    warpEditor.tool.drawOverlay!(ctx.asContext(), shell.canvas.getState().view);
    expect(ctx.calls).toEqual([]);
    const before = shell.store.get();
    shell.ptr.drag({ x: 500, y: 500 }, { x: 540, y: 520 });
    expect(shell.store.get()).toBe(before);
    expect(WARP_TOOL_ID).toBe('modeling.warp');
  });
});
