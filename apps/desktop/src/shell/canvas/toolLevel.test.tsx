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
  registerCanvasTool({ id: 't.warp', label: 'ワープ' });
  registerCanvasTool({ id: 't.brush', label: 'ブラシ' });
  // jsdom には 2D コンテキストが無いので、何も描かない描画にする
  const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };
  const services: Services = { ...createFakeServices(), createRenderer: () => renderer };
  const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
  const canvas = createCanvasController();
  render(<Shell services={services} environment={environment} canvas={canvas} />);

  const toolNames = () =>
    within(screen.getByRole('toolbar', { name: 'キャンバスのツール' }))
      .queryAllByRole('button')
      .map((b) => b.textContent)
      .filter((t) => t === '選択' || t === 'ワープ' || t === 'ブラシ');
  return { canvas, toolNames };
}

describe('I-088 キャンバスのツール', () => {
  it('すべてのツールのボタンを最初から表示する', () => {
    const { toolNames } = setup();
    expect(toolNames()).toEqual(['選択', 'ワープ', 'ブラシ']);
  });

  it('ワープを直接選べ、編集対象の変更でツールを戻さない', () => {
    const { canvas } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'ワープ' }));
    expect(canvas.getState().activeToolId).toBe('t.warp');

    act(() => canvas.setView({ scale: 2, offset: { x: 10, y: 20 } }));
    expect(canvas.getState().activeToolId).toBe('t.warp');
    expect(screen.getByRole('button', { name: 'ワープ' })).toBeTruthy();
  });
});
