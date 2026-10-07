import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Part, TransformDelta, Vec2 } from '@app/schema';
import type { ProjectStoreWithHistory } from '@app/core';
import { patchPart } from '@app/core';
import { registry } from '../../../shell/registry';
import { register as registerExpressions } from '../expressions';
import { register, selectTool, SELECT_TOOL_ID } from './index';
import { NEEDS_KEY_MESSAGE, PREVIEW_OFF_BASE_MESSAGE } from './liveEdit';
import { ROTATE_HANDLE_DISTANCE } from './selectTool';
import { KeyedStubEditor, RecordingContext, openSample, pointer, redrawn, renderShell, stubSize } from './testUtils';

let restoreSize: () => void = () => {};
beforeEach(() => {
  registry.reset();
  register();
  restoreSize = stubSize(800, 600);
});
afterEach(() => restoreSize());

async function open(overrides?: Parameters<typeof renderShell>[0]) {
  const shell = renderShell(overrides);
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

// fixtures の点（キャンバス座標）
const TORSO = { x: 500, y: 1300 }; // 胴体だけがある所
const FACE = { x: 400, y: 650 }; // 顔（後ろに後ろ髪）
const IRIS_L = { x: 595, y: 480 }; // 瞳 L（白目 L・顔の手前）
const EMPTY = { x: 50, y: 50 };
const TORSO_PIVOT = { x: 500, y: 1170 };

describe('選択', () => {
  it('選択・変形ツールが既定のツールになる', async () => {
    await open();
    expect(screen.getByRole('button', { name: '選択・変形' }).getAttribute('aria-pressed')).toBe('true');
    expect(registry.get().tools[0]!.id).toBe(SELECT_TOOL_ID);
  });

  it('クリックで手前のパーツを選び、Shift で追加・外し、何も無い所で解除する', async () => {
    const { ptr, selected } = await open();
    ptr.click(TORSO);
    expect(selected()).toEqual(['part-torso']);
    ptr.click(FACE, { shiftKey: true });
    expect(selected()).toEqual(['part-torso', 'part-face']);
    ptr.click(FACE, { shiftKey: true });
    expect(selected()).toEqual(['part-torso']);
    ptr.click(IRIS_L);
    expect(selected()).toEqual(['part-irisL']);
    ptr.click(EMPTY, { shiftKey: true });
    expect(selected()).toEqual(['part-irisL']);
    ptr.click(EMPTY);
    expect(selected()).toEqual([]);
  });

  it('複数を選んでいるときに、そのうちの1つをクリックするとそれだけになる', async () => {
    const { ptr, selected } = await open();
    ptr.click(TORSO);
    ptr.click(FACE, { shiftKey: true });
    ptr.click(TORSO);
    expect(selected()).toEqual(['part-torso']);
  });

  it('locked のパーツは選ばず、後ろのパーツを選ぶ', async () => {
    const { ptr, selected, store } = await open();
    act(() => store.dispatch(patchPart('ロック', 'part-face', { locked: true })));
    ptr.click(FACE);
    expect(selected()).toEqual(['part-backHair']);
    act(() => store.dispatch(patchPart('ロック', 'part-torso', { locked: true })));
    ptr.click(TORSO);
    expect(selected()).toEqual([]);
  });

  it('選択中は枠・回転ハンドル・拡縮ハンドル・ピボットをオーバーレイに描く', async () => {
    const { ptr, canvas } = await open();
    ptr.click(TORSO);
    const ctx = new RecordingContext();
    selectTool.tool.drawOverlay!(ctx.asContext(), canvas.getState().view);
    // 枠は胴体の素材の矩形（200,840）〜（800,1500）
    const [first] = ctx.named('moveTo');
    near({ x: first![0]!, y: first![1]! }, ptr.toScreen({ x: 200, y: 840 }));
    expect(ctx.named('fillRect')).toHaveLength(8); // 四隅と辺
    const pivot = ptr.toScreen(TORSO_PIVOT);
    expect(ctx.named('arc').some(([x, y]) => Math.abs(x! - pivot.x) < 1e-6 && Math.abs(y! - pivot.y) < 1e-6)).toBe(
      true,
    );

    // 何も選んでいなければ描かない
    ptr.click(EMPTY);
    const empty = new RecordingContext();
    selectTool.tool.drawOverlay!(empty.asContext(), canvas.getState().view);
    expect(empty.calls).toHaveLength(0);
  });
});

describe('変形のドラッグ', () => {
  it('幅の狭いキャンバスでは回転中心の説明を折り返し、描画ピクセル数で位置を決めない', async () => {
    const { ptr, services, canvas } = await open();
    ptr.click(TORSO);
    act(() => services.editor.set({ editorParamValues: { FaceAngleX: 12 } }));
    ptr.move(TORSO_PIVOT);
    const ctx = new RecordingContext();
    Object.assign(ctx, { canvas: { clientWidth: 240, clientHeight: 600, width: 800, height: 1200 } });
    selectTool.tool.drawOverlay!(ctx.asContext(), canvas.getState().view);
    const bubble = ctx.named('fillRect').at(-1)!;
    expect(bubble[0]! + bubble[2]!).toBeLessThanOrEqual(240);
    expect(ctx.texts.length).toBeGreaterThan(1);
    expect(ctx.texts.join('')).toBe('回転中心（プレビュー中は移せない。値をすべて戻す）');
  });
  it('回転中心に乗せたときだけ説明を描き、プレビュー中と複数選択では動かせない理由を出す', async () => {
    const { ptr, services, canvas } = await open();
    ptr.click(TORSO);
    const hint = () => {
      const ctx = new RecordingContext();
      selectTool.tool.drawOverlay!(ctx.asContext(), canvas.getState().view);
      return ctx.texts;
    };
    ptr.move(TORSO_PIVOT);
    expect(hint()).toEqual(['回転中心（ドラッグで移す）']);
    ptr.move(EMPTY);
    expect(hint()).toEqual([]);
    act(() => services.editor.set({ activeParameterIds: ['FaceAngleX'] }));
    ptr.move(TORSO_PIVOT);
    expect(hint()).toEqual(['回転中心（パラメータ編集中は移せない）']);
    act(() => services.editor.set({ activeParameterIds: [], editorParamValues: { FaceAngleX: 12 } }));
    expect(hint()).toEqual(['回転中心（プレビュー中は移せない。値をすべて戻す）']);
    act(() => services.editor.set({ editorParamValues: {}, selectedPartIds: ['part-torso', 'part-face'] }));
    expect(hint()).toEqual(['回転中心（1つのパーツを選ぶと移せる）']);
  });

  it('移動: ドラッグで動き、1回のドラッグが1回の Undo になる', async () => {
    const { ptr, part, store } = await open();
    ptr.drag(TORSO, { x: TORSO.x + 100, y: TORSO.y + 50 });
    near(part('part-torso').position, { x: 100, y: 50 });
    expect(part('part-face').position).toEqual({ x: 0, y: 0 });
    expect(store.undoLabel()).toBe('パーツの移動');
    act(() => store.undo());
    near(part('part-torso').position, { x: 0, y: 0 });
    expect(store.canUndo()).toBe(false);
  });

  it('選んでいないパーツもそのままドラッグで動かせる。小さな動きはクリックとみなす', async () => {
    const { ptr, part, store, selected } = await open();
    ptr.drag(FACE, { x: FACE.x - 30, y: FACE.y });
    expect(selected()).toEqual(['part-face']);
    near(part('part-face').position, { x: -30, y: 0 });
    act(() => store.undo());
    ptr.drag(TORSO, { x: TORSO.x + 1, y: TORSO.y });
    expect(part('part-torso').position).toEqual({ x: 0, y: 0 });
    expect(store.canUndo()).toBe(false);
  });

  it('複数を選んでいれば一緒に動く', async () => {
    const { ptr, part, store } = await open();
    ptr.click(TORSO);
    ptr.click(FACE, { shiftKey: true });
    ptr.drag(FACE, { x: FACE.x + 20, y: FACE.y + 10 });
    near(part('part-torso').position, { x: 20, y: 10 });
    near(part('part-face').position, { x: 20, y: 10 });
    act(() => store.undo());
    expect(store.canUndo()).toBe(false);
  });

  it('回転: 上の回転ハンドルをピボットのまわりに回す。Shift で 15 度ずつ', async () => {
    const { ptr, part, store, canvas } = await open();
    ptr.click(TORSO);
    const handle = { x: 500, y: 840 - ROTATE_HANDLE_DISTANCE / canvas.getState().view.scale };
    // 真上 → 右上 → 右（時計回りに 90 度）
    ptr.drag(handle, { x: TORSO_PIVOT.x + 400, y: TORSO_PIVOT.y }, {}, 4, [
      { x: TORSO_PIVOT.x + 300, y: TORSO_PIVOT.y - 300 },
    ]);
    expect(part('part-torso').rotation).toBeCloseTo(90);
    expect(part('part-torso').position).toEqual({ x: 0, y: 0 });
    act(() => store.undo());
    expect(part('part-torso').rotation).toBe(0);
    expect(store.canUndo()).toBe(false);

    await redrawn(canvas, (m) => expect(m.byPartId['part-torso']!.positions[0]).toBeCloseTo(200));
    // 50 度くらい回すと Shift で 45 度
    const rad = (50 * Math.PI) / 180;
    const r = 400;
    ptr.drag(
      handle,
      { x: TORSO_PIVOT.x + r * Math.sin(rad), y: TORSO_PIVOT.y - r * Math.cos(rad) },
      { shiftKey: true },
    );
    expect(part('part-torso').rotation).toBeCloseTo(45);
  });

  it('拡縮: 四隅と辺のハンドルでピボットを中心に拡縮し、Shift で縦横比を固定する', async () => {
    const { ptr, part, store, canvas } = await open();
    ptr.click(TORSO);
    const se = { x: 800, y: 1500 };
    const reset = async () => {
      act(() => store.undo());
      expect(store.canUndo()).toBe(false);
      await redrawn(canvas, (m) => expect(m.byPartId['part-torso']!.positions[4]).toBeCloseTo(800));
    };

    // ピボット (500,1170) から見て (300,330) の角を (450,495) へ
    ptr.drag(se, { x: 950, y: 1665 });
    near(part('part-torso').scale, { x: 1.5, y: 1.5 });
    await reset();

    ptr.drag(se, { x: 950, y: 1500 });
    near(part('part-torso').scale, { x: 1.5, y: 1 });
    await reset();

    // Shift: つかんだ方向への射影 (450·300 + 330·330) / (300² + 330²)
    ptr.drag(se, { x: 950, y: 1500 }, { shiftKey: true });
    const f = (450 * 300 + 330 * 330) / (300 * 300 + 330 * 330);
    near(part('part-torso').scale, { x: f, y: f });
    await reset();

    // 右の辺は横だけ
    ptr.drag({ x: 800, y: 1170 }, { x: 900, y: 1170 });
    near(part('part-torso').scale, { x: 400 / 300, y: 1 });
    expect(part('part-torso').position).toEqual({ x: 0, y: 0 });
  });

  it('ピボット: ◎のドラッグで pivot が動き、回したパーツでも見た目は動かない', async () => {
    const { ptr, part, store, canvas } = await open();
    ptr.click(TORSO);
    ptr.drag(TORSO_PIVOT, { x: 530, y: 1200 });
    near(part('part-torso').pivot, { x: 530, y: 1200 });
    expect(part('part-torso').position).toEqual({ x: 0, y: 0 });
    expect(store.undoLabel()).toBe('ピボットの移動');
    act(() => store.undo());

    act(() => store.dispatch(patchPart('回転', 'part-torso', { rotation: 30, scale: { x: 1.2, y: 0.8 } })));
    await redrawn(canvas, (m) => expect(m.byPartId['part-torso']!.positions[0]).not.toBeCloseTo(200));
    const before = Array.from(canvas.lastDeformed()!.byPartId['part-torso']!.positions);
    ptr.drag(TORSO_PIVOT, { x: 450, y: 1100 });
    expect(part('part-torso').pivot).not.toEqual({ x: 500, y: 1170 });
    await redrawn(canvas, (m) => {
      const after = Array.from(m.byPartId['part-torso']!.positions);
      after.forEach((v, i) => expect(v).toBeCloseTo(before[i]!, 2));
    });
    // 見えているピボットはドラッグした先にある
    const t = part('part-torso');
    near({ x: t.position.x + t.pivot.x, y: t.position.y + t.pivot.y }, { x: 450, y: 1100 });
  });

  it('編集中のパラメータがあるときはピボットを動かせない（押すと移動になる）', async () => {
    const { ptr, part, services } = await open();
    ptr.click(TORSO);
    act(() => services.editor.set({ activeParameterIds: ['FaceAngleX'] }));
    ptr.drag(TORSO_PIVOT, { x: 530, y: 1200 });
    expect(part('part-torso').pivot).toEqual({ x: 500, y: 1170 });
    near(part('part-torso').position, { x: 30, y: 30 });
  });

  it('画面上で小さいパーツは、中を押したらピボットや拡縮ではなく移動にする', async () => {
    const { ptr, part, selected } = await open();
    // ハイライト L（18×18。倍率 0.36 で約 6.5 ピクセル）。ピボットは中心 (605,458)
    const inside = { x: 605, y: 462 };
    ptr.click(inside);
    expect(selected()).toEqual(['part-highlightL']);
    ptr.drag(inside, { x: 625, y: 462 });
    near(part('part-highlightL').position, { x: 20, y: 0 });
    expect(part('part-highlightL').pivot).toEqual({ x: 605, y: 458 });
  });

  it('全体表示の瞳（画面で約 22×25 ピクセル）も、角の近くを押して移動できる（拡縮にならない）', async () => {
    const { ptr, part, selected } = await open();
    ptr.click(IRIS_L);
    expect(selected()).toEqual(['part-irisL']);
    // 瞳 L の素材はおよそ (565,438)〜(625,506)。左下の角の近く（画面で角から約 3 ピクセル）
    const nearCorner = { x: 570, y: 500 };
    ptr.drag(nearCorner, { x: 590, y: 500 });
    near(part('part-irisL').position, { x: 20, y: 0 });
    expect(part('part-irisL').scale).toEqual({ x: 1, y: 1 });
  });

  it('選んでいる状態から別のパーツをドラッグすると、選ぶだけで動かさない。次のドラッグで動く（I-050）', async () => {
    const { ptr, part, store, selected } = await open();
    ptr.click(TORSO);
    ptr.drag(FACE, { x: FACE.x - 30, y: FACE.y });
    expect(selected()).toEqual(['part-face']);
    expect(part('part-face').position).toEqual({ x: 0, y: 0 });
    expect(part('part-torso').position).toEqual({ x: 0, y: 0 });
    expect(store.canUndo()).toBe(false);
    ptr.drag(FACE, { x: FACE.x - 30, y: FACE.y });
    near(part('part-face').position, { x: -30, y: 0 });

    // Shift で足したときも、足すだけで動かさない
    act(() => store.undo());
    ptr.drag(TORSO, { x: TORSO.x + 20, y: TORSO.y }, { shiftKey: true });
    expect(selected()).toEqual(['part-face', 'part-torso']);
    expect(part('part-torso').position).toEqual({ x: 0, y: 0 });
    expect(part('part-face').position).toEqual({ x: 0, y: 0 });
  });

  it('拡縮のハンドルは、描いた四角の少し外からでもつかめる（I-049）', async () => {
    const { ptr, part, selected, canvas } = await open();
    ptr.click(TORSO);
    // 右下の角から画面で 9 ピクセル右（前の 7 ピクセルでは外れて、後ろのパーツを押していた）
    const off = 9 / canvas.getState().view.scale;
    ptr.drag({ x: 800 + off, y: 1500 }, { x: 950 + off, y: 1665 });
    expect(selected()).toEqual(['part-torso']);
    expect(part('part-torso').scale.x).toBeGreaterThan(1.3);
    expect(part('part-torso').position).toEqual({ x: 0, y: 0 });
  });

  it('つかめるハンドルにマウスが乗ると、そのハンドルを大きく描く（I-049）', async () => {
    const { ptr, canvas } = await open();
    ptr.click(TORSO);
    const draw = () => {
      const ctx = new RecordingContext();
      selectTool.tool.drawOverlay!(ctx.asContext(), canvas.getState().view);
      return ctx.named('fillRect').filter(([, , w]) => w! > 8);
    };
    ptr.move({ x: TORSO.x, y: TORSO.y });
    expect(draw()).toHaveLength(0);

    const off = 5 / canvas.getState().view.scale;
    ptr.move({ x: 800 + off, y: 1500 + off });
    const big = draw();
    expect(big).toHaveLength(1);
    const se = ptr.toScreen({ x: 800, y: 1500 });
    near({ x: big[0]![0]! + big[0]![2]! / 2, y: big[0]![1]! + big[0]![3]! / 2 }, se);

    // ドラッグの間は、つかんだハンドルを大きく描いたまま
    ptr.down({ x: 800 + off, y: 1500 + off });
    ptr.move({ x: 900, y: 1600 });
    expect(draw()).toHaveLength(1);
    ptr.up({ x: 900, y: 1600 });
  });

  it('Escape でドラッグをやめると元に戻る', async () => {
    const { ptr, part, store } = await open();
    ptr.down(TORSO);
    ptr.move({ x: TORSO.x + 50, y: TORSO.y });
    near(part('part-torso').position, { x: 50, y: 0 });
    fireEvent.keyDown(screen.getByTestId('canvas-stage'), { key: 'Escape' });
    ptr.up({ x: TORSO.x + 50, y: TORSO.y });
    expect(part('part-torso').position).toEqual({ x: 0, y: 0 });
    expect(store.canUndo()).toBe(false);
  });
});

describe('値だけがデフォルト値でないとき（I-029）', () => {
  // 表情を作っている途中と同じ状態: 編集中のパラメータは無く、プレビューの値だけがデフォルト値でない
  const offBase = { activeParameterIds: [] as string[], editorParamValues: { FaceAngleX: 30 } };
  const notices = () => screen.queryAllByText(PREVIEW_OFF_BASE_MESSAGE);

  it('基準状態を動かさずに知らせる。クリックで選ぶことはできる', async () => {
    const { ptr, part, store, services, selected } = await open();
    act(() => services.editor.set(offBase));
    ptr.drag(TORSO, { x: TORSO.x + 100, y: TORSO.y + 50 });
    expect(part('part-torso').position).toEqual({ x: 0, y: 0 });
    expect(store.canUndo()).toBe(false);
    expect(selected()).toEqual(['part-torso']);
    expect(notices()).toHaveLength(1); // 1回のドラッグで1回だけ
    // 動かさないクリックでは知らせない
    ptr.click(FACE);
    expect(selected()).toEqual(['part-face']);
    ptr.click(EMPTY);
    expect(selected()).toEqual([]);
    expect(notices()).toHaveLength(1);
    expect(services.editor.get().editorParamValues).toEqual({ FaceAngleX: 30 });
  });

  it('回転・拡縮・ピボットのハンドルでも動かさない（ピボットは動かせない表示にする）', async () => {
    const { ptr, part, store, services, canvas } = await open();
    ptr.click(TORSO);
    act(() => services.editor.set(offBase));
    const handle = { x: 500, y: 840 - ROTATE_HANDLE_DISTANCE / canvas.getState().view.scale };
    ptr.drag(handle, { x: TORSO_PIVOT.x + 400, y: TORSO_PIVOT.y });
    ptr.drag({ x: 800, y: 1500 }, { x: 950, y: 1665 });
    ptr.drag(TORSO_PIVOT, { x: 530, y: 1200 });
    expect(part('part-torso')).toMatchObject({
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      pivot: TORSO_PIVOT,
    });
    expect(store.canUndo()).toBe(false);
    expect(notices()).toHaveLength(3);

    // ピボットは薄く描く（動かせないとき）
    const ctx = new RecordingContext();
    const alphas: number[] = [];
    const arc = ctx.arc.bind(ctx);
    ctx.arc = (...a: number[]) => {
      alphas.push(ctx.globalAlpha);
      arc(...a);
    };
    selectTool.tool.drawOverlay!(ctx.asContext(), canvas.getState().view);
    expect(alphas.at(-1)).toBeLessThan(1);
  });

  it('値をデフォルト値に戻すと、また基準状態を動かせる', async () => {
    const { ptr, part, services } = await open();
    act(() => services.editor.set(offBase));
    ptr.drag(TORSO, { x: TORSO.x + 30, y: TORSO.y });
    expect(part('part-torso').position).toEqual({ x: 0, y: 0 });
    act(() => services.editor.set({ editorParamValues: { FaceAngleX: 0 } }));
    ptr.drag(TORSO, { x: TORSO.x + 30, y: TORSO.y });
    near(part('part-torso').position, { x: 30, y: 0 });
  });

  it('編集中のパラメータがデフォルト値でなくても、ほかのパラメータのプレビューがあれば動かさない（I-028）', async () => {
    const { ptr, part, store, services } = await open();
    act(() =>
      services.editor.set({ activeParameterIds: ['FaceAngleX'], editorParamValues: { FaceAngleX: 30, MouthOpen: 1 } }),
    );
    ptr.drag(TORSO, { x: TORSO.x + 30, y: TORSO.y });
    expect(part('part-torso').position).toEqual({ x: 0, y: 0 });
    expect(store.get().model.bindings).toHaveLength(0);
    expect(notices()).toHaveLength(1);
    // プレビューを戻すと、編集に戻る（この KeyEditor は仮実装なので基準状態が動く）
    act(() => services.editor.set({ editorParamValues: { FaceAngleX: 30 } }));
    ptr.drag(TORSO, { x: TORSO.x + 30, y: TORSO.y });
    near(part('part-torso').position, { x: 30, y: 0 });
  });

  it('編集中のパラメータがデフォルト値で、ほかの値だけがデフォルト値でないときも動かさない', async () => {
    const { ptr, part, services } = await open();
    act(() =>
      services.editor.set({ activeParameterIds: ['FaceAngleX'], editorParamValues: { FaceAngleX: 0, MouthOpen: 1 } }),
    );
    ptr.drag(TORSO, { x: TORSO.x + 30, y: TORSO.y });
    expect(part('part-torso').position).toEqual({ x: 0, y: 0 });
    expect(notices()).toHaveLength(1);
  });

  it('表情を作っている途中: 表情の値はそのままで動かさず、登録して基準状態に戻ると動かせる', async () => {
    registerExpressions();
    const { ptr, part, store, services, selected } = await open();
    const panel = () => within(document.querySelector<HTMLElement>('[data-panel-id="expressions"]')!);
    fireEvent.click(panel().getByRole('button', { name: '新しい表情' }));
    fireEvent.change(panel().getByRole('slider', { name: '顔 左右' }), { target: { value: '12' } });
    const values = services.editor.get().editorParamValues;
    expect(values.FaceAngleX).toBeCloseTo(12, 6);

    ptr.drag(TORSO, { x: TORSO.x + 40, y: TORSO.y });
    expect(selected()).toEqual(['part-torso']);
    expect(part('part-torso').position).toEqual({ x: 0, y: 0 });
    expect(notices()).toHaveLength(1);
    expect(services.editor.get().editorParamValues).toEqual(values);

    fireEvent.click(panel().getByRole('button', { name: '登録' }));
    expect(store.get().expressions).toHaveLength(1);
    expect(store.get().expressions[0]!.entries.map((e) => e.parameterId)).toEqual(['FaceAngleX']);
    ptr.drag(TORSO, { x: TORSO.x + 40, y: TORSO.y });
    near(part('part-torso').position, { x: 40, y: 0 });
  });
});

describe('needsKey', () => {
  const keyed = () => {
    const keyEditor = new KeyedStubEditor();
    return { keyEditor, overrides: () => ({ keyEditor }) };
  };
  const keyDelta = (store: ProjectStoreWithHistory, partId: string) =>
    store.get().model.bindings.find((b) => b.target.id === partId)?.keys[0]?.delta as TransformDelta | undefined;

  it('確認して承認されたら、キーを足してからもう一度編集する（1回の Undo）', async () => {
    const { keyEditor, overrides } = keyed();
    const { ptr, part, store, services } = await open(overrides);
    act(() => services.editor.set({ activeParameterIds: ['FaceAngleX'], editorParamValues: { FaceAngleX: 30 } }));
    ptr.down(TORSO);
    ptr.move({ x: TORSO.x + 20, y: TORSO.y });
    expect(await screen.findByText(NEEDS_KEY_MESSAGE)).toBeTruthy();
    // 確認の間の動きも覚えておき、承認されたら最後の位置で編集する
    ptr.move({ x: TORSO.x + 60, y: TORSO.y + 40 });
    ptr.up({ x: TORSO.x + 60, y: TORSO.y + 40 });
    expect(store.get().model.bindings).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(keyDelta(store, 'part-torso')).toBeDefined());
    await selectTool.settled();
    expect(keyEditor.calls.addKey).toEqual(['part-torso']);
    near(keyDelta(store, 'part-torso')!.position, { x: 60, y: 40 });
    expect(part('part-torso').position).toEqual({ x: 0, y: 0 }); // 基準状態は変えない
    act(() => store.undo());
    expect(store.get().model.bindings).toHaveLength(0);
    expect(store.canUndo()).toBe(false);

    // キーがあれば確認せずにキーを編集する
    act(() => store.redo());
    ptr.drag(TORSO, { x: TORSO.x + 10, y: TORSO.y });
    expect(screen.queryByText(NEEDS_KEY_MESSAGE)).toBeNull();
    near(keyDelta(store, 'part-torso')!.position, { x: 70, y: 40 });
  });

  it('断ったら何も変えない', async () => {
    const { overrides } = keyed();
    const { ptr, store, services } = await open(overrides);
    act(() => services.editor.set({ activeParameterIds: ['FaceAngleX'] }));
    ptr.drag(TORSO, { x: TORSO.x + 30, y: TORSO.y });
    fireEvent.click(await screen.findByRole('button', { name: 'キャンセル' }));
    await selectTool.settled();
    expect(store.get().model.bindings).toHaveLength(0);
    expect(store.canUndo()).toBe(false);
    // 次のクリックは受け付ける
    ptr.click(EMPTY);
    expect(services.editor.get().selectedPartIds).toEqual([]);
  });

  it('複数を選んでいれば、選んだパーツそれぞれにキーを足す', async () => {
    const { keyEditor, overrides } = keyed();
    const { ptr, store, services } = await open(overrides);
    ptr.click(TORSO);
    ptr.click(FACE, { shiftKey: true });
    act(() => services.editor.set({ activeParameterIds: ['FaceAngleX'] }));
    ptr.drag(FACE, { x: FACE.x + 15, y: FACE.y });
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }));
    await waitFor(() => expect(store.get().model.bindings).toHaveLength(2));
    expect(keyEditor.calls.addKey).toEqual(['part-torso', 'part-face']);
    near(keyDelta(store, 'part-face')!.position, { x: 15, y: 0 });
    near(keyDelta(store, 'part-torso')!.position, { x: 15, y: 0 });
  });
});
