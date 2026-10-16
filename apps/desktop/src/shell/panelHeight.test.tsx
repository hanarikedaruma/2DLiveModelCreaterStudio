// I-064: 右の列の共通パレットの高さを、パネルの下の境目のドラッグ・キーで決める。
// 架空のパネルで、境目を出すパネル・ドラッグ・取り消し・中身に合わせる・保存を確かめる。
// 窓の大きさごとの CSS の決まり（縮めない・最低の高さ）は Layout.c61.test.tsx で確かめる
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Renderer, Services } from '@app/contracts';
import { createFakeServices } from '../services';
import { registerCanvasTool, registerPanel } from './api';
import { createCanvasController } from './canvas/controller';
import { createEnvironmentStore, memoryEnvironmentStorage } from './environment';
import { registry } from './registry';
import { Shell } from './Shell';
import { LAYOUT_SIZES_KEY } from './layoutSizes';

const HEIGHTS_KEY = 'live2d-studio.panelHeights';
const COLLAPSED_KEY = 'live2d-studio.collapsedPanels';

// 共通パレットの中身が描き直された回数（ドラッグ中に中身まで描き直さないことを見る）
let commonRenders = 0;
const CommonBody = () => {
  commonRenders++;
  return <p>共通の中身</p>;
};
const Body = () => <p>中身</p>;

beforeEach(() => {
  localStorage.clear();
  registry.reset();
  commonRenders = 0;
  registerCanvasTool({ id: 't.select', label: '選択' });
  registerCanvasTool({ id: 't.brush', label: 'ブラシ' });
  registerPanel({ id: 'common', mode: 'modeling', area: 'right', title: '共通', order: 10, component: CommonBody });
  registerPanel({ id: 'common2', mode: 'modeling', area: 'right', title: '共通2', order: 20, component: Body });
  registerPanel({
    id: 'tool',
    mode: 'modeling',
    area: 'right',
    title: 'ブラシ',
    order: 5,
    component: Body,
    object: { kind: 'tool', when: ({ activeToolId }) => activeToolId === 't.brush' },
  });
  registerPanel({ id: 'leftList', mode: 'modeling', area: 'left', title: '左', order: 10, component: Body });
});
afterEach(() => {
  registry.reset();
  localStorage.clear();
});

function setup() {
  const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };
  const services: Services = { ...createFakeServices(), createRenderer: () => renderer };
  const canvas = createCanvasController();
  const view = render(
    <Shell services={services} environment={createEnvironmentStore(memoryEnvironmentStorage(null))} canvas={canvas} />,
  );
  const panel = (id: string) => document.querySelector<HTMLElement>(`[data-panel-id="${id}"]`)!;
  const body = (id: string) => panel(id).querySelector<HTMLElement>(':scope > .panel-body')!;
  const handle = (title: string) => screen.getByRole('separator', { name: `「${title}」の高さ` });
  const saved = () =>
    Object.fromEntries(
      Object.entries(JSON.parse(localStorage.getItem(LAYOUT_SIZES_KEY) ?? '{}') as Record<string, number>)
        .filter(([id]) => id.startsWith('modeling.panel.'))
        .map(([id, value]) => [id.slice('modeling.panel.'.length), value]),
    );
  return { services, canvas, view, panel, body, handle, saved };
}

// 中身に合わせた今の高さ（jsdom はレイアウトを計算しないので決めて渡す）
function layoutBody(el: HTMLElement, height: number) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 260, height));
}

function drag(handle: HTMLElement, from: number, to: number, end: 'pointerUp' | 'pointerCancel' = 'pointerUp') {
  act(() => {
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: from });
  });
  act(() => {
    fireEvent.pointerMove(window, { pointerId: 1, clientY: to });
  });
  act(() => {
    fireEvent[end](window, { pointerId: 1, clientY: to });
  });
}

describe('右の列のパネルの高さ（I-064）', () => {
  it('I-087: 左・右・オブジェクトの開いたパネルに境目を出し、たたんだパネルには出さない', () => {
    const { canvas } = setup();
    act(() => canvas.setActiveTool('t.brush'));
    expect(screen.getAllByRole('separator').map((s) => s.getAttribute('aria-label'))).toEqual([
      '「左」の高さ',
      '左の列の幅',
      '右の列の幅',
      '「ブラシ」の高さ',
      '「共通」の高さ',
      '「共通2」の高さ',
    ]);
    fireEvent.click(screen.getByRole('button', { name: '共通2' }));
    expect(screen.queryByRole('separator', { name: '「共通2」の高さ' })).toBeNull();
    expect(screen.getByRole('separator', { name: '「共通」の高さ' })).toBeTruthy();
  });

  it('初めは中身に合わせ、境目をドラッグすると中身の高さを決める。離したときに覚える', () => {
    const { panel, body, handle, saved } = setup();
    const h = handle('共通');
    expect(panel('common').classList.contains('sized')).toBe(false);
    expect(body('common').style.height).toBe('');
    expect(h.getAttribute('aria-valuetext')).toBe('中身に合わせる');
    expect(h.getAttribute('aria-valuenow')).toBeNull();
    layoutBody(body('common'), 200);

    act(() => {
      fireEvent.pointerDown(h, { button: 0, pointerId: 1, clientY: 100 });
    });
    expect(h.classList.contains('dragging')).toBe(true);
    act(() => {
      fireEvent.pointerMove(window, { pointerId: 1, clientY: 150 });
    });
    // ドラッグ中は見た目だけ変え、まだ覚えない。中身は描き直さない
    expect(body('common').style.height).toBe('250px');
    expect(panel('common').classList.contains('sized')).toBe(true);
    expect(saved()).toEqual({});
    const rendersWhileDragging = commonRenders;
    act(() => {
      fireEvent.pointerMove(window, { pointerId: 1, clientY: 130 });
    });
    expect(body('common').style.height).toBe('230px');
    expect(commonRenders).toBe(rendersWhileDragging);
    act(() => {
      fireEvent.pointerUp(window, { pointerId: 1, clientY: 130 });
    });
    expect(h.classList.contains('dragging')).toBe(false);
    expect(body('common').style.height).toBe('230px');
    expect(h.getAttribute('aria-valuenow')).toBe('230');
    expect(saved()).toEqual({ common: 230 });
    // 離したあとの動きでは変わらない
    act(() => {
      fireEvent.pointerMove(window, { pointerId: 1, clientY: 400 });
    });
    expect(body('common').style.height).toBe('230px');
    // ほかのパネルはそのまま（中身に合わせる）
    expect(panel('common2').classList.contains('sized')).toBe(false);
  });

  it('押しただけでは高さを決めない。取り消された（pointercancel）ドラッグは元に戻し、覚えない', () => {
    const { panel, body, handle, saved } = setup();
    layoutBody(body('common'), 200);
    drag(handle('共通'), 100, 100);
    expect(panel('common').classList.contains('sized')).toBe(false);
    expect(saved()).toEqual({});
    drag(handle('共通'), 100, 180, 'pointerCancel');
    expect(panel('common').classList.contains('sized')).toBe(false);
    expect(body('common').style.height).toBe('');
    expect(saved()).toEqual({});
  });

  it('決めた高さからさらにドラッグでき、最低 60px・最大 4000px で止まる', () => {
    const { body, handle, saved } = setup();
    layoutBody(body('common'), 200);
    drag(handle('共通'), 100, -500);
    expect(body('common').style.height).toBe('60px');
    expect(saved()).toEqual({ common: 60 });
    // 決めた高さ（60）から始める（中身の実際の高さではなく）
    drag(handle('共通'), 100, 140);
    expect(saved()).toEqual({ common: 100 });
    drag(handle('共通'), 0, 9000);
    expect(saved()).toEqual({ common: 4000 });
  });

  it('ダブルクリックで中身に合わせる（決めた高さを外す）', () => {
    const { panel, body, handle, saved } = setup();
    layoutBody(body('common'), 200);
    drag(handle('共通'), 100, 120);
    layoutBody(body('common2'), 80);
    drag(handle('共通2'), 0, 40);
    expect(saved()).toEqual({ common: 220, common2: 120 });
    fireEvent.doubleClick(handle('共通'));
    expect(panel('common').classList.contains('sized')).toBe(false);
    expect(body('common').style.height).toBe('');
    expect(handle('共通').getAttribute('aria-valuetext')).toBe('中身に合わせる');
    expect(saved()).toEqual({ common2: 120 });
  });

  it('境目にフォーカスして ↑↓ で 16px、Shift と一緒で 64px ずつ変える', () => {
    const { body, handle, saved } = setup();
    layoutBody(body('common'), 200);
    const h = handle('共通');
    expect(h.tabIndex).toBe(0);
    fireEvent.keyDown(h, { key: 'ArrowDown' });
    expect(saved()).toEqual({ common: 216 });
    fireEvent.keyDown(h, { key: 'ArrowUp', shiftKey: true });
    expect(saved()).toEqual({ common: 152 });
    expect(body('common').style.height).toBe('152px');
    // ほかのキーでは変えない
    fireEvent.keyDown(h, { key: 'ArrowLeft' });
    expect(saved()).toEqual({ common: 152 });
  });

  it('決めた高さは開き直し・次の起動でも使う。たたんでいる間は高さを掛けない', () => {
    localStorage.setItem(HEIGHTS_KEY, JSON.stringify({ common: 150 }));
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(['common']));
    const { panel, body, view } = setup();
    expect(panel('common').classList.contains('collapsed')).toBe(true);
    expect(panel('common').classList.contains('sized')).toBe(false);
    expect(body('common').style.height).toBe('');
    expect(screen.queryByRole('separator', { name: '「共通」の高さ' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '共通' }));
    expect(panel('common').classList.contains('sized')).toBe(true);
    expect(body('common').style.height).toBe('150px');
    view.unmount();
    setup();
    expect(document.querySelector<HTMLElement>('[data-panel-id="common"] > .panel-body')!.style.height).toBe('150px');
  });

  it('保存した値が壊れていれば、その値だけ使わない（数でない値・範囲の外は丸める）', () => {
    localStorage.setItem(HEIGHTS_KEY, JSON.stringify({ common: 'tall', common2: 10, tool: 300 }));
    const first = setup();
    expect(first.body('common').style.height).toBe('');
    expect(first.body('common2').style.height).toBe('60px');
    first.view.unmount();
    for (const broken of ['[1, 2]', '{', 'null']) {
      localStorage.removeItem(LAYOUT_SIZES_KEY);
      localStorage.setItem(HEIGHTS_KEY, broken);
      const { view, body } = setup();
      expect({ broken, heights: [body('common').style.height, body('common2').style.height] }).toEqual({
        broken,
        heights: ['', ''],
      });
      view.unmount();
    }
  });

  it('古い形式のオブジェクトの高さは、以前と同じく掛けず移行しない', () => {
    localStorage.setItem(HEIGHTS_KEY, JSON.stringify({ tool: 300 }));
    const { canvas, panel, body } = setup();
    act(() => canvas.setActiveTool('t.brush'));
    expect(panel('tool').classList.contains('sized')).toBe(false);
    expect(body('tool').style.height).toBe('');
  });
});
