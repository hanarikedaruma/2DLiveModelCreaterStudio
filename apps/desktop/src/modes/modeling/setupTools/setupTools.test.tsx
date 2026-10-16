import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mapMeshPoint, type Mesh, type Project, type Vec2 } from '@app/schema';
import { createAutoSetup, createBindingEvaluator, createDeformPipeline, type ProjectStoreWithHistory } from '@app/core';
import { registry } from '../../../shell/registry';
import { register as registerAssets } from '../assets';
import { register as registerCanvasEdit } from '../canvas';
import { RecordingContext, pointer, renderShell, sampleProject, stubSize } from '../canvas/testUtils';
import { SELECT_TOOL_ID } from '../canvas/selectTool';
import { CLOSED_LINE_TOOL_ID, SETUP_TOOLS_PANEL_ID, closedLineTool, register } from './index';
import { eyeDisplay, lineOnScreen, setClosedLine } from './closedLine';
import { REPLACE_BLINK_MESSAGE } from './ClosedLinePanel';
import { SHORT_LINE_MESSAGE } from './closedLineTool';

// sample-model の画像パーツに、素材の矩形の 3×3 の格子のメッシュを付けたもの
function sampleWithMeshes(): Project {
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
  registerAssets();
  register();
  closedLineTool.side.set('L');
  restoreSize = stubSize(800, 600);
});
afterEach(() => restoreSize());

// 両目の白目を選んで開く（「閉じた目の線」は目のパーツを選んでいる間だけ出るパーツのパレット）
async function open(project = sampleWithMeshes(), select = ['part-eyeWhiteL', 'part-eyeWhiteR']) {
  const setup = createAutoSetup();
  // jsdomのfake素材は画素を持たない。画素による形の検証はcoreと実ブラウザで行う。
  const shell = renderShell(() => ({
    autoSetup: { ...setup, blink: (p, side) => setup.blink(p, side) },
    evaluator: createBindingEvaluator(),
    pipeline: createDeformPipeline(),
  }));
  act(() => shell.services.store.load(project));
  await waitFor(() =>
    expect(shell.canvas.lastDeformed()?.items.length).toBe(
      project.model.parts.filter((p) => p.kind === 'image' && p.meshId).length,
    ),
  );
  await waitFor(() => expect(shell.canvas.getState().view.scale).toBeCloseTo(0.36));
  act(() => shell.services.editor.set({ selectedPartIds: select }));
  const store = shell.services.store as ProjectStoreWithHistory;
  const panelEl = () => document.querySelector<HTMLElement>(`[data-panel-id="${SETUP_TOOLS_PANEL_ID}"]`);
  const panel = () => within(panelEl()!);
  const hints = () => store.get().model.setupHints;
  const tool = () => shell.canvas.getState().activeToolId;
  return { ...shell, store, panelEl, panel, hints, tool, ptr: pointer(shell.canvas) };
}

const toolbarButtons = () => within(screen.getByRole('toolbar', { name: 'キャンバスのツール' })).getAllByRole('button');

// 目 L（白目 537〜653 × 430〜510）の下のほうを左から右へなぞる点
const STROKE_L: Vec2[] = [
  { x: 530, y: 486 },
  { x: 560, y: 492 },
  { x: 595, y: 496 },
  { x: 630, y: 492 },
  { x: 660, y: 486 },
];

describe('目のパーツのパレット', () => {
  it('目専用のツールはツールバーに無く、目のパーツを選んでいる間だけ色付きのパーツのパレットとして上に出る', async () => {
    const shell = await open(sampleWithMeshes(), []);
    const labels = toolbarButtons().map((b) => b.textContent);
    expect(labels).not.toContain('閉じた目の線をなぞる');
    expect(labels).not.toContain('閉じた線のなぞり');
    expect(shell.panelEl()).toBeNull();
    // 髪では出ない
    act(() => shell.services.editor.set({ selectedPartIds: ['part-frontHair'] }));
    expect(shell.panelEl()).toBeNull();
    // 上まぶた L を選ぶと、L の行だけが出る
    act(() => shell.services.editor.set({ selectedPartIds: ['part-upperLidL'] }));
    const el = shell.panelEl()!;
    expect(el.classList.contains('object')).toBe(true);
    expect(el.getAttribute('data-object')).toBe('part');
    expect(within(el).getByText('パーツ')).toBeTruthy();
    // 右の列のいちばん上（共通パレットより前）
    expect(el.parentElement!.firstElementChild).toBe(el);
    expect(shell.panel().getByText('目 L（画面の右）')).toBeTruthy();
    expect(shell.panel().queryByTestId('closed-line-state-R')).toBeNull();
    // 瞳 R に替えると R の行だけ
    act(() => shell.services.editor.set({ selectedPartIds: ['part-irisR'] }));
    expect(shell.panel().getByText('目 R（画面の左）')).toBeTruthy();
    expect(shell.panel().queryByTestId('closed-line-state-L')).toBeNull();
    // 目以外を選ぶと消える
    act(() => shell.services.editor.set({ selectedPartIds: ['part-torso'] }));
    expect(shell.panelEl()).toBeNull();
  });

  it('ⓘ で目的と流れを出し、もう一度押すと閉じる', async () => {
    const shell = await open(sampleWithMeshes(), ['part-eyeWhiteL']);
    const button = within(shell.panelEl()!).getByRole('button', { name: '「閉じた目の線」の説明' });
    expect(screen.queryByRole('note', { name: '「閉じた目の線」の説明' })).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const note = screen.getByRole('note', { name: '「閉じた目の線」の説明' });
    expect(note.textContent).toContain('閉じたときのまぶたの下の端');
    expect(note.textContent).toContain('この目のまばたきを作る');
    fireEvent.click(button);
    expect(screen.queryByRole('note', { name: '「閉じた目の線」の説明' })).toBeNull();
  });
});

describe('閉じた目の線のパネル', () => {
  it('選んだ両目の「線なし」を出し、[閉じた目の線をなぞる] でなぞるツールになる。画面の左右も書く', async () => {
    const shell = await open();
    expect(shell.panel().getByTestId('closed-line-state-L').textContent).toBe('線なし');
    expect(shell.panel().getByTestId('closed-line-state-R').textContent).toBe('線なし');
    expect(shell.panel().getByText('目 L（画面の右）')).toBeTruthy();
    expect((shell.panel().getByRole('button', { name: '目 L の線を消す' }) as HTMLButtonElement).disabled).toBe(true);
    expect(shell.panel().getByRole('button', { name: '目 R の線をなぞる' }).textContent).toBe('閉じた目の線をなぞる');
    fireEvent.click(shell.panel().getByRole('button', { name: '目 R の線をなぞる' }));
    expect(shell.tool()).toBe(CLOSED_LINE_TOOL_ID);
    // ツールバーのどのボタンも押されていない（パレットから使うツール）
    expect(toolbarButtons().some((b) => b.getAttribute('aria-pressed') === 'true')).toBe(false);
    expect(shell.panel().getByRole('button', { name: '目 R の線をなぞる' }).getAttribute('aria-pressed')).toBe('true');
    expect(shell.panel().getByText(/キャンバスで目 R（画面の左）の閉じたときのまぶたの下の端を/)).toBeTruthy();
  });

  it('なぞると、その目の線が画像上の位置で保存され（x の昇順）、1回で Undo できる。保存したら元のツールに戻る', async () => {
    const shell = await open();
    fireEvent.click(shell.panel().getByRole('button', { name: '目 L の線をなぞる' }));
    shell.ptr.drag(STROKE_L[0]!, STROKE_L[4]!, {}, 3, STROKE_L.slice(1, 4));
    const attached = shell.hints().closedLineL!;
    expect(attached.partId).toBe('part-eyeWhiteL');
    const line = lineOnScreen(shell.services, attached)!;
    expect(shell.hints().closedLineR).toBeNull();
    expect(line.length).toBeGreaterThan(5);
    expect(line[0]!.x).toBeCloseTo(530, 0);
    expect(line[line.length - 1]!.x).toBeCloseTo(660, 0);
    expect(line.every((p, i) => i === 0 || p.x > line[i - 1]!.x)).toBe(true);
    expect(Math.max(...line.map((p) => p.y))).toBeCloseTo(496, 0);
    expect(shell.store.undoLabel()).toBe('閉じた目の線');
    expect(shell.tool()).toBe(SELECT_TOOL_ID);
    expect(shell.panel().getByTestId('closed-line-state-L').textContent).toBe(`線あり（点 ${line.length}）`);
    expect(shell.panel().getByRole('button', { name: '目 L の線をなぞる' }).textContent).toBe('なぞり直す');

    act(() => shell.store.undo());
    expect(shell.hints().closedLineL).toBeNull();
    expect(shell.store.canUndo()).toBe(false);
  });

  it('右から左へなぞっても x の昇順で保存する。もう片方の目の線は変えない', async () => {
    const shell = await open();
    fireEvent.click(shell.panel().getByRole('button', { name: '目 L の線をなぞる' }));
    shell.ptr.drag(STROKE_L[0]!, STROKE_L[4]!);
    const left = shell.hints().closedLineL;
    fireEvent.click(shell.panel().getByRole('button', { name: '目 R の線をなぞる' }));
    shell.ptr.drag({ x: 470, y: 486 }, { x: 340, y: 486 }, {}, 6, [{ x: 405, y: 496 }]);
    const right = lineOnScreen(shell.services, shell.hints().closedLineR!)!;
    expect(right[0]!.x).toBeCloseTo(340, 0);
    expect(right[right.length - 1]!.x).toBeCloseTo(470, 0);
    expect(right.every((p, i) => i === 0 || p.x > right[i - 1]!.x)).toBe(true);
    expect(shell.hints().closedLineL).toBe(left);
  });

  it('[消す] でその目の線だけを消す（1回の Undo）', async () => {
    const shell = await open();
    fireEvent.click(shell.panel().getByRole('button', { name: '目 L の線をなぞる' }));
    shell.ptr.drag(STROKE_L[0]!, STROKE_L[4]!);
    const line = shell.hints().closedLineL;
    fireEvent.click(shell.panel().getByRole('button', { name: '目 L の線を消す' }));
    expect(shell.hints().closedLineL).toBeNull();
    expect(shell.store.undoLabel()).toBe('閉じた目の線を消す');
    expect(shell.panel().getByTestId('closed-line-state-L').textContent).toBe('線なし');
    act(() => shell.store.undo());
    expect(shell.hints().closedLineL).toEqual(line);
  });

  it('短い線は保存せずに知らせ、なぞるツールのまま。Esc はなぞりかけを取り消し、もう一度でやめる', async () => {
    const shell = await open();
    fireEvent.click(shell.panel().getByRole('button', { name: '目 L の線をなぞる' }));
    shell.ptr.click({ x: 600, y: 480 });
    expect(shell.hints().closedLineL).toBeNull();
    expect(await screen.findByText(SHORT_LINE_MESSAGE)).toBeTruthy();
    expect(shell.store.canUndo()).toBe(false);
    expect(shell.tool()).toBe(CLOSED_LINE_TOOL_ID);

    shell.ptr.down(STROKE_L[0]!);
    shell.ptr.move(STROKE_L[2]!);
    expect(closedLineTool.stroke()).toHaveLength(2);
    fireEvent.keyDown(screen.getByTestId('canvas-stage'), { key: 'Escape' });
    expect(closedLineTool.stroke()).toBeNull();
    shell.ptr.up(STROKE_L[4]!);
    expect(shell.hints().closedLineL).toBeNull();
    expect(shell.tool()).toBe(CLOSED_LINE_TOOL_ID);
    fireEvent.keyDown(screen.getByTestId('canvas-stage'), { key: 'Escape' });
    expect(shell.tool()).toBe(SELECT_TOOL_ID);
  });

  it('右クリックと［やめる］で、保存せずに元のツールに戻る。パーツの選択は変えない', async () => {
    const shell = await open();
    fireEvent.click(shell.panel().getByRole('button', { name: '目 L の線をなぞる' }));
    shell.ptr.rightClick({ x: 600, y: 480 });
    expect(shell.tool()).toBe(SELECT_TOOL_ID);
    expect(shell.services.editor.get().selectedPartIds).toEqual(['part-eyeWhiteL', 'part-eyeWhiteR']);
    expect(shell.hints().closedLineL).toBeNull();

    fireEvent.click(shell.panel().getByRole('button', { name: '目 R の線をなぞる' }));
    fireEvent.click(shell.panel().getByRole('button', { name: 'やめる' }));
    expect(shell.tool()).toBe(SELECT_TOOL_ID);
    expect(shell.hints().closedLineR).toBeNull();
    expect(shell.store.canUndo()).toBe(false);
  });

  it('なぞっている間は、目以外を選んでもパレットを出したままにし、保存して戻ると消える', async () => {
    const shell = await open(sampleWithMeshes(), ['part-eyeWhiteL']);
    fireEvent.click(shell.panel().getByRole('button', { name: '目 L の線をなぞる' }));
    act(() => shell.services.editor.set({ selectedPartIds: ['part-torso'] }));
    expect(shell.panel().getByTestId('closed-line-state-L')).toBeTruthy();
    shell.ptr.drag(STROKE_L[0]!, STROKE_L[4]!);
    expect(shell.hints().closedLineL).not.toBeNull();
    expect(shell.tool()).toBe(SELECT_TOOL_ID);
    expect(shell.panelEl()).toBeNull();
  });

  it('ツールは保存した両目の線と、なぞっている途中の線と、案内の帯を描く', async () => {
    const shell = await open();
    fireEvent.click(shell.panel().getByRole('button', { name: '目 L の線をなぞる' }));
    shell.ptr.drag(STROKE_L[0]!, STROKE_L[4]!, {}, 2);
    const saved = lineOnScreen(shell.services, shell.hints().closedLineL!)!;
    const view = shell.canvas.getState().view;
    const ctx = new RecordingContext();
    closedLineTool.drawSaved(ctx.asContext(), view);
    expect(ctx.named('moveTo')).toHaveLength(1);
    expect(ctx.named('lineTo')).toHaveLength(saved.length - 1);
    expect(ctx.named('arc')).toHaveLength(saved.length); // 両端の点
    const first = ctx.named('moveTo')[0]!;
    expect(first[0]).toBeCloseTo(saved[0]!.x * view.scale + view.offset.x, 3);
    expect(ctx.texts).toHaveLength(0);

    fireEvent.click(shell.panel().getByRole('button', { name: '目 R の線をなぞる' }));
    shell.ptr.down({ x: 340, y: 486 });
    shell.ptr.move({ x: 400, y: 490 });
    const drawing = new RecordingContext();
    closedLineTool.tool.drawOverlay!(drawing.asContext(), view);
    expect(drawing.named('moveTo').length).toBeGreaterThan(2);
    shell.ptr.up({ x: 400, y: 490 });
  });
});

describe('自動セットアップとのつながり', () => {
  it('なぞった線で [自動セットアップ] を押すと、まばたきが線に沿うキー（頂点）になる', async () => {
    const shell = await open(sampleWithMeshes());
    fireEvent.click(shell.panel().getByRole('button', { name: '目 L の線をなぞる' }));
    shell.ptr.drag(STROKE_L[0]!, STROKE_L[4]!, {}, 3, STROKE_L.slice(1, 4));
    const assign = within(document.querySelector<HTMLElement>('[data-panel-id="assets.assign"]')!);
    fireEvent.click(assign.getByRole('button', { name: '自動セットアップ' }));
    const model = shell.store.get().model;
    const lid = model.parts.find((q) => q.standardType === 'upperLidL')!;
    const blink = model.bindings.find(
      (b) => b.channel === 'vertices' && b.target.id === lid.meshId && b.parameterIds[0] === 'EyeOpenL',
    );
    expect(blink?.keys.map((k) => k.coords[0])).toEqual([0, 0.25, 0.5, 0.75, 1]);
    // 線の無い R は MVP の閉じ方のまま
    const lidR = model.parts.find((q) => q.standardType === 'upperLidR')!;
    expect(model.bindings.some((b) => b.channel === 'vertices' && b.target.id === lidR.meshId)).toBe(false);
    expect(shell.store.undoLabel()).toBe('自動セットアップ');
  });

  it('パレットでは、その目のまばたきだけを1回のUndoで反映する', async () => {
    const viaAssign = await open(sampleWithMeshes());
    fireEvent.click(viaAssign.panel().getByRole('button', { name: '目 L の線をなぞる' }));
    viaAssign.ptr.drag(STROKE_L[0]!, STROKE_L[4]!, {}, 3, STROKE_L.slice(1, 4));
    fireEvent.click(viaAssign.panel().getByRole('button', { name: '目 L のまばたきを作る' }));
    expect(viaAssign.store.undoLabel()).toBe('この目のまばたきを作る');
    const model = viaAssign.store.get().model;
    const lid = model.parts.find((q) => q.standardType === 'upperLidL')!;
    expect(
      model.bindings.some(
        (b) => b.channel === 'vertices' && b.target.id === lid.meshId && b.parameterIds[0] === 'EyeOpenL',
      ),
    ).toBe(true);
  });
});

describe('片目の操作の安全性（I-090）', () => {
  it('任意の開き具合と回転の姿勢でなぞっても画像上の同じ位置に保存する', async () => {
    const p = sampleWithMeshes();
    const white = p.model.parts.find((p) => p.standardType === 'eyeWhiteL')!;
    white.rotation = 8;
    white.position = { x: 13, y: -7 };
    white.pivot = { x: 595, y: 470 };
    const shell = await open(p, [white.id]);
    act(() => shell.services.editor.set({ editorParamValues: { EyeOpenL: 0.6, EyeOpenR: 0.8 } }));
    const display = eyeDisplay(shell.services, white.id)!;
    const uvs = [0.05, 0.27, 0.5, 0.73, 0.95].map((x) => ({ x, y: 0.82 }));
    const points = uvs.map((uv) => mapMeshPoint(display.mesh, display.mesh.uvs, display.positions, uv)!);
    fireEvent.click(shell.panel().getByRole('button', { name: '目 L の線をなぞる' }));
    shell.ptr.drag(points[0]!, points.at(-1)!, {}, 3, points.slice(1, -1));
    const line = shell.hints().closedLineL!;
    expect(line.partId).toBe(white.id);
    line.points.forEach((p) => expect(p.y).toBeCloseTo(0.82, 5));
    expect(shell.services.editor.get().editorParamValues).toEqual({ EyeOpenL: 0.6, EyeOpenR: 0.8 });
  });

  it('提案した線の点だけをドラッグで変更しUndoでき、閉じ具合は作品の履歴を増やさない', async () => {
    const shell = await open();
    act(() =>
      shell.store.dispatch(
        setClosedLine('L', {
          partId: 'part-eyeWhiteL',
          points: [
            { x: 0.05, y: 0.82 },
            { x: 0.5, y: 0.82 },
            { x: 0.95, y: 0.82 },
          ],
        }),
      ),
    );
    const before = shell.store.get(),
      line = shell.hints().closedLineL!;
    fireEvent.change(shell.panel().getByRole('slider', { name: '目 L の閉じ具合' }), { target: { value: '0.45' } });
    expect(shell.services.editor.get().editorParamValues.EyeOpenL).toBeCloseTo(0.55);
    expect(shell.store.get()).toBe(before);
    fireEvent.click(shell.panel().getByRole('button', { name: '目 L の線の点を動かす' }));
    const point = lineOnScreen(shell.services, line)![1]!;
    shell.ptr.drag(point, { x: point.x, y: point.y + 4 });
    const after = shell.hints().closedLineL!;
    expect(after.points[0]).toEqual(line.points[0]);
    expect(after.points[2]).toEqual(line.points[2]);
    expect(after.points[1]!.y).toBeGreaterThan(line.points[1]!.y);
    act(() => shell.store.undo());
    expect(shell.store.get()).toBe(before);
  });

  it('手修正の置き換えは取消でき、確認中に作品が変わったら再確認する', async () => {
    const shell = await open(sampleWithMeshes(), ['part-eyeWhiteL']);
    act(() =>
      shell.store.dispatch(
        setClosedLine('L', {
          partId: 'part-eyeWhiteL',
          points: [
            { x: 0.05, y: 0.82 },
            { x: 0.5, y: 0.82 },
            { x: 0.95, y: 0.82 },
          ],
        }),
      ),
    );
    const first = shell.services.autoSetup.blink(shell.store.get(), 'L');
    act(() => shell.store.dispatch(first.command!));
    const p = shell.store.get();
    const manual = {
      ...p,
      model: {
        ...p.model,
        bindings: p.model.bindings.map((b) =>
          b.channel === 'vertices' && b.parameterIds[0] === 'EyeOpenL'
            ? { ...b, keys: b.keys.map((k) => ({ ...k, source: 'manual' as const, locked: true })) }
            : b,
        ),
      },
    };
    act(() => shell.store.load(manual));
    fireEvent.click(shell.panel().getByRole('button', { name: '目 L のまばたきを作る' }));
    const dialog = await screen.findByRole('dialog', { name: REPLACE_BLINK_MESSAGE });
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    await waitFor(() =>
      expect(shell.panel().getByRole('button', { name: '目 L のまばたきを作る' }).hasAttribute('disabled')).toBe(false),
    );
    expect(shell.store.get()).toBe(manual);
    fireEvent.click(shell.panel().getByRole('button', { name: '目 L のまばたきを作る' }));
    const second = await screen.findByRole('dialog', { name: REPLACE_BLINK_MESSAGE });
    const changed = { ...manual, name: '確認中に更新' };
    act(() => shell.store.load(changed));
    fireEvent.click(within(second).getByRole('button', { name: 'OK' }));
    const again = await screen.findByRole('dialog', { name: REPLACE_BLINK_MESSAGE });
    expect(shell.store.get()).toBe(changed);
    fireEvent.click(within(again).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(shell.store.get()).not.toBe(changed));
    expect(shell.store.get().name).toBe('確認中に更新');
    act(() => shell.store.undo());
    expect(shell.store.get()).toBe(changed);
  });

  it('メッシュが無い理由をパレットに出す', async () => {
    const p = sampleWithMeshes();
    p.model.parts.find((p) => p.standardType === 'eyeWhiteL')!.meshId = null;
    const shell = await open(p, ['part-upperLidL']);
    expect(shell.panel().getByText(/メッシュを先に作って/)).toBeTruthy();
    expect(shell.panel().getByRole('button', { name: '目 L の線をなぞる' }).hasAttribute('disabled')).toBe(true);
  });
});
