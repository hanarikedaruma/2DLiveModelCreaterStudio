import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Renderer, Services } from '@app/contracts';
import { createFakeServices } from '../../services';
import { registerCanvasTool } from '../api';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../environment';
import { registry } from '../registry';
import { Shell } from '../Shell';
import { createCanvasController } from './controller';

afterEach(() => {
  registry.reset();
});

function setup() {
  registerCanvasTool({ id: 't.select', label: '選択' });
  registerCanvasTool({ id: 't.warp', label: 'ワープ', level: 'detail' });
  registerCanvasTool({ id: 't.easy', label: 'かんたんだけ', level: 'easy' });
  // jsdom には 2D コンテキストが無いので、何も描かない描画にする
  const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };
  const services: Services = { ...createFakeServices(), createRenderer: () => renderer };
  const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
  const canvas = createCanvasController();
  render(<Shell services={services} environment={environment} canvas={canvas} />);
  const setLevel = (level: 'easy' | 'detail') =>
    act(() => services.editor.set({ uiLevel: { ...services.editor.get().uiLevel, modeling: level } }));
  const toolNames = () =>
    within(screen.getByRole('toolbar', { name: 'キャンバスのツール' }))
      .queryAllByRole('button')
      .map((b) => b.textContent)
      .filter((t) => t === '選択' || t === 'ワープ' || t === 'かんたんだけ');
  return { canvas, setLevel, toolNames };
}

describe('キャンバスのツールのかんたん/詳細（I-008）', () => {
  it('level に合わせてツールのボタンを出し分ける（省略は両方）', () => {
    const { setLevel, toolNames } = setup();
    expect(toolNames()).toEqual(['選択', 'かんたんだけ']);
    setLevel('detail');
    expect(toolNames()).toEqual(['選択', 'ワープ']);
  });

  it('使っているツールが出ないほうへ切り替えたら、既定のツールに戻す', () => {
    const { canvas, setLevel } = setup();
    setLevel('detail');
    fireEvent.click(screen.getByRole('button', { name: 'ワープ' }));
    expect(canvas.getState().activeToolId).toBe('t.warp');
    setLevel('easy');
    expect(canvas.getState().activeToolId).toBe('t.select');
    expect(screen.queryByRole('button', { name: 'ワープ' })).toBeNull();
  });
});
