import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Renderer, Services } from '@app/contracts';
import { createFakeServices } from '../services';
import { DetailDisclosure, registerPanel } from './api';
import { createEnvironmentStore, memoryEnvironmentStorage } from './environment';
import { registry } from './registry';
import { Shell } from './Shell';

afterEach(() => {
  registry.reset();
});

function setup(label?: string) {
  registerPanel({
    id: 't.detail',
    mode: 'modeling',
    area: 'right',
    title: '設定',
    component: () => (
      <div>
        <p>いつもの項目</p>
        <DetailDisclosure label={label}>
          <p>細かい項目</p>
        </DetailDisclosure>
      </div>
    ),
  });
  // jsdom には 2D コンテキストが無いので、何も描かない描画にする
  const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };
  const services: Services = { ...createFakeServices(), createRenderer: () => renderer };
  const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
  render(<Shell services={services} environment={environment} />);
  return { services };
}

describe('DetailDisclosure', () => {
  it('かんたんでは閉じていて、押すとその項目だけ開き、もう一度押すと閉じる', () => {
    setup();
    expect(screen.getByText('いつもの項目')).toBeTruthy();
    expect(screen.queryByText('細かい項目')).toBeNull();
    const toggle = document.querySelector<HTMLButtonElement>('.detail-disclosure-toggle')!;
    expect(toggle.textContent).toContain('詳細');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByText('細かい項目')).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(screen.queryByText('細かい項目')).toBeNull();
  });

  it('ボタンの名前を変えられる', () => {
    setup('スムージングの数値');
    expect(screen.getByRole('button', { name: /スムージングの数値/ })).toBeTruthy();
  });

  it('詳細モードでは中身をそのまま出し、開くボタンは出さない', () => {
    const { services } = setup();
    act(() => services.editor.set({ uiLevel: { ...services.editor.get().uiLevel, modeling: 'detail' } }));
    expect(screen.getByText('細かい項目')).toBeTruthy();
    expect(document.querySelector('.detail-disclosure')).toBeNull();
  });
});
