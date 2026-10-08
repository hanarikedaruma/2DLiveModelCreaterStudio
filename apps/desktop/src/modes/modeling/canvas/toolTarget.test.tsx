// キャンバスの枠の共通の振る舞い（モデリングのツールとパレットの整理、CC-012。docs/modeling-palette-design.md）。
// 右クリックでの選択の解除、対象の要るツールの「対象を選ぶ段」（案内の帯・点線の囲み・クリックでの選択）、
// ツールバーに出さないツールを、本物の枠（Shell・CanvasHost）とサンプルのモデルで確かめる
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCanvasTool, type CanvasTool } from '../../../shell/api';
import { registry } from '../../../shell/registry';
import { register as registerCanvasEdit, SELECT_TOOL_ID } from './index';
import { imagePartAt } from './parts';
import { RecordingContext, openSample, pointer, renderShell, stubSize } from './testUtils';

const TORSO = { x: 500, y: 1300 }; // 胴体だけがある所
const FACE = { x: 400, y: 650 }; // 顔（後ろに後ろ髪）
const EMPTY = { x: 50, y: 50 };
const PROMPT = 'テストの対象を、キャンバスでクリックして選ぶ';

// jsdom のキャンバスは 2D を持たないので、重ね描きを記録するものに差し替える。描くたびに clearRect で空にする
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

const received: string[] = [];
let contextClicks = 0;
const targetTool: CanvasTool = {
  id: 'test.target',
  label: '対象の要るツール',
  cursor: 'crosshair',
  target: {
    prompt: PROMPT,
    has: (_project, editor) => editor.selectedPartIds.length > 0,
    pick: (project, deformed, p) => imagePartAt(project.model, deformed, p),
  },
  onPointerDown: () => received.push('down'),
  onPointerMove: () => received.push('move'),
  onPointerUp: () => received.push('up'),
  drawOverlay: (ctx) => ctx.fillText('ツールの重ね描き', 0, 0),
};

let ctx: OverlayContext;
let restoreSize: () => void = () => {};
beforeEach(() => {
  registry.reset();
  registerCanvasEdit();
  registerCanvasTool(targetTool);
  registerCanvasTool({ id: 'test.hidden', label: '隠れたツール', toolbar: false });
  registerCanvasTool({ id: 'test.context', label: '右クリックを受けるツール', onContextClick: () => contextClicks++ });
  received.length = 0;
  contextClicks = 0;
  ctx = new OverlayContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
    type === '2d' ? ctx.asContext() : null) as unknown as HTMLCanvasElement['getContext']);
  restoreSize = stubSize(800, 600);
});
afterEach(() => {
  restoreSize();
  vi.restoreAllMocks();
});

async function open() {
  const shell = renderShell();
  await openSample(shell);
  const selected = () => shell.services.editor.get().selectedPartIds;
  return { ...shell, selected, ptr: pointer(shell.canvas) };
}

const toolbarLabels = () =>
  within(screen.getByRole('toolbar', { name: 'キャンバスのツール' }))
    .getAllByRole('button')
    .map((b) => b.textContent);

describe('ツールバーに出さないツール', () => {
  it('toolbar: false のツールはボタンを出さないが、切り替えれば使える', async () => {
    const shell = await open();
    expect(toolbarLabels()).toContain('対象の要るツール');
    expect(toolbarLabels()).not.toContain('隠れたツール');
    act(() => shell.canvas.setActiveTool('test.hidden'));
    expect(shell.canvas.getState().activeToolId).toBe('test.hidden');
    expect(toolbarLabels()).not.toContain('隠れたツール');
  });
});

describe('右クリック', () => {
  it('選択・変形ツールでは、右クリックでパーツの選択を外す。右ドラッグでは外さない', async () => {
    const shell = await open();
    shell.ptr.click(TORSO);
    expect(shell.selected()).toEqual(['part-torso']);
    shell.ptr.down(FACE, { button: 2 });
    shell.ptr.move({ x: FACE.x + 200, y: FACE.y }, { button: 2 });
    shell.ptr.up({ x: FACE.x + 200, y: FACE.y }, { button: 2 });
    expect(shell.selected()).toEqual(['part-torso']);
    shell.ptr.rightClick(FACE);
    expect(shell.selected()).toEqual([]);
    expect(shell.canvas.getState().activeToolId).not.toBe('test.context');
  });

  it('onContextClick のあるツールでは、選択を外さずにツールに任せる', async () => {
    const shell = await open();
    shell.ptr.click(TORSO);
    fireEvent.click(screen.getByRole('button', { name: '右クリックを受けるツール' }));
    shell.ptr.rightClick(TORSO);
    expect(contextClicks).toBe(1);
    expect(shell.selected()).toEqual(['part-torso']);
  });
});

describe('対象を選ぶ段', () => {
  it('対象が無い間は、案内の帯とマウスの下のパーツの点線の囲みを描き、ツールの重ね描きはしない', async () => {
    const shell = await open();
    fireEvent.click(screen.getByRole('button', { name: '対象の要るツール' }));
    await waitFor(() => expect(ctx.texts).toEqual([PROMPT]));
    expect(screen.getByTestId('canvas-overlay').style.cursor).toBe('pointer');
    // マウスの下の胴体を点線で囲み、名前を出す
    shell.ptr.hover(TORSO);
    await waitFor(() => expect(ctx.texts).toEqual(['胴体', PROMPT]));
    expect(ctx.named('strokeRect').length).toBeGreaterThanOrEqual(2); // 囲みと帯の枠
    // 何も無い所では囲まない
    shell.ptr.hover(EMPTY);
    await waitFor(() => expect(ctx.texts).toEqual([PROMPT]));
    expect(received).toEqual([]);
  });

  it('押すとその所のパーツを選び、選ぶまでの押す操作はツールへ渡さない。選んだ後はツールが受け取る', async () => {
    const shell = await open();
    fireEvent.click(screen.getByRole('button', { name: '対象の要るツール' }));
    // 何も無い所を押しても何も選ばない
    shell.ptr.click(EMPTY);
    expect(shell.selected()).toEqual([]);
    shell.ptr.drag(TORSO, { x: TORSO.x + 40, y: TORSO.y });
    expect(shell.selected()).toEqual(['part-torso']);
    expect(received).toEqual([]);
    await waitFor(() => expect(ctx.texts).toEqual(['ツールの重ね描き']));
    expect(screen.getByTestId('canvas-overlay').style.cursor).toBe('crosshair');
    // 対象がある間は、押す操作をツールへ渡し、枠は選択を変えない
    shell.ptr.click(FACE);
    expect(received).toEqual(['down', 'up']);
    expect(shell.selected()).toEqual(['part-torso']);
    // 右クリックで選択を外すと、対象を選ぶ段に戻る（マウスの下の顔を囲む）
    shell.ptr.rightClick(FACE);
    expect(shell.selected()).toEqual([]);
    await waitFor(() => expect(ctx.texts).toEqual(['顔', PROMPT]));
  });

  it('選択・変形ツールには対象を選ぶ段が無い（今までどおり）', async () => {
    const shell = await open();
    expect(shell.canvas.getState().activeToolId === '' || shell.canvas.getState().activeToolId === SELECT_TOOL_ID).toBe(
      true,
    );
    await waitFor(() => expect(ctx.frames).toBeGreaterThan(0));
    expect(ctx.texts).not.toContain(PROMPT);
    shell.ptr.click(TORSO);
    expect(shell.selected()).toEqual(['part-torso']);
  });
});
