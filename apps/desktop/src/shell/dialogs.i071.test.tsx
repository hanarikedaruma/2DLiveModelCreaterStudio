import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RECOVERY_CHOICES } from '../project/actions';
import { createDialogController, DialogHost } from './dialogs';

describe('復元の選択ダイアログ（I-071）', () => {
  it.each(RECOVERY_CHOICES)('「$label」は$valueを返す', async (choice) => {
    const controller = createDialogController();
    render(<DialogHost controller={controller} />);
    let result!: Promise<'restore' | 'later' | 'discard' | null>;
    act(() => {
      result = controller.choose('前回の作業', RECOVERY_CHOICES);
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '復元する' }));
    fireEvent.click(screen.getByRole('button', { name: choice.label }));
    await expect(result).resolves.toBe(choice.value);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Escは未選択で閉じ、Tabは3択の中に保ち、Enterを復元へ強制しない', async () => {
    const controller = createDialogController();
    render(<DialogHost controller={controller} />);
    let result!: Promise<string | null>;
    act(() => {
      result = controller.choose('前回の作業', RECOVERY_CHOICES);
    });
    const restore = screen.getByRole('button', { name: '復元する' });
    const later = screen.getByRole('button', { name: '後で決める' });
    const discard = screen.getByRole('button', { name: '自動保存を破棄' });
    fireEvent.keyDown(restore, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(discard);
    fireEvent.keyDown(discard, { key: 'Tab' });
    expect(document.activeElement).toBe(restore);
    later.focus();
    fireEvent.keyDown(later, { key: 'Enter' });
    expect(controller.getState().requests).toHaveLength(1); // jsdomはEnterの標準clickを出さない
    fireEvent.click(later);
    await expect(result).resolves.toBe('later');
    act(() => {
      result = controller.choose('前回の作業', RECOVERY_CHOICES);
    });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await expect(result).resolves.toBeNull();
  });

  it('選択肢以外の値は受け付けず、既存の確認・入力のキューも順に処理する', async () => {
    const controller = createDialogController();
    render(<DialogHost controller={controller} />);
    let selection!: Promise<string | null>, confirm!: Promise<boolean>, prompt!: Promise<string | null>;
    act(() => {
      selection = controller.choose('選ぶ', RECOVERY_CHOICES);
      confirm = controller.confirm('続ける？');
      prompt = controller.prompt('名前', '初期値');
    });
    act(() => controller.answer(controller.getState().requests[0]!.id, 'unknown'));
    expect(controller.getState().requests).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '復元する' }));
    await expect(selection).resolves.toBe('restore');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await expect(confirm).resolves.toBe(true);
    const input = screen.getByDisplayValue('初期値');
    fireEvent.change(input, { target: { value: '新しい名前' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await expect(prompt).resolves.toBe('新しい名前');
    await expect(controller.choose('選択肢なし', [])).resolves.toBeNull();
    expect(controller.getState().requests).toHaveLength(0);
  });
});
