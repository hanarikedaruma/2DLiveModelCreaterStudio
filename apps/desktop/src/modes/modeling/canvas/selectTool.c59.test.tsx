// カード59（回転中心と表示の印・I-051）のテスト。テストの担当は CL（実装の担当は CO）
// キャンバスの◎（回転中心）: 乗せると説明が出る・移しても画像は動かない・移した中心のまわりで回る・
// プレビュー中は動かず理由が出る（I-046）・数値欄は「回転中心 X/Y」
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Binding, Mesh, Part, Project, TransformDelta, Vec2 } from '@app/schema';
import type { DeformedModel } from '@app/contracts';
import { createBindingEvaluator, createDeformPipeline, patchPart, type ProjectStoreWithHistory } from '@app/core';
import type { CanvasController } from '../../../shell/canvas/controller';
import { registry } from '../../../shell/registry';
import { register as registerParameters } from '../parameters';
import { makeMesh } from '../structure/testing';
import { register, selectTool } from './index';
import { PREVIEW_OFF_BASE_MESSAGE } from './liveEdit';
import { ROTATE_HANDLE_DISTANCE } from './selectTool';
import { PREVIEW_OFF_BASE_NOTE } from './TransformPanel';
import { RecordingContext, openSample, pointer, renderShell, sampleProject, stubSize } from './testUtils';

const originalGetContext = HTMLCanvasElement.prototype.getContext;
let restoreSize: () => void = () => {};
beforeEach(() => {
  registry.reset();
  register();
  restoreSize = stubSize(800, 600);
});
afterEach(() => {
  restoreSize();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

// fixtures の点（キャンバス座標）
const TORSO = { x: 500, y: 1300 }; // 胴体だけがある所
const TORSO_PIVOT = { x: 500, y: 1170 }; // 胴体の回転中心（素材の中央）
const TORSO_TOP = { x: 500, y: 840 }; // 胴体の上の辺の中央（首の付け根）
const HIGHLIGHT_L_PIVOT = { x: 605, y: 458 }; // ハイライト L（全体表示で約 6.5 ピクセルの小さいパーツ）の回転中心
const EMPTY = { x: 50, y: 50 };
// 胴体の素材の四隅 (200,840)・(800,840)・(800,1500)・(200,1500)
const TORSO_CORNERS = [200, 840, 800, 840, 800, 1500, 200, 1500];
// 首の付け根 (500,840) のまわりに時計回りに 90 度回したときの四隅
const TORSO_TURNED_AT_TOP = [500, 540, 500, 1140, -160, 1140, -160, 540];

const HINT_MOVABLE = '回転中心（ドラッグで移す）';
const HINT_PREVIEW = '回転中心（プレビュー中は移せない。値をすべて戻す）';

async function open(overrides?: Parameters<typeof renderShell>[0], project?: Project) {
  const shell = renderShell(overrides);
  await openSample(shell, project);
  const store = shell.services.store as ProjectStoreWithHistory;
  const part = (id: string): Part => store.get().model.parts.find((p) => p.id === id)!;
  const select = (ids: string[]) => act(() => shell.services.editor.set({ selectedPartIds: ids }));
  const panel = () => within(document.querySelector<HTMLElement>('[data-panel-id="transform"]')!);
  const field = (label: string) => panel().getByLabelText(label) as HTMLInputElement;
  return { ...shell, store, part, select, panel, field, ptr: pointer(shell.canvas) };
}

// 選択・変形ツールのオーバーレイを描いて記録する
function overlay(canvas: CanvasController) {
  const ctx = new RecordingContext();
  selectTool.tool.drawOverlay!(ctx.asContext(), canvas.getState().view);
  return ctx;
}
const hint = (canvas: CanvasController) => overlay(canvas).texts;

const positionsOf = (m: DeformedModel, id: string) => Array.from(m.byPartId[id]!.positions);

function expectPoints(actual: number[], expected: number[], digits = 2) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, digits));
}

const near = (a: Vec2, b: Vec2) => {
  expect(a.x).toBeCloseTo(b.x, 3);
  expect(a.y).toBeCloseTo(b.y, 3);
};

// [x0, y0, x1, y1, …] を中心 c のまわりに deg 度回す（y は下向き、正の角度が画面で時計回り）
function rotateAround(points: number[], c: Vec2, deg: number): number[] {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const dx = points[i]! - c.x;
    const dy = points[i + 1]! - c.y;
    out.push(c.x + dx * cos - dy * sin, c.y + dx * sin + dy * cos);
  }
  return out;
}

// check を満たす変形の結果（描き直されたもの）を待って返す
function deformedWhen(canvas: CanvasController, check: (m: DeformedModel) => void): Promise<DeformedModel> {
  return waitFor(() => {
    const m = canvas.lastDeformed();
    expect(m).not.toBeNull();
    check(m!);
    return m!;
  });
}
// 前と違う（モデルか値が変わって描き直された）変形の結果を待つ
const nextDeformed = (canvas: CanvasController, previous: DeformedModel) =>
  deformedWhen(canvas, (m) => expect(m).not.toBe(previous));

// 本物の評価と変形で確かめるため、画像パーツすべてに素材の矩形の4点のメッシュを付け、bindings を入れる
function withQuadMeshes(project: Project, bindings: Binding[]): Project {
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  const meshes: Mesh[] = [];
  const parts = project.model.parts.map((p) => {
    const a = p.assetId ? assets.get(p.assetId) : undefined;
    if (p.kind !== 'image' || !a) return p;
    const { x, y } = a.offset;
    const mesh = makeMesh(`mesh-${p.id}`, {
      vertices: [
        { x, y },
        { x: x + a.width, y },
        { x: x + a.width, y: y + a.height },
        { x, y: y + a.height },
      ],
      uvs: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      triangles: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    });
    meshes.push(mesh);
    return { ...p, meshId: mesh.id };
  });
  return { ...project, model: { ...project.model, parts, meshes, bindings } };
}

const IDENTITY: TransformDelta = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: 1 };
// 顔 左右（FaceAngleX）が 30 のとき、胴体を時計回りに 90 度回すキー（0 は回さない）
const TORSO_TURN_KEY: Binding = {
  id: 'c59-torso-turn',
  target: { type: 'part', id: 'part-torso' },
  channel: 'transform',
  parameterIds: ['FaceAngleX'],
  keyValues: [[0, 30]],
  keys: [
    { coords: [0], delta: IDENTITY, source: 'manual', locked: false },
    { coords: [30], delta: { ...IDENTITY, rotation: 90 }, source: 'manual', locked: false },
  ],
  generation: 'linear',
  divisions: null,
};

describe('カード59: ◎に乗せたときの説明', () => {
  it('◎に乗せたときだけ「回転中心（ドラッグで移す）」を◎のすぐ横に出し、ほかの所では何も書かない', async () => {
    const { ptr, canvas, services } = await open();
    ptr.click(TORSO);
    expect(services.editor.get().selectedPartIds).toEqual(['part-torso']);
    const scale = canvas.getState().view.scale;

    // ◎でない所（何も無い所・パーツの上・回転のハンドル）では説明を書かない（常に出す説明は無い）
    ptr.move(EMPTY);
    expect(hint(canvas)).toEqual([]);
    ptr.move(TORSO);
    expect(hint(canvas)).toEqual([]);
    ptr.move({ x: 500, y: 840 - ROTATE_HANDLE_DISTANCE / scale });
    expect(hint(canvas)).toEqual([]);

    ptr.move(TORSO_PIVOT);
    const ctx = overlay(canvas);
    expect(ctx.texts).toEqual([HINT_MOVABLE]);
    // 説明の下地は◎の右下のすぐ横（画面で 40 ピクセル以内）
    const at = ptr.toScreen(TORSO_PIVOT);
    const [bx, by] = ctx.named('fillRect').at(-1)!;
    expect(bx! - at.x).toBeGreaterThan(0);
    expect(bx! - at.x).toBeLessThan(40);
    expect(by! - at.y).toBeGreaterThan(0);
    expect(by! - at.y).toBeLessThan(40);

    // ◎から画面で 5 ピクセルなら出し、10 ピクセル離れると出さない
    ptr.move({ x: TORSO_PIVOT.x + 5 / scale, y: TORSO_PIVOT.y });
    expect(hint(canvas)).toEqual([HINT_MOVABLE]);
    ptr.move({ x: TORSO_PIVOT.x + 10 / scale, y: TORSO_PIVOT.y });
    expect(hint(canvas)).toEqual([]);

    // 何も選んでいなければ◎も説明も描かない
    ptr.click(EMPTY);
    ptr.move(TORSO_PIVOT);
    const none = overlay(canvas);
    expect(none.texts).toEqual([]);
    expect(none.calls).toHaveLength(0);
  });

  it('実際のキャンバスでも、◎に乗せると描き直されて説明が出て、離れると消える。説明に「表示」の言葉は無い', async () => {
    // オーバーレイの canvas の 2D コンテキストを、描き直しごとに書いた文字を記録するものにする
    const frames: string[][] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === 'measureText') return (s: string) => ({ width: s.length * 12 });
          if (prop === 'clearRect') return () => frames.push([]);
          if (prop === 'fillText') return (s: string) => frames.at(-1)?.push(s);
          if (prop === 'canvas') return undefined;
          return () => {};
        },
        set: () => true,
      },
    );
    HTMLCanvasElement.prototype.getContext = function getContext() {
      return ctx;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const { ptr } = await open();
    ptr.click(TORSO);
    ptr.move(TORSO);
    await waitFor(() => expect(frames.at(-1)).toEqual([]));
    ptr.move(TORSO_PIVOT);
    await waitFor(() => expect(frames.at(-1)).toEqual([HINT_MOVABLE]));
    expect(frames.at(-1)!.join('')).not.toMatch(/表示/);
    ptr.move(EMPTY);
    await waitFor(() => expect(frames.at(-1)).toEqual([]));
  });
});

describe('カード59: ◎を移しても画像は動かず、移した中心のまわりで回る', () => {
  it('◎を首の付け根へ移すと中心だけが移り、頂点は動かない。回転のハンドルで回すと、そこを中心に胴体だけが回る', async () => {
    const { ptr, canvas, part, store, field } = await open();
    ptr.click(TORSO);
    const base = canvas.lastDeformed()!;
    expect(positionsOf(base, 'part-torso')).toEqual(TORSO_CORNERS);
    const faceBefore = positionsOf(base, 'part-face');
    expect(field('回転中心 X').value).toBe('500');
    expect(field('回転中心 Y').value).toBe('1170');

    ptr.drag(TORSO_PIVOT, TORSO_TOP);
    near(part('part-torso').pivot, TORSO_TOP);
    expect(part('part-torso')).toMatchObject({ position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } });
    expect(store.undoLabel()).toBe('ピボットの移動');
    const moved = await nextDeformed(canvas, base);
    expectPoints(positionsOf(moved, 'part-torso'), TORSO_CORNERS);
    expectPoints(positionsOf(moved, 'part-face'), faceBefore);
    // 数値欄と◎の位置も移した先になる
    expect(field('回転中心 X').value).toBe('500');
    expect(field('回転中心 Y').value).toBe('840');
    const at = ptr.toScreen(TORSO_TOP);
    expect(
      overlay(canvas)
        .named('arc')
        .some(([x, y]) => Math.abs(x! - at.x) < 1e-6 && Math.abs(y! - at.y) < 1e-6),
    ).toBe(true);

    // 回転のハンドル（上の辺の中央の上）を、真上 → 右上 → 右へ（時計回りに 90 度）
    const handle = { x: 500, y: 840 - ROTATE_HANDLE_DISTANCE / canvas.getState().view.scale };
    ptr.drag(handle, { x: TORSO_TOP.x + 400, y: TORSO_TOP.y }, {}, 4, [{ x: TORSO_TOP.x + 300, y: TORSO_TOP.y - 300 }]);
    expect(part('part-torso').rotation).toBeCloseTo(90, 6);
    near(part('part-torso').pivot, TORSO_TOP);
    const turned = await nextDeformed(canvas, moved);
    // 首の付け根は動かず、上の辺が縦になる（前の中心 (500,1170) のまわりなら (830,870) などになる）
    expectPoints(positionsOf(turned, 'part-torso'), TORSO_TURNED_AT_TOP);
    expectPoints(positionsOf(turned, 'part-face'), faceBefore);
  });

  it('回転・拡縮したパーツでも、◎を移して画像は動かず、そのあと Rotation を足すと移した所を中心に回る', async () => {
    const { ptr, canvas, part, store, select, field } = await open();
    act(() => store.dispatch(patchPart('回転', 'part-torso', { rotation: 30, scale: { x: 1.2, y: 0.8 } })));
    const posed = await deformedWhen(canvas, (m) => expect(positionsOf(m, 'part-torso')[0]).not.toBeCloseTo(200));
    const before = positionsOf(posed, 'part-torso');
    select(['part-torso']);

    const drop = { x: 420, y: 1020 };
    ptr.drag(TORSO_PIVOT, drop);
    const t = part('part-torso');
    // 見えている中心（ルートのパーツなので position + pivot）が落とした所になる
    near({ x: t.position.x + t.pivot.x, y: t.position.y + t.pivot.y }, drop);
    expect(t.pivot).not.toEqual(TORSO_PIVOT);
    expect(t.rotation).toBe(30);
    expect(t.scale).toEqual({ x: 1.2, y: 0.8 });
    const moved = await nextDeformed(canvas, posed);
    expectPoints(positionsOf(moved, 'part-torso'), before);

    // Rotation の欄で 30 → 120（時計回りに 90 度足す）
    fireEvent.change(field('Rotation'), { target: { value: '120' } });
    fireEvent.keyDown(field('Rotation'), { key: 'Enter' });
    expect(part('part-torso').rotation).toBe(120);
    const turned = await nextDeformed(canvas, moved);
    expectPoints(positionsOf(turned, 'part-torso'), rotateAround(before, drop, 90));
  });

  it('◎を移したあと、回転のキーの値にすると（本物の評価と変形）、移した中心のまわりで胴体だけが回る', async () => {
    const project = withQuadMeshes(sampleProject(), [TORSO_TURN_KEY]);
    const { ptr, canvas, part, select, services } = await open(
      () => ({ evaluator: createBindingEvaluator(), pipeline: createDeformPipeline() }),
      project,
    );
    const base = canvas.lastDeformed()!;
    expectPoints(positionsOf(base, 'part-torso'), TORSO_CORNERS);
    const faceBase = positionsOf(base, 'part-face');
    select(['part-torso']);

    ptr.drag(TORSO_PIVOT, TORSO_TOP);
    near(part('part-torso').pivot, TORSO_TOP);
    expect(part('part-torso').position).toEqual({ x: 0, y: 0 });
    const moved = await nextDeformed(canvas, base);
    expectPoints(positionsOf(moved, 'part-torso'), TORSO_CORNERS);

    act(() => services.editor.set({ editorParamValues: { FaceAngleX: 30 } }));
    const keyed = await nextDeformed(canvas, moved);
    expectPoints(positionsOf(keyed, 'part-torso'), TORSO_TURNED_AT_TOP);
    expectPoints(positionsOf(keyed, 'part-face'), faceBase);

    // 間の値（15 で 45 度）も同じ中心のまわり
    act(() => services.editor.set({ editorParamValues: { FaceAngleX: 15 } }));
    const half = await nextDeformed(canvas, keyed);
    expectPoints(positionsOf(half, 'part-torso'), rotateAround(TORSO_CORNERS, TORSO_TOP, 45));
  });
});

describe('カード59: 動かせないときの◎（I-046 の制限を保つ）', () => {
  it('プレビュー中は◎に乗せると理由を出し、ドラッグしても中心も画像も動かさずに知らせる。［値をすべて戻す］で移せる', async () => {
    registerParameters();
    const { ptr, canvas, part, store, select, services, panel, field } = await open();
    select(['part-torso']);
    const pivotAlpha = () => {
      const ctx = new RecordingContext();
      const alphas: number[] = [];
      const arc = ctx.arc.bind(ctx);
      ctx.arc = (...a: number[]) => {
        alphas.push(ctx.globalAlpha);
        arc(...a);
      };
      selectTool.tool.drawOverlay!(ctx.asContext(), canvas.getState().view);
      return alphas.at(-1); // 主のパーツの◎は最後に描く
    };
    ptr.move(TORSO_PIVOT);
    expect(hint(canvas)).toEqual([HINT_MOVABLE]);
    expect(pivotAlpha()).toBe(1);

    // 編集中のパラメータは無く、値だけがデフォルト値でない（表情を作っている途中と同じ）
    act(() => services.editor.set({ activeParameterIds: [], editorParamValues: { FaceAngleX: 12 } }));
    const modelBefore = store.get().model;
    expect(hint(canvas)).toEqual([HINT_PREVIEW]);
    expect(pivotAlpha()).toBeLessThan(1); // 動かせない◎は薄く描く

    ptr.drag(TORSO_PIVOT, { x: 560, y: 1000 });
    expect(part('part-torso')).toMatchObject({ pivot: TORSO_PIVOT, position: { x: 0, y: 0 } });
    expect(store.canUndo()).toBe(false);
    expect(screen.queryAllByText(PREVIEW_OFF_BASE_MESSAGE)).toHaveLength(1);
    expect(store.get().model).toBe(modelBefore); // パーツも頂点も何も変えていない
    // プレビューの値は消さない
    expect(services.editor.get().editorParamValues).toEqual({ FaceAngleX: 12 });

    // 数値欄も読み取り専用で、理由を出す
    expect(panel().getByText(PREVIEW_OFF_BASE_NOTE)).toBeTruthy();
    expect(field('回転中心 X').readOnly).toBe(true);
    fireEvent.change(field('回転中心 X'), { target: { value: '600' } });
    fireEvent.keyDown(field('回転中心 X'), { key: 'Enter' });
    expect(part('part-torso').pivot).toEqual(TORSO_PIVOT);

    // 理由の言うとおり［値をすべて戻す］で戻すと、説明が変わり、◎を移せる
    fireEvent.click(screen.getByRole('button', { name: '値をすべて戻す' }));
    ptr.move(TORSO_PIVOT);
    expect(hint(canvas)).toEqual([HINT_MOVABLE]);
    ptr.drag(TORSO_PIVOT, { x: 560, y: 1000 });
    near(part('part-torso').pivot, { x: 560, y: 1000 });
    expect(part('part-torso').position).toEqual({ x: 0, y: 0 });
  });

  it('ほかの動かせない状態でも、◎に乗せると理由を出し、中心は動かさない', async () => {
    const { ptr, canvas, part, store, select, services } = await open();
    // ◎の所を押したドラッグは、中心ではなくパーツの移動になる（ここでは中心が動かないことだけを見て、Undo で戻す）
    const undoAll = () => {
      while (store.canUndo()) act(() => store.undo());
      expect(part('part-torso').position).toEqual({ x: 0, y: 0 });
    };

    // パラメータのキーを編集中
    select(['part-torso']);
    act(() => services.editor.set({ activeParameterIds: ['FaceAngleX'] }));
    ptr.move(TORSO_PIVOT);
    expect(hint(canvas)).toEqual(['回転中心（パラメータ編集中は移せない）']);
    ptr.drag(TORSO_PIVOT, { x: 560, y: 1000 });
    expect(part('part-torso').pivot).toEqual(TORSO_PIVOT);
    act(() => services.editor.set({ activeParameterIds: [] }));
    undoAll();

    // 2つ以上を選んでいる
    select(['part-torso', 'part-face']);
    ptr.move(TORSO_PIVOT);
    expect(hint(canvas)).toEqual(['回転中心（1つのパーツを選ぶと移せる）']);
    ptr.drag(TORSO_PIVOT, { x: 560, y: 1000 });
    expect(part('part-torso').pivot).toEqual(TORSO_PIVOT);
    expect(part('part-face').pivot).toEqual({ x: 500, y: 450 });
    undoAll();

    // 画面で小さすぎて、つかむと移動になるパーツ
    select(['part-highlightL']);
    ptr.move(HIGHLIGHT_L_PIVOT);
    expect(hint(canvas)).toEqual(['回転中心（拡大するとつかめる）']);
    ptr.drag(HIGHLIGHT_L_PIVOT, { x: 625, y: 458 });
    expect(part('part-highlightL').pivot).toEqual(HIGHLIGHT_L_PIVOT);
  });
});

describe('カード59: 数値欄の名前', () => {
  it('数値欄は「回転中心 X」「回転中心 Y」で、Pivot の表記は残っていない。キャンバスの説明と同じ言葉', async () => {
    const { ptr, canvas, part, select, panel, field } = await open();
    select(['part-torso']);
    expect(field('回転中心 X').value).toBe('500');
    expect(field('回転中心 Y').value).toBe('1170');
    expect(panel().queryByLabelText(/Pivot/i)).toBeNull();
    expect(panel().queryByText(/Pivot/i)).toBeNull();
    const labels = [...document.querySelectorAll('[data-panel-id="transform"] .transform-label')].map(
      (el) => el.textContent,
    );
    expect(labels.filter((l) => l?.startsWith('回転中心'))).toEqual(['回転中心 X', '回転中心 Y']);

    // 欄に入れた値が◎の位置になる（回していないパーツなので画像は動かない）
    fireEvent.change(field('回転中心 X'), { target: { value: '480' } });
    fireEvent.keyDown(field('回転中心 X'), { key: 'Enter' });
    expect(part('part-torso').pivot).toEqual({ x: 480, y: 1170 });
    ptr.move({ x: 480, y: 1170 });
    expect(hint(canvas)).toEqual([HINT_MOVABLE]);
    expect(hint(canvas)[0]!.startsWith('回転中心')).toBe(true);
  });
});

describe('I-062: 数値欄で回転中心を変えても、回転・拡縮したパーツの画像は動かない（◎のドラッグと同じ）', () => {
  it('回転 30 度・拡縮 1.2×0.8 の胴体で X・Y を入れても頂点は動かず、そのあと回すと見えている◎のまわりで回る。1回の Undo で戻る', async () => {
    const { ptr, canvas, part, store, select, field } = await open();
    act(() => store.dispatch(patchPart('回転', 'part-torso', { rotation: 30, scale: { x: 1.2, y: 0.8 } })));
    const posed = await deformedWhen(canvas, (m) => expect(positionsOf(m, 'part-torso')[0]).not.toBeCloseTo(200));
    const before = positionsOf(posed, 'part-torso');
    select(['part-torso']);
    const beforeX = store.get();

    fireEvent.change(field('回転中心 X'), { target: { value: '420' } });
    fireEvent.keyDown(field('回転中心 X'), { key: 'Enter' });
    expect(part('part-torso').pivot).toEqual({ x: 420, y: 1170 });
    // 位置で打ち消す（直す前は位置が 0 のままで、画像が約 10px ずれていた）
    expect(part('part-torso').position).not.toEqual({ x: 0, y: 0 });
    const movedX = await nextDeformed(canvas, posed);
    expectPoints(positionsOf(movedX, 'part-torso'), before);

    fireEvent.change(field('回転中心 Y'), { target: { value: '1020' } });
    fireEvent.keyDown(field('回転中心 Y'), { key: 'Enter' });
    const t = part('part-torso');
    expect(t.pivot).toEqual({ x: 420, y: 1020 });
    expect(t.rotation).toBe(30);
    expect(t.scale).toEqual({ x: 1.2, y: 0.8 });
    const movedY = await nextDeformed(canvas, movedX);
    expectPoints(positionsOf(movedY, 'part-torso'), before);

    // 見えている中心（ルートのパーツなので position + pivot）のまわりで回る。◎もそこに描く
    const center = { x: t.position.x + t.pivot.x, y: t.position.y + t.pivot.y };
    ptr.move(center);
    expect(hint(canvas)).toEqual([HINT_MOVABLE]);
    fireEvent.change(field('Rotation'), { target: { value: '120' } });
    fireEvent.keyDown(field('Rotation'), { key: 'Enter' });
    const turned = await nextDeformed(canvas, movedY);
    expectPoints(positionsOf(turned, 'part-torso'), rotateAround(before, center, 90));

    // 回転・Y・X の3回の Undo で、中心と位置がそろって元に戻る（数値の変更は1回ずつ）
    act(() => store.undo());
    act(() => store.undo());
    expect(part('part-torso').pivot).toEqual({ x: 420, y: 1170 });
    act(() => store.undo());
    expect(store.get()).toBe(beforeX);
  });
});
