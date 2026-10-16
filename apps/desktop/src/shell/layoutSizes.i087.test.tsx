import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeServices } from '../services';
import { registerCanvasTool, registerCenter, registerPanel } from './api';
import { createCanvasController } from './canvas/controller';
import { createEnvironmentStore, memoryEnvironmentStorage } from './environment';
import { fitColumnWidths, LAYOUT_SIZES_KEY } from './layoutSizes';
import { registry } from './registry';
import { Shell } from './Shell';
import { AnimationCenter } from '../modes/animation/AnimationCenter';

const Body = () => <p>中身</p>;
const separator = (name: string) => screen.getByRole('separator', { name });
const saved = () => JSON.parse(localStorage.getItem(LAYOUT_SIZES_KEY) ?? '{}') as Record<string, number>;
const panelBody = (id: string) => document.querySelector<HTMLElement>(`[data-panel-id="${id}"] > .panel-body`)!;

beforeEach(() => {
  localStorage.clear();
  registry.reset();
  for (const mode of ['modeling', 'studio', 'animation'] as const) {
    registerPanel({ id: `${mode}.L`, mode, area: 'left', title: '左', order: 1, component: Body });
    registerPanel({ id: `${mode}.R`, mode, area: 'right', title: '右', order: 1, component: Body });
  }
  registerPanel({ id: 'expression', mode: 'studio', area: 'bottom', title: '表情', order: 1, component: Body });
  registerPanel({ id: 'clips', mode: 'studio', area: 'bottom', title: '動き', order: 2, component: Body });
  registerCanvasTool({ id: 'select', label: '選択' });
  registerCanvasTool({ id: 'brush', label: 'ブラシ' });
  registerPanel({
    id: 'tool',
    mode: 'modeling',
    area: 'right',
    title: 'ツール',
    order: 0,
    component: Body,
    object: { kind: 'tool', when: ({ activeToolId }) => activeToolId === 'brush' },
  });
});
afterEach(() => {
  registry.reset();
  localStorage.clear();
  vi.restoreAllMocks();
});

function setup() {
  const services = {
    ...createFakeServices(),
    createRenderer: () => ({ init() {}, setTextures() {}, render() {}, dispose() {} }),
  };
  const canvas = createCanvasController();
  const view = render(
    <Shell services={services} canvas={canvas} environment={createEnvironmentStore(memoryEnvironmentStorage())} />,
  );
  return { services, canvas, view };
}

function dragStart(name: string, axis: 'x' | 'y', delta: number) {
  fireEvent.pointerDown(separator(name), { button: 0, pointerId: 7, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(window, {
    pointerId: 7,
    clientX: axis === 'x' ? 100 + delta : 100,
    clientY: axis === 'y' ? 100 + delta : 100,
  });
}
function dragEnd() {
  fireEvent.pointerUp(window, { pointerId: 7 });
}

describe('I-087 全モードの大きさの保存', () => {
  it('左右・下・各パネル・モードの記録を一元化し、再起動でも残す', () => {
    const first = setup();
    fireEvent.keyDown(separator('左の列の幅'), { key: 'ArrowLeft' });
    fireEvent.keyDown(separator('右の列の幅'), { key: 'ArrowRight' });
    vi.spyOn(panelBody('modeling.L'), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 120));
    fireEvent.keyDown(separator('「左」の高さ'), { key: 'ArrowDown' });
    act(() => first.canvas.setActiveTool('brush'));
    vi.spyOn(panelBody('tool'), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 150));
    fireEvent.keyDown(separator('「ツール」の高さ'), { key: 'ArrowDown', shiftKey: true });
    act(() => first.services.editor.set({ mode: 'studio' }));
    fireEvent.keyDown(separator('下の列の高さ'), { key: 'ArrowUp' });
    fireEvent.keyDown(separator('「表情」の幅'), { key: 'ArrowLeft' });
    act(() => first.services.editor.set({ mode: 'animation' }));
    fireEvent.keyDown(separator('左の列の幅'), { key: 'ArrowLeft', shiftKey: true });
    const sizes = saved();
    expect(sizes).toMatchObject({
      'modeling.column.left': 264,
      'modeling.column.right': 264,
      'modeling.panel.modeling.L': 136,
      'modeling.panel.tool': 214,
      'studio.bottom.height': 236,
      'studio.bottom.expression.width': 384,
      'animation.column.left': 216,
    });
    first.view.unmount();
    const next = setup();
    expect(separator('左の列の幅').getAttribute('aria-valuenow')).toBe('264');
    expect(panelBody('modeling.L').style.height).toBe('136px');
    act(() => next.canvas.setActiveTool('brush'));
    expect(panelBody('tool').style.height).toBe('214px');
    expect(saved()).toEqual(sizes);
  });

  it.each(['Escape', 'pointercancel', 'blur'])('%s でドラッグを取り消し、保存値と表示を元に戻す', (cancel) => {
    setup();
    const before = saved();
    dragStart('左の列の幅', 'x', -40);
    expect(separator('左の列の幅').getAttribute('aria-valuenow')).toBe('240');
    expect(saved()).toEqual(before);
    if (cancel === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
    else if (cancel === 'pointercancel') fireEvent.pointerCancel(window, { pointerId: 7 });
    else fireEvent.blur(window);
    dragEnd();
    expect(separator('左の列の幅').getAttribute('aria-valuenow')).toBe('280');
    expect(saved()).toEqual(before);
  });

  it('移行時は新しい値を優先し、メニューの全リセット後も古い値が復活せず、開閉は残す', () => {
    localStorage.setItem('live2d-studio.panelHeights', JSON.stringify({ 'modeling.R': 150, 'studio.R': 180 }));
    localStorage.setItem(
      LAYOUT_SIZES_KEY,
      JSON.stringify({ 'modeling.panel.modeling.R': 200, 'studio.column.left': 340 }),
    );
    const first = setup();
    expect(saved()).toMatchObject({
      'modeling.panel.modeling.R': 200,
      'studio.panel.studio.R': 180,
      'studio.column.left': 340,
    });
    expect(localStorage.getItem('live2d-studio.panelHeights')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '左' }));
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'パネルの配置を元に戻す' }));
    expect(saved()).toEqual({});
    expect(localStorage.getItem('live2d-studio.collapsedPanels')).toContain('modeling.L');
    first.view.unmount();
    setup();
    expect(saved()).toEqual({});
    expect(panelBody('modeling.R').style.height).toBe('');
    expect(panelBody('modeling.L').hidden).toBe(true);
  });

  it('ドラッグ中にモードや窓の制約が変わったら取り消し、別のポインターや画面を離れた後のイベントは保存しない', () => {
    const { services, view } = setup();
    fireEvent.pointerDown(separator('左の列の幅'), { button: 0, pointerId: 7, clientX: 100 });
    fireEvent.pointerMove(window, { pointerId: 8, clientX: 160 });
    fireEvent.pointerUp(window, { pointerId: 8 });
    expect(separator('左の列の幅').getAttribute('aria-valuenow')).toBe('280');
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 60 });
    act(() => services.editor.set({ mode: 'studio' }));
    dragEnd();
    expect(saved()).toEqual({});
    expect(separator('左の列の幅').getAttribute('aria-valuenow')).toBe('280');
    dragStart('左の列の幅', 'x', -40);
    vi.spyOn(document.querySelector<HTMLElement>('.shell-body')!, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 800, 560),
    );
    fireEvent(window, new Event('resize'));
    dragEnd();
    expect(saved()).toEqual({});
    dragStart('左の列の幅', 'x', -40);
    view.unmount();
    dragEnd();
    expect(saved()).toEqual({});
  });

  it('窓を縮めても中央320pxを残し、希望の幅を保存し直さず、広げると戻る', () => {
    localStorage.setItem(
      LAYOUT_SIZES_KEY,
      JSON.stringify({ 'modeling.column.left': 500, 'modeling.column.right': 500 }),
    );
    const view = setup();
    const body = document.querySelector<HTMLElement>('.shell-body')!;
    const rect = vi.spyOn(body, 'getBoundingClientRect');
    rect.mockReturnValue(new DOMRect(0, 0, 800, 560));
    fireEvent(window, new Event('resize'));
    expect(separator('左の列の幅').getAttribute('aria-valuenow')).toBe('280');
    expect(separator('右の列の幅').getAttribute('aria-valuenow')).toBe('200');
    expect(saved()).toEqual({ 'modeling.column.left': 500, 'modeling.column.right': 500 });
    rect.mockReturnValue(new DOMRect(0, 0, 1440, 960));
    fireEvent(window, new Event('resize'));
    expect(separator('左の列の幅').getAttribute('aria-valuenow')).toBe('500');
    expect(separator('右の列の幅').getAttribute('aria-valuenow')).toBe('500');
    act(() => view.canvas.setActiveTool('brush'));
    expect(separator('右の列の幅').getAttribute('aria-valuenow')).toBe('500');
    expect(fitColumnWidths(800, 560, 560)).toEqual([280, 200]);
    expect(fitColumnWidths(800, 0, 560)).toEqual([0, 480]);
  });

  it('壊れた値を無視し、上限下限を守り、保存できなくても操作できる', () => {
    localStorage.setItem(
      LAYOUT_SIZES_KEY,
      JSON.stringify({
        'modeling.column.left': 'wide',
        'modeling.column.right': 9999,
        'modeling.panel.modeling.L': -10,
        'future.column.left': 300,
      }),
    );
    setup();
    expect(saved()).toEqual({ 'modeling.column.right': 560, 'modeling.panel.modeling.L': 60 });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('保存不可');
    });
    dragStart('「左」の高さ', 'y', 30);
    dragEnd();
    expect(panelBody('modeling.L').style.height).toBe('90px');
    fireEvent.doubleClick(separator('「左」の高さ'));
    expect(panelBody('modeling.L').style.height).toBe('');
  });

  it('アニメーション内の境目を保存し、狭い画面ではスライダーの高さを別に覚える', () => {
    registerCenter('animation', AnimationCenter);
    const { services } = setup();
    act(() => services.editor.set({ mode: 'animation' }));
    dragStart('タイムラインの高さ', 'y', -30);
    dragEnd();
    fireEvent.keyDown(separator('スライダーの幅'), { key: 'ArrowLeft' });
    expect(saved()).toMatchObject({ 'animation.timeline.height': 270, 'animation.sliders.width': 276 });
    const rect = vi.spyOn(document.querySelector<HTMLElement>('.anim-center')!, 'getBoundingClientRect');
    rect.mockReturnValue(new DOMRect(0, 0, 400, 560));
    fireEvent(window, new Event('resize'));
    expect(separator('スライダーの高さ').getAttribute('aria-orientation')).toBe('horizontal');
    fireEvent.keyDown(separator('スライダーの高さ'), { key: 'ArrowUp' });
    expect(saved()['animation.sliders.height']).toBeGreaterThan(80);
    expect(saved()['animation.sliders.width']).toBe(276);
    fireEvent.doubleClick(separator('タイムラインの高さ'));
    expect(saved()['animation.timeline.height']).toBeUndefined();
  });
});
