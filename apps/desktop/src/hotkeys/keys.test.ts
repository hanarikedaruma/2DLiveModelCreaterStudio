import { describe, expect, it } from 'vitest';
import {
  formatKeys,
  keyLabel,
  needsModifier,
  normalizeKeys,
  parseKeys,
  recordKeys,
  toAccelerator,
  type KeyLike,
} from './keys';

const key = (code: string, mods: Partial<KeyLike> = {}, k = ''): KeyLike => ({
  key: k,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe('キーの文字列', () => {
  it('設計書の例（Ctrl+Shift+1）を読み、global-shortcut の形にする', () => {
    const parsed = parseKeys('Ctrl+Shift+1');
    expect(parsed).toEqual({ modifiers: ['Ctrl', 'Shift'], code: 'Digit1' });
    expect(toAccelerator(parsed!)).toBe('Control+Shift+Digit1');
    expect(formatKeys(parsed!)).toBe('Ctrl+Shift+1');
  });

  it('修飾キーの順番・大文字小文字・別名を問わず同じ形にそろえる', () => {
    expect(normalizeKeys('shift+ctrl+a')).toBe('Ctrl+Shift+A');
    expect(normalizeKeys('CommandOrControl+Alt+KeyA')).toBe('Ctrl+Alt+A');
    expect(normalizeKeys('Super+F5')).toBe('Win+F5');
    expect(normalizeKeys('Ctrl+-')).toBe('Ctrl+Minus');
    expect(normalizeKeys('Alt+numpad1')).toBe('Alt+Num1');
    expect(normalizeKeys('Ctrl+Up')).toBe('Ctrl+Up');
    expect(toAccelerator(parseKeys('Win+Esc')!)).toBe('Super+Escape');
  });

  it('読めないものは null', () => {
    expect(parseKeys('')).toBeNull();
    expect(parseKeys('Ctrl+')).toBeNull();
    expect(parseKeys('Ctrl+Hyper+A')).toBeNull();
    expect(parseKeys('Ctrl+あ')).toBeNull();
    expect(parseKeys('Ctrl+A+B')).toBeNull();
  });

  it('画面に出す名前', () => {
    expect(keyLabel('KeyQ')).toBe('Q');
    expect(keyLabel('Digit0')).toBe('0');
    expect(keyLabel('NumpadAdd')).toBe('NumAdd');
    expect(keyLabel('ArrowLeft')).toBe('Left');
    expect(keyLabel('F12')).toBe('F12');
  });

  it('ふだんの入力に使うキーは Ctrl・Alt・Win と組み合わせる。F キー・テンキーは単独でもよい', () => {
    expect(needsModifier(parseKeys('A')!)).toBe(true);
    expect(needsModifier(parseKeys('Shift+A')!)).toBe(true);
    expect(needsModifier(parseKeys('Space')!)).toBe(true);
    expect(needsModifier(parseKeys('Ctrl+A')!)).toBe(false);
    expect(needsModifier(parseKeys('Alt+Shift+1')!)).toBe(false);
    expect(needsModifier(parseKeys('F9')!)).toBe(false);
    expect(needsModifier(parseKeys('Num5')!)).toBe(false);
  });
});

describe('キーを押して記録する', () => {
  it('修飾キーだけのあいだは途中の表示、キーを押すと決まる', () => {
    expect(recordKeys(key('ControlLeft', { ctrlKey: true }, 'Control'))).toEqual({ type: 'partial', text: 'Ctrl+…' });
    expect(recordKeys(key('ShiftLeft', { ctrlKey: true, shiftKey: true }, 'Shift'))).toEqual({
      type: 'partial',
      text: 'Ctrl+Shift+…',
    });
    const done = recordKeys(key('Digit1', { ctrlKey: true, shiftKey: true }, '!'));
    expect(done).toMatchObject({ type: 'done', keys: 'Ctrl+Shift+1' });
  });

  it('修飾キーを離しきると途中の表示は空', () => {
    expect(recordKeys(key('ShiftLeft', {}, 'Shift'))).toEqual({ type: 'partial', text: '' });
  });

  it('global-shortcut が受け付けないキーは unsupported', () => {
    expect(recordKeys(key('IntlYen', { ctrlKey: true }, '¥'))).toEqual({ type: 'unsupported', text: 'Ctrl+¥' });
    expect(recordKeys(key('CapsLock', {}, 'CapsLock'))).toEqual({ type: 'unsupported', text: 'CapsLock' });
  });
});
