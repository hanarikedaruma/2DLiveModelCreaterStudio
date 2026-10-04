import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Mesh, Project, Vec2 } from '@app/schema';
import { createAutoSetup, type ProjectStoreWithHistory } from '@app/core';
import { registry } from '../../../shell/registry';
import { register as registerAssets } from '../assets';
import { register as registerCanvasEdit } from '../canvas';
import { RecordingContext, openSample, pointer, renderShell, sampleProject, stubSize } from '../canvas/testUtils';
import { CLOSED_LINE_TOOL_ID, SETUP_TOOLS_PANEL_ID, closedLineTool, register } from './index';
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

async function open(project = sampleProject()) {
  const shell = renderShell(() => ({ autoSetup: createAutoSetup() }));
  await openSample(shell, project);
  const store = shell.services.store as ProjectStoreWithHistory;
  const panel = () => within(document.querySelector<HTMLElement>(`[data-panel-id="${SETUP_TOOLS_PANEL_ID}"]`)!);
  const hints = () => store.get().model.setupHints;
  return { ...shell, store, panel, hints, ptr: pointer(shell.canvas) };
}

const activeTool = () =>
  within(screen.getByRole('toolbar', { name: 'キャンバスのツール' }))
    .getAllByRole('button')
    .find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent;

// 目 L（白目 537〜653 × 430〜510）の下のほうを左から右へなぞる点
const STROKE_L: Vec2[] = [
  { x: 530, y: 486 },
  { x: 560, y: 492 },
  { x: 595, y: 496 },
  { x: 630, y: 492 },
  { x: 660, y: 486 },
];

describe('閉じた目の線のパネル', () => {
  it('両目の「線なし」を出し、[なぞる] でなぞるツールになる。画面の左右も書く', async () => {
    const shell = await open();
    expect(shell.panel().getByTestId('closed-line-state-L').textContent).toBe('線なし');
    expect(shell.panel().getByTestId('closed-line-state-R').textContent).toBe('線なし');
    expect(shell.panel().getByText('目 L（画面の右）')).toBeTruthy();
    expect((shell.panel().getByRole('button', { name: '目 L の線を消す' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(shell.panel().getByRole('button', { name: '目 R の線をなぞる' }));
    expect(activeTool()).toBe('閉じた線のなぞり');
    expect(shell.canvas.getState().activeToolId).toBe(CLOSED_LINE_TOOL_ID);
    expect(shell.panel().getByRole('button', { name: '目 R の線をなぞる' }).getAttribute('aria-pressed')).toBe('true');
    expect(shell.panel().getByText(/キャンバスで目 R の閉じた線を/)).toBeTruthy();
  });

  it('なぞると、その目の線がキャンバス座標で保存され（x の昇順）、1回で Undo できる', async () => {
    const shell = await open();
    fireEvent.click(shell.panel().getByRole('button', { name: '目 L の線をなぞる' }));
    shell.ptr.drag(STROKE_L[0]!, STROKE_L[4]!, {}, 3, STROKE_L.slice(1, 4));
    const line = shell.hints().closedLineL!;
    expect(shell.hints().closedLineR).toBeNull();
    expect(line.length).toBeGreaterThan(5);
    expect(line[0]!.x).toBeCloseTo(530, 0);
    expect(line[line.length - 1]!.x).toBeCloseTo(660, 0);
    expect(line.every((p, i) => i === 0 || p.x > line[i - 1]!.x)).toBe(true);
    expect(Math.max(...line.map((p) => p.y))).toBeCloseTo(496, 0);
    expect(shell.store.undoLabel()).toBe('閉じた目の線');
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
    const right = shell.hints().closedLineR!;
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

  it('短い線（クリックや縦の線）は保存せずに知らせる。Esc でなぞるのをやめる', async () => {
    const shell = await open();
    fireEvent.click(shell.panel().getByRole('button', { name: '目 L の線をなぞる' }));
    shell.ptr.click({ x: 600, y: 480 });
    expect(shell.hints().closedLineL).toBeNull();
    expect(await screen.findByText(SHORT_LINE_MESSAGE)).toBeTruthy();
    expect(shell.store.canUndo()).toBe(false);

    shell.ptr.down(STROKE_L[0]!);
    shell.ptr.move(STROKE_L[2]!);
    expect(closedLineTool.stroke()).toHaveLength(2);
    fireEvent.keyDown(screen.getByTestId('canvas-stage'), { key: 'Escape' });
    expect(closedLineTool.stroke()).toBeNull();
    shell.ptr.up(STROKE_L[4]!);
    expect(shell.hints().closedLineL).toBeNull();
  });

  it('ツールは保存した両目の線と、なぞっている途中の線を描く', async () => {
    const shell = await open();
    fireEvent.click(shell.panel().getByRole('button', { name: '目 L の線をなぞる' }));
    shell.ptr.drag(STROKE_L[0]!, STROKE_L[4]!, {}, 2);
    const saved = shell.hints().closedLineL!;
    const view = shell.canvas.getState().view;
    const ctx = new RecordingContext();
    closedLineTool.tool.drawOverlay!(ctx.asContext(), view);
    expect(ctx.named('moveTo')).toHaveLength(1);
    expect(ctx.named('lineTo')).toHaveLength(saved.length - 1);
    expect(ctx.named('arc')).toHaveLength(2); // 両端の点
    const first = ctx.named('moveTo')[0]!;
    expect(first[0]).toBeCloseTo(saved[0]!.x * view.scale + view.offset.x, 3);

    shell.ptr.down({ x: 340, y: 486 });
    shell.ptr.move({ x: 400, y: 490 });
    const drawing = new RecordingContext();
    closedLineTool.tool.drawOverlay!(drawing.asContext(), view);
    expect(drawing.named('moveTo')).toHaveLength(2);
    shell.ptr.up({ x: 400, y: 490 });
  });
});

describe('かんたんセットアップとのつながり', () => {
  it('なぞった線で [かんたんセットアップ] を押すと、まばたきが線に沿うキー（頂点）になる', async () => {
    const shell = await open(sampleWithMeshes());
    fireEvent.click(shell.panel().getByRole('button', { name: '目 L の線をなぞる' }));
    shell.ptr.drag(STROKE_L[0]!, STROKE_L[4]!, {}, 3, STROKE_L.slice(1, 4));
    const assign = within(document.querySelector<HTMLElement>('[data-panel-id="assets.assign"]')!);
    fireEvent.click(assign.getByRole('button', { name: 'かんたんセットアップ' }));
    const model = shell.store.get().model;
    const lid = model.parts.find((q) => q.standardType === 'upperLidL')!;
    const blink = model.bindings.find(
      (b) => b.channel === 'vertices' && b.target.id === lid.meshId && b.parameterIds[0] === 'EyeOpenL',
    );
    expect(blink?.keys.map((k) => k.coords[0])).toEqual([0, 1]);
    // 線の無い R は MVP の閉じ方のまま
    const lidR = model.parts.find((q) => q.standardType === 'upperLidR')!;
    expect(model.bindings.some((b) => b.channel === 'vertices' && b.target.id === lidR.meshId)).toBe(false);
    expect(shell.store.undoLabel()).toBe('かんたんセットアップ');
  });
});
