import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeServices } from '../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../shell/environment';
import { registry } from '../shell/registry';
import { Shell } from '../shell/Shell';
import { register as registerParameters } from '../modes/modeling/parameters';
import { InfoButton, InfoContent } from './InfoButton';

afterEach(() => {
  registry.reset();
  localStorage.clear();
});

describe('項目の ⓘ（I-086）', () => {
  it('外部の文を開閉し、Escで閉じて説明ボタンへフォーカスを戻す', () => {
    render(
      <InfoButton infoId="parameters.generateBetween">
        <button type="button" disabled>
          間を生成
        </button>
      </InfoButton>,
    );
    const info = screen.getByRole('button', { name: '「間を生成」の説明' });
    fireEvent.click(info);
    const note = screen.getByRole('note', { name: '「間を生成」の説明' });
    expect(info.getAttribute('aria-controls')).toBe(note.id);
    expect(note.textContent).toContain('線形なら、作る前後で見た目は変わらない');
    expect(within(note).getAllByRole('listitem').length).toBeGreaterThan(0);
    fireEvent.keyDown(note, { key: 'Escape' });
    expect(screen.queryByRole('note')).toBeNull();
    expect(document.activeElement).toBe(info);
    fireEvent.click(info);
    fireEvent.click(info);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('不足したIDは案内を出し、HTMLを含む文はコードとして実行しない', () => {
    const { unmount } = render(<InfoButton infoId="missing" title="見つからない説明" />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('note').textContent).toContain('説明を読み込めませんでした');
    unmount();
    const { container } = render(
      <InfoContent info={{ purpose: '<img src=x onerror=alert(1)>', uses: [], steps: [] }} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('実際のパラメータパネルで、説明を開いても作品・編集値・履歴を変えない', async () => {
    registry.reset();
    registerParameters();
    const services = createFakeServices();
    services.createRenderer = () => ({ init() {}, setTextures() {}, render() {}, dispose() {} });
    await act(async () =>
      render(<Shell services={services} environment={createEnvironmentStore(memoryEnvironmentStorage())} />),
    );
    const before = services.store.get();
    const editor = services.editor.get();
    fireEvent.click(screen.getByRole('button', { name: '「パラメータ」の説明' }));
    expect(screen.getByRole('note', { name: '「パラメータ」の説明' }).textContent).toContain('Ctrl＋クリック');
    fireEvent.click(screen.getByRole('button', { name: '「間を生成」の説明' }));
    expect(screen.getByRole('note', { name: '「間を生成」の説明' })).toBeTruthy();
    expect(services.store.get()).toBe(before);
    expect(services.editor.get()).toBe(editor);
    expect(services.store.canUndo()).toBe(false);
    act(() => services.editor.set({ activeParameterIds: ['FaceAngleX'] }));
    for (const title of ['すべて再補間', '奥行きで作り直す', '生成方式']) {
      fireEvent.click(screen.getByRole('button', { name: `「${title}」の説明` }));
      expect(screen.getByRole('note', { name: `「${title}」の説明` })).toBeTruthy();
    }
    expect(services.store.get()).toBe(before);
    expect(services.store.canUndo()).toBe(false);
  });
});
