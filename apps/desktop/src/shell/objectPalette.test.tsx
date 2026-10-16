// 共通パレットとオブジェクトパレット・見出しの ⓘ（CC-012。docs/modeling-palette-design.md）。
// 架空のパネルで、出す条件・並び（ツール → パーツ → 共通）・かんたん/詳細・ⓘ の開閉を確かめる
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Renderer, Services } from '@app/contracts';
import { createFakeServices } from '../services';
import { registerCanvasTool, registerPanel } from './api';
import { createCanvasController } from './canvas/controller';
import { createEnvironmentStore, memoryEnvironmentStorage } from './environment';
import { registry } from './registry';
import { Shell } from './Shell';

const COLLAPSED_KEY = 'live2d-studio.collapsedPanels';
const Body = () => <p>中身</p>;

beforeEach(() => {
  localStorage.clear();
  registry.reset();
  registerCanvasTool({ id: 't.select', label: '選択' });
  registerCanvasTool({ id: 't.brush', label: 'ブラシ' });
  registerPanel({ id: 'common', mode: 'modeling', area: 'right', title: '共通', order: 10, component: Body });
  registerPanel({
    id: 'part',
    mode: 'modeling',
    area: 'right',
    title: '目',
    order: 5,
    component: Body,
    object: { kind: 'part', when: ({ editor }) => editor.selectedPartIds.includes('eye') },
    info: { purpose: '目のための道具', steps: ['目を選ぶ', '線を引く'] },
  });
  registerPanel({
    id: 'tool',
    mode: 'modeling',
    area: 'right',
    title: 'ブラシ',
    order: 50,
    component: Body,
    object: { kind: 'tool', when: ({ activeToolId }) => activeToolId === 't.brush' },
  });
  registerPanel({
    id: 'detailTool',
    mode: 'modeling',
    area: 'right',
    title: '詳細のブラシ',
    order: 60,

    component: Body,
    object: { kind: 'tool', when: ({ activeToolId }) => activeToolId === 't.brush' },
  });
});
afterEach(() => {
  registry.reset();
  localStorage.clear();
});

function setup() {
  const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };
  const services: Services = { ...createFakeServices(), createRenderer: () => renderer };
  const canvas = createCanvasController();
  render(
    <Shell services={services} environment={createEnvironmentStore(memoryEnvironmentStorage(null))} canvas={canvas} />,
  );
  const titles = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-area="right"] > .panel')).map((p) =>
      p.querySelector('.panel-toggle')!.textContent!.slice(1),
    );
  return { services, canvas, titles };
}

describe('オブジェクトパレット', () => {
  it('条件に合うときだけ出し、ツール → パーツ → 共通の順に上から並べる（order より先）', () => {
    const { services, canvas, titles } = setup();
    expect(titles()).toEqual(['共通']);
    act(() => services.editor.set({ selectedPartIds: ['eye'] }));
    expect(titles()).toEqual(['目', '共通']);
    act(() => canvas.setActiveTool('t.brush'));
    // 旧「詳細」のパレットも条件に合えば最初から表示する
    expect(titles()).toEqual(['ブラシ', '詳細のブラシ', '目', '共通']);
    act(() => services.editor.set({ selectedPartIds: [] }));
    expect(titles()).toEqual(['ブラシ', '詳細のブラシ', '共通']);
    // 札と色の印
    const tool = document.querySelector<HTMLElement>('[data-panel-id="tool"]')!;
    expect(tool.className).toBe('panel object');
    expect(tool.getAttribute('data-object')).toBe('tool');
    expect(within(tool).getByText('ツール')).toBeTruthy();
    const common = document.querySelector<HTMLElement>('[data-panel-id="common"]')!;
    expect(common.className).toBe('panel');
    expect(common.getAttribute('data-object')).toBeNull();
  });

  it('たたんだ状態はパネルごとに覚え、次に出たときもたたんだまま', () => {
    const { services, titles } = setup();
    act(() => services.editor.set({ selectedPartIds: ['eye'] }));
    fireEvent.click(screen.getByRole('button', { name: '目' }));
    expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY)!)).toEqual(['part']);
    act(() => services.editor.set({ selectedPartIds: [] }));
    expect(titles()).toEqual(['共通']);
    act(() => services.editor.set({ selectedPartIds: ['eye'] }));
    expect(document.querySelector('[data-panel-id="part"]')!.classList.contains('collapsed')).toBe(true);
  });
});

describe('見出しの ⓘ', () => {
  it('説明のあるパレットにだけ出し、押すと目的と流れを出す。Esc・もう一度押すと閉じ、たたんでいても見られる', () => {
    const { services, canvas } = setup();
    act(() => services.editor.set({ selectedPartIds: ['eye'] }));
    act(() => canvas.setActiveTool('t.brush'));
    expect(screen.queryByRole('button', { name: '「ブラシ」の説明' })).toBeNull();
    expect(screen.queryByRole('button', { name: '「共通」の説明' })).toBeNull();
    const button = screen.getByRole('button', { name: '「目」の説明' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    const note = screen.getByRole('note', { name: '「目」の説明' });
    expect(button.getAttribute('aria-controls')).toBe(note.id);
    expect(note.textContent).toContain('目のための道具');
    expect(
      within(note)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['目を選ぶ', '線を引く']);
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.queryByRole('note', { name: '「目」の説明' })).toBeNull();
    // たたんでいても説明は開ける（見出しの下に出す）
    fireEvent.click(screen.getByRole('button', { name: '目' }));
    fireEvent.click(button);
    expect(screen.getByRole('note', { name: '「目」の説明' })).toBeTruthy();
    fireEvent.click(button);
    expect(screen.queryByRole('note', { name: '「目」の説明' })).toBeNull();
  });
});
