import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeformedModel } from '@app/contracts';
import { emitAppEvent } from '../../../shell/events';
import { registry } from '../../../shell/registry';
import { GHOST_OPACITY, copyTinted, drawGhost, freezeDeformed } from '../../../shell/canvas/ghost';
import { register } from './index';
import { openSample, renderShell, stubSize } from './testUtils';

type Call = { op: string; args: unknown[]; alpha: unknown };

// 呼ばれた順を覚えるだけの 2D コンテキスト（jsdom には無い）
function recordingContext(canvas: HTMLCanvasElement) {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { canvas, globalAlpha: 1, globalCompositeOperation: 'source-over' };
  const ctx = new Proxy(state, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      if (prop === 'measureText') return () => ({ width: 0 });
      return (...args: unknown[]) => {
        calls.push({ op: prop, args, alpha: t.globalAlpha });
      };
    },
    set(t, prop: string, value) {
      t[prop] = value;
      calls.push({ op: `set:${prop}`, args: [value], alpha: t.globalAlpha });
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const contexts = new WeakMap<HTMLCanvasElement, ReturnType<typeof recordingContext>>();
const recorder = (canvas: HTMLCanvasElement) => {
  let r = contexts.get(canvas);
  if (!r) contexts.set(canvas, (r = recordingContext(canvas)));
  return r;
};

const originalGetContext = HTMLCanvasElement.prototype.getContext;
let restoreSize: () => void = () => {};
beforeEach(() => {
  registry.reset();
  register();
  restoreSize = stubSize(800, 600);
  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement) {
    return recorder(this).ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  restoreSize();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

const ghostButton = () => screen.getByRole('button', { name: '透かし' });
const positionsOf = (m: DeformedModel) => m.items.map((i) => Array.from(i.positions));

describe('I-070: 透かし', () => {
  it('［透かし］を押すと、押したときの形を止めて先に描き、今の形を描く。もう一度押すと消える', async () => {
    const shell = renderShell();
    await openSample(shell);
    const { renderer, canvas, services } = shell;
    expect(ghostButton().getAttribute('aria-pressed')).toBe('false');
    const before = canvas.lastDeformed()!;

    let n = renderer.renders.length;
    fireEvent.click(ghostButton());
    expect(ghostButton().getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(renderer.renders.length).toBeGreaterThanOrEqual(n + 2));
    const [ghostRender, currentRender] = renderer.renders.slice(n);
    const ghost = ghostRender!.model;
    expect(ghost).not.toBe(before);
    expect(positionsOf(ghost)).toEqual(positionsOf(before));
    expect(ghost.items[0]!.positions).not.toBe(before.items[0]!.positions); // 頂点は写して止める
    expect(currentRender!.model).toBe(canvas.lastDeformed());

    // 値を変えても透かしは押したときの形のまま。表示が同じなら透かしは描き直さない
    n = renderer.renders.length;
    act(() => services.editor.set({ editorParamValues: { FaceAngleX: 30 } }));
    await waitFor(() => expect(canvas.lastDeformed()).not.toBe(before));
    await waitFor(() => expect(renderer.renders.length).toBeGreaterThan(n));
    expect(renderer.renders.slice(n).some((r) => r.model === ghost)).toBe(false);
    expect(positionsOf(ghost)).toEqual(positionsOf(before));

    // 拡大縮小・移動したら、透かしも同じ表示で描き直す
    n = renderer.renders.length;
    const view = { scale: 0.5, offset: { x: 10, y: 20 } };
    act(() => canvas.setView(view));
    await waitFor(() => expect(renderer.renders.length).toBeGreaterThanOrEqual(n + 2));
    expect(renderer.renders[n]).toEqual({ model: ghost, view });
    expect(renderer.renders[n + 1]!.model).toBe(canvas.lastDeformed());

    // もう一度押すと消える
    fireEvent.click(ghostButton());
    expect(ghostButton().getAttribute('aria-pressed')).toBe('false');
    n = renderer.renders.length;
    act(() => canvas.setView({ scale: 0.4, offset: { x: 0, y: 0 } }));
    await waitFor(() => expect(renderer.renders.length).toBeGreaterThan(n));
    expect(renderer.renders.slice(n).some((r) => r.model === ghost)).toBe(false);
  });

  it('透かしの絵は、重ね描きの最初に薄く重ねる（ツールの枠などはその上）', async () => {
    const shell = renderShell();
    await openSample(shell);
    act(() => shell.services.editor.set({ selectedPartIds: ['part-face'] }));
    const overlay = screen.getByTestId('canvas-overlay') as HTMLCanvasElement;
    const main = screen.getByTestId('canvas-main') as HTMLCanvasElement;
    const calls = recorder(overlay).calls;
    await waitFor(() => expect(calls.some((c) => c.op === 'stroke')).toBe(true));

    calls.length = 0;
    fireEvent.click(ghostButton());
    await waitFor(() => expect(calls.some((c) => c.op === 'drawImage')).toBe(true));
    const draw = calls.findIndex((c) => c.op === 'drawImage');
    const image = calls[draw]!.args[0] as HTMLCanvasElement;
    expect(image).not.toBe(main);
    expect(calls[draw]!.args.slice(1)).toEqual([0, 0, overlay.width, overlay.height]);
    expect(calls[draw]!.alpha).toBe(GHOST_OPACITY);
    expect(calls.findIndex((c) => c.op === 'clearRect')).toBeLessThan(draw);
    expect(calls.findIndex((c) => c.op === 'stroke')).toBeGreaterThan(draw); // 選択の枠は透かしの上

    // 透かしの絵は main の絵を写して青く染めたもの
    const imageCalls = recorder(image).calls.map((c) => c.op);
    expect(imageCalls.indexOf('drawImage')).toBeLessThan(imageCalls.indexOf('fillRect'));
    expect(recorder(image).calls.find((c) => c.op === 'drawImage')!.args[0]).toBe(main);
  });

  it('別のプロジェクトを開いたら（新規に作ったら）透かしを消す', async () => {
    const shell = renderShell();
    await openSample(shell);
    fireEvent.click(ghostButton());
    expect(ghostButton().getAttribute('aria-pressed')).toBe('true');
    act(() => emitAppEvent('projectLoaded'));
    expect(ghostButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('止めた形・写して染める・薄く重ねる（部品）', () => {
    const positions = new Float32Array([1, 2, 3, 4]);
    const item = {
      partId: 'a',
      assetId: 'x',
      positions,
      uvs: new Float32Array(4),
      indices: new Uint32Array(0),
      opacity: 1,
      blendMode: 'normal' as const,
      mask: null,
    };
    const frozen = freezeDeformed({ items: [item], byPartId: { a: item } });
    positions[0] = 99;
    expect(Array.from(frozen.items[0]!.positions)).toEqual([1, 2, 3, 4]);
    expect(frozen.byPartId.a).toBe(frozen.items[0]);

    const source = document.createElement('canvas');
    source.width = 30;
    source.height = 20;
    const target = document.createElement('canvas');
    copyTinted(source, target);
    expect([target.width, target.height]).toEqual([30, 20]);
    const ops = recorder(target).calls;
    const op = (name: string) => ops.findIndex((c) => c.op === name);
    expect(op('clearRect')).toBeLessThan(op('drawImage'));
    expect(ops.find((c) => c.op === 'set:globalCompositeOperation')!.args[0]).toBe('source-atop');
    expect(op('set:globalCompositeOperation')).toBeGreaterThan(op('drawImage'));
    expect(ops[op('fillRect')]!.args).toEqual([0, 0, 30, 20]);

    const overlay = document.createElement('canvas');
    const { ctx, calls } = recorder(overlay);
    drawGhost(ctx, target, 60, 40);
    const draw = calls.find((c) => c.op === 'drawImage')!;
    expect(draw.args).toEqual([target, 0, 0, 60, 40]);
    expect(draw.alpha).toBe(GHOST_OPACITY);
    expect(calls.find((c) => c.op === 'setTransform')!.args).toEqual([1, 0, 0, 1, 0, 0]);
  });
});
