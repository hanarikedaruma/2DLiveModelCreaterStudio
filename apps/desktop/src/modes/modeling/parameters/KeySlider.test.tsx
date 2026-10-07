import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KeySlider, type KeyActions, type KeySliderProps } from './KeySlider';
import type { KeyMark } from './marks';

const marks: KeyMark[] = [
  { value: -30, kind: 'locked' },
  { value: -10, kind: 'generated' },
  { value: 0, kind: 'key' },
  { value: 10, kind: 'generated' },
  { value: 20, kind: 'generated' },
  { value: 30, kind: 'key' },
];

function setup(patch: Partial<KeySliderProps> = {}) {
  const onChange = vi.fn();
  const keyActions: KeyActions = {
    toggleLock: vi.fn(),
    deleteKey: vi.fn(),
    moveKey: vi.fn(),
    lockRange: vi.fn(),
    regenerateRange: vi.fn(),
  };
  const props: KeySliderProps = {
    label: '顔 左右',
    min: -30,
    max: 30,
    value: 0,
    defaultValue: 0,
    marks,
    showMarks: true,
    format: (v) => String(Math.round(v)),
    onChange,
    keyActions,
    ...patch,
  };
  const utils = render(<KeySlider {...props} />);
  const root = utils.container.querySelector<HTMLElement>('.key-slider-track')!;
  // 幅 214px（印の並ぶ幅は左右 7px を除いた 200px）。x = 7 + (値 + 30) / 60 × 200
  root.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 214,
    height: 30,
    right: 214,
    bottom: 30,
    x: 0,
    y: 0,
    toJSON() {},
  });
  const rerender = (next: Partial<KeySliderProps>) => utils.rerender(<KeySlider {...props} {...next} />);
  return { onChange, keyActions, root, rerender };
}

const xOf = (value: number) => 7 + ((value + 30) / 60) * 200;
const mark = (value: number) => document.querySelector<HTMLElement>(`[data-value="${value}"]`)!;

function shiftDrag(root: HTMLElement, from: number, to: number) {
  fireEvent.pointerDown(root, { button: 0, shiftKey: true, clientX: xOf(from), pointerId: 7 });
  fireEvent.pointerMove(root, { button: 0, shiftKey: true, clientX: xOf(to), pointerId: 7 });
  fireEvent.pointerUp(root, { button: 0, shiftKey: true, clientX: xOf(to), pointerId: 7 });
}

describe('KeySlider の印', () => {
  it('印を押すとその値へ移動する（吸い付きを通さない）', () => {
    const { onChange } = setup();
    fireEvent.click(mark(-10));
    expect(onChange).toHaveBeenCalledWith(-10);
    expect(mark(-10).getAttribute('aria-label')).toBe('生成したキー: -10');
  });

  it('右クリックでキーの操作のメニューを出し、ロック・消す・動かすをそれぞれ頼む（STEP3 のカード63）', () => {
    const { keyActions } = setup();
    const menu = () => screen.getByRole('group', { name: 'キー 20 の操作' });
    expect(fireEvent.contextMenu(mark(20))).toBe(false);
    expect(keyActions.toggleLock).not.toHaveBeenCalled();
    fireEvent.click(within(menu()).getByRole('button', { name: 'ロックする' }));
    expect(keyActions.toggleLock).toHaveBeenCalledWith(20);
    expect(screen.queryByRole('group', { name: 'キー 20 の操作' })).toBeNull();
    fireEvent.contextMenu(mark(20));
    fireEvent.click(within(menu()).getByRole('button', { name: 'このキーを消す' }));
    expect(keyActions.deleteKey).toHaveBeenCalledWith(20);
    fireEvent.contextMenu(mark(20));
    fireEvent.click(within(menu()).getByRole('button', { name: '別の値へ動かす…' }));
    expect(keyActions.moveKey).toHaveBeenCalledWith(20);
    fireEvent.contextMenu(mark(20));
    fireEvent.click(within(menu()).getByRole('button', { name: 'キーの操作を閉じる' }));
    expect(screen.queryByRole('group', { name: 'キー 20 の操作' })).toBeNull();
  });

  it('ロックしたキーのメニューは「ロックを解除」', () => {
    setup({ marks: [{ value: 20, kind: 'locked' }] });
    fireEvent.contextMenu(mark(20));
    expect(
      within(screen.getByRole('group', { name: 'キー 20 の操作' })).getByRole('button', { name: 'ロックを解除' }),
    ).toBeTruthy();
  });

  it('開いたメニューの最初のボタンにフォーカスが移り、Esc で閉じる', () => {
    setup();
    fireEvent.contextMenu(mark(20));
    const menu = screen.getByRole('group', { name: 'キー 20 の操作' });
    expect(document.activeElement).toBe(within(menu).getByRole('button', { name: 'ロックする' }));
    // 別の印を右クリックすると、そのキーのメニューへフォーカスが移る
    fireEvent.contextMenu(mark(-30));
    expect(document.activeElement).toBe(
      within(screen.getByRole('group', { name: 'キー -30 の操作' })).getByRole('button', { name: 'ロックを解除' }),
    );
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: /の操作$/ })).toBeNull();
  });

  it('操作が無ければ右クリックは何もしない', () => {
    setup({ keyActions: undefined });
    expect(fireEvent.contextMenu(mark(20))).toBe(true);
  });
});

describe('KeySlider の範囲の選択', () => {
  it('Shift＋ドラッグで範囲を選び、範囲のキーの操作を出す', () => {
    const { root, keyActions, onChange } = setup();
    expect(screen.queryByRole('group', { name: '選択範囲のキー' })).toBeNull();

    fireEvent.pointerDown(root, { button: 0, shiftKey: true, clientX: xOf(25), pointerId: 7 });
    fireEvent.pointerMove(root, { button: 0, shiftKey: true, clientX: xOf(5), pointerId: 7 });
    // ドラッグ中は範囲だけを出す
    expect(screen.getByTestId('key-selection')).toBeTruthy();
    expect(screen.queryByRole('group', { name: '選択範囲のキー' })).toBeNull();
    fireEvent.pointerUp(root, { button: 0, shiftKey: true, clientX: xOf(5), pointerId: 7 });

    const group = screen.getByRole('group', { name: '選択範囲のキー' });
    expect(group.textContent).toContain('選択範囲: 5 〜 25（キー 2 個）');
    expect([...document.querySelectorAll('.key-mark.in-selection')].map((m) => m.getAttribute('data-value'))).toEqual([
      '10',
      '20',
    ]);
    // スライダーの値は変えない
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '選択範囲をロック' }));
    expect(keyActions.lockRange).toHaveBeenLastCalledWith([expect.closeTo(5, 9), expect.closeTo(25, 9)], true);
    fireEvent.click(screen.getByRole('button', { name: '選択範囲をロック解除' }));
    expect(keyActions.lockRange).toHaveBeenLastCalledWith([expect.closeTo(5, 9), expect.closeTo(25, 9)], false);
    fireEvent.click(screen.getByRole('button', { name: '選択範囲だけ再補間' }));
    expect(keyActions.regenerateRange).toHaveBeenCalledWith([expect.closeTo(5, 9), expect.closeTo(25, 9)]);

    fireEvent.click(screen.getByRole('button', { name: '選択を解除' }));
    expect(screen.queryByTestId('key-selection')).toBeNull();
  });

  it('範囲は min..max に収める。動かさずに離すと選択を解除する', () => {
    const { root } = setup();
    fireEvent.pointerDown(root, { button: 0, shiftKey: true, clientX: xOf(10), pointerId: 1 });
    fireEvent.pointerUp(root, { button: 0, shiftKey: true, clientX: -500, pointerId: 1 });
    expect(screen.getByRole('group', { name: '選択範囲のキー' }).textContent).toContain(
      '選択範囲: -30 〜 10（キー 4 個）',
    );

    fireEvent.pointerDown(root, { button: 0, shiftKey: true, clientX: xOf(0), pointerId: 2 });
    fireEvent.pointerUp(root, { button: 0, shiftKey: true, clientX: xOf(0) + 1, pointerId: 2 });
    expect(screen.queryByTestId('key-selection')).toBeNull();
  });

  it('Shift なしのドラッグや、編集中でない行・操作の無い行では選ばない', () => {
    const plain = setup();
    fireEvent.pointerDown(plain.root, { button: 0, clientX: xOf(0), pointerId: 1 });
    fireEvent.pointerMove(plain.root, { button: 0, clientX: xOf(20), pointerId: 1 });
    fireEvent.pointerUp(plain.root, { button: 0, clientX: xOf(20), pointerId: 1 });
    expect(screen.queryByTestId('key-selection')).toBeNull();

    plain.rerender({ keyActions: undefined });
    shiftDrag(plain.root, 0, 20);
    expect(screen.queryByTestId('key-selection')).toBeNull();
  });

  it('編集をやめると選択も消える', () => {
    const { root, rerender } = setup();
    shiftDrag(root, 0, 20);
    expect(screen.getByTestId('key-selection')).toBeTruthy();
    rerender({ showMarks: false });
    expect(screen.queryByTestId('key-selection')).toBeNull();
    rerender({ showMarks: true });
    expect(screen.queryByTestId('key-selection')).toBeNull();
    expect(screen.queryByRole('group', { name: '選択範囲のキー' })).toBeNull();
  });

  it('Shift を押しながら印を押しても移動しない（範囲の選択に使う）', () => {
    const { onChange } = setup();
    fireEvent.click(mark(10), { shiftKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });
});
