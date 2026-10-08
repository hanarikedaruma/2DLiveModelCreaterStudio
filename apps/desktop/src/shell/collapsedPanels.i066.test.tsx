import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Renderer, Services } from '@app/contracts';
import { createFakeServices } from '../services';
import { registerCanvasTool, registerPanel } from './api';
import { createCanvasController } from './canvas/controller';
import { createEnvironmentStore, memoryEnvironmentStorage } from './environment';
import { registry } from './registry';
import { Shell } from './Shell';

const KEY = 'live2d-studio.collapsedPanels';
const Body = () => <p>中身</p>;

beforeEach(() => {
  localStorage.clear();
  registry.reset();
  registerCanvasTool({ id: 'select', label: '選択' });
  registerCanvasTool({ id: 'brush', label: 'ブラシ' });
  for (const [id, area] of [
    ['L', 'left'],
    ['R', 'right'],
    ['B', 'bottom'],
  ] as const)
    registerPanel({ id, area, mode: 'modeling', title: id, component: Body });
  registerPanel({ id: 'A', area: 'left', mode: 'animation', title: 'A', component: Body });
  registerPanel({ id: 'C', area: 'right', mode: 'animation', title: 'C', component: Body });
  registerPanel({
    id: 'tool',
    area: 'right',
    mode: 'modeling',
    title: 'ブラシの設定',
    component: Body,
    object: { kind: 'tool', when: ({ activeToolId }) => activeToolId === 'brush' },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  registry.reset();
  localStorage.clear();
});

function setup() {
  const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };
  const services: Services = { ...createFakeServices(), createRenderer: () => renderer };
  const canvas = createCanvasController();
  const view = render(
    <Shell services={services} canvas={canvas} environment={createEnvironmentStore(memoryEnvironmentStorage(null))} />,
  );
  return { services, canvas, view };
}
const panel = (id: string) => document.querySelector<HTMLElement>(`[data-panel-id="${id}"]`)!;
const closed = (id: string) => panel(id).querySelector('.panel-toggle')!.getAttribute('aria-expanded') === 'false';
const toggle = (id: string) => fireEvent.click(panel(id).querySelector<HTMLButtonElement>('.panel-toggle')!);
const saved = () => (JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]).sort();

describe('I-066: 列をまたぐパネルのたたみの保存', () => {
  it('左→右→下とたたんでも前の列を残し、再起動後にすべて復元する。開くとその対象だけ外す', () => {
    const { view } = setup();
    toggle('L');
    expect(saved()).toEqual(['L']);
    toggle('R');
    expect(saved()).toEqual(['L', 'R']);
    toggle('B');
    expect(saved()).toEqual(['B', 'L', 'R']);
    expect(['L', 'R', 'B'].every(closed)).toBe(true);
    view.unmount();
    setup();
    expect(['L', 'R', 'B'].every(closed)).toBe(true);
    toggle('R');
    expect(saved()).toEqual(['B', 'L']);
    expect(closed('R')).toBe(false);
    expect(closed('L') && closed('B')).toBe(true);
  });

  it('別モードと今は非表示のパレットの記録も残す', () => {
    const { services, canvas } = setup();
    act(() => canvas.setActiveTool('brush'));
    toggle('tool');
    toggle('L');
    act(() => canvas.setActiveTool('select'));
    expect(document.querySelector('[data-panel-id="tool"]')).toBeNull();
    act(() => services.editor.set({ mode: 'animation' }));
    toggle('A');
    toggle('C');
    expect(saved()).toEqual(['A', 'C', 'L', 'tool']);
    act(() => services.editor.set({ mode: 'modeling' }));
    expect(closed('L')).toBe(true);
    toggle('R');
    act(() => canvas.setActiveTool('brush'));
    expect(closed('tool')).toBe(true);
    expect(saved()).toEqual(['A', 'C', 'L', 'R', 'tool']);
  });

  it('保存済みの別の列や非表示パネルを保ち、既存形式をそのまま読み込む', () => {
    localStorage.setItem(KEY, JSON.stringify(['L', 'B', 'hidden']));
    setup();
    expect(closed('L') && closed('B')).toBe(true);
    toggle('R');
    toggle('L');
    expect(saved()).toEqual(['B', 'R', 'hidden']);
    expect(closed('B') && closed('R')).toBe(true);
  });

  it('保存が拒まれても全列で開閉でき、現在の状態を保つ', () => {
    const { view } = setup();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('保存できない');
    });
    toggle('L');
    toggle('R');
    toggle('B');
    toggle('R');
    expect(closed('L') && closed('B')).toBe(true);
    expect(closed('R')).toBe(false);
    expect(saved()).toEqual([]);
    view.unmount();
  });
});
