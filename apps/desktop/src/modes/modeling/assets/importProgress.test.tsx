// カード57の実装担当の回帰テスト。進捗を見ながら別の操作をし、取り消して素材を増やさない。
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeImporter } from '@app/contracts';
import { registry } from '../../../shell/registry';
import { register } from './index';
import { pngBytes, renderShell, testServices } from './testShell';

beforeEach(() => {
  registry.reset();
  register();
});
describe('取り込みの進捗画面（カード57）', () => {
  it('取り込み中もモードを切り替えられ、取り消すと素材を確定しない', async () => {
    const fake = new FakeImporter();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const services = testServices({
      importer: {
        async importFiles(files) {
          await waiting;
          return fake.importFiles(files);
        },
      },
    });
    renderShell(services);
    fireEvent.change(screen.getByLabelText('ファイルを選ぶ'), {
      target: { files: [new File([pngBytes(10, 10)], 'face.png')] },
    });
    await waitFor(() =>
      expect(screen.getByRole('status', { name: '素材の取り込み' }).textContent).toContain('face.png'),
    );
    fireEvent.click(screen.getByRole('tab', { name: 'アニメーション' }));
    expect(services.editor.get().mode).toBe('animation');
    fireEvent.click(screen.getByRole('tab', { name: 'モデリング' }));
    fireEvent.click(screen.getByRole('button', { name: '取り込みを取り消す' }));
    release();
    await waitFor(() => expect(screen.queryByRole('status', { name: '素材の取り込み' })).toBeNull());
    expect(services.store.get().assets).toEqual([]);
    expect(services.store.canUndo()).toBe(false);
    expect((screen.getByRole('button', { name: 'ファイルを選ぶ' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
