import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registry } from '../registry';
import { register } from '../../modes/modeling/canvas';
import { openSample, renderShell, stubSize } from '../../modes/modeling/canvas/testUtils';
import { drawGrid, gridSteps, readGridVisible } from './grid';

type Call = { op: string; args: unknown[] };

// 呼ばれた順を覚えるだけの 2D コンテキスト（jsdom には無い）
function recordingContext(canvas: HTMLCanvasElement) {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { canvas, globalAlpha: 1 };
  const ctx = new Proxy(state, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      if (prop === 'measureText') return () => ({ width: 0 });
      return (...args: unknown[]) => calls.push({ op: prop, args });
    },
    set(t, prop: string, value) {
      t[prop] = value;
      calls.push({ op: `set:${prop}`, args: [value] });
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

const MINOR_COLOR = 'rgba(255, 255, 255, 0.11)';
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
  localStorage.removeItem('live2d-studio.canvasGrid');
});

describe('I-077: グリッドの補助線', () => {
  it('線の間隔は、画面で 16px より狭くならない 5・10・20・50… の中から選び、太い線はその 5 倍（50 なら 2 倍）', () => {
    expect(gridSteps(1)).toEqual({ minor: 20, major: 100 });
    expect(gridSteps(0.36)).toEqual({ minor: 50, major: 100 });
    expect(gridSteps(0.25)).toEqual({ minor: 100, major: 500 });
    expect(gridSteps(4)).toEqual({ minor: 5, major: 10 });
    expect(gridSteps(0.001)).toEqual({ minor: 5000, major: 10000 });
  });

  it('見えている範囲だけに線を引き、素材のキャンバスの中心に点線を引く', () => {
    const { ctx, calls } = recordingContext(document.createElement('canvas'));
    // 倍率 1・ずらしなし・200×100 の画面: 縦の線は x = 0, 20, …, 200 の 11 本、横の線は y = 0, 20, …, 100 の 6 本
    drawGrid(ctx, { scale: 1, offset: { x: 0, y: 0 } }, 200, 100, { width: 100, height: 60 }, '#5b8def');
    const verticals = calls.filter((c) => c.op === 'moveTo' && (c.args[1] as number) === 0);
    expect(verticals.map((c) => c.args[0])).toEqual(
      expect.arrayContaining([0.5, 20.5, 40.5, 60.5, 80.5, 100.5, 120.5, 140.5, 160.5, 180.5, 200.5]),
    );
    const dash = calls.findIndex((c) => c.op === 'setLineDash');
    expect(dash).toBeGreaterThan(0);
    // 中心は (50, 30)
    const center = calls.slice(dash).filter((c) => c.op === 'moveTo');
    expect(center.map((c) => c.args)).toEqual([
      [50.5, 0],
      [0, 30.5],
    ]);
  });

  it('［グリッド］で出す・消す。出しているかは覚えて次も使う', async () => {
    const shell = renderShell();
    await openSample(shell);
    const overlay = screen.getByTestId('canvas-overlay') as HTMLCanvasElement;
    const calls = recorder(overlay).calls;
    const button = () => screen.getByRole('button', { name: 'グリッド' });
    const drawsGrid = () => calls.some((c) => c.op === 'set:strokeStyle' && c.args[0] === MINOR_COLOR);
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(drawsGrid()).toBe(false);

    fireEvent.click(button());
    expect(button().getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(drawsGrid()).toBe(true));
    expect(readGridVisible()).toBe(true);

    fireEvent.click(button());
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(readGridVisible()).toBe(false);
    calls.length = 0;
    shell.canvas.setView({ scale: 0.5, offset: { x: 0, y: 0 } });
    await waitFor(() => expect(calls.some((c) => c.op === 'clearRect')).toBe(true));
    expect(drawsGrid()).toBe(false);
  });
});
