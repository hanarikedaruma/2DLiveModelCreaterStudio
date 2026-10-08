// 流れ線のパレットの出し方と、髪の選び方（モデリングのツールとパレットの整理。docs/modeling-palette-design.md）。
// 流れ線（カード99・CO）のパネルの中身とツールの押したときの処理は変えず、出す条件・ⓘ・対象を選ぶ段だけを確かめる
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBindingEvaluator, createDeformPipeline } from '@app/core';
import { registry } from '../../../shell/registry';
import { register as registerCanvasEdit } from '../canvas';
import { pointer, renderShell, stubSize } from '../canvas/testUtils';
import { CURVE_PICK_PROMPT, register } from './index';
import { hairProject } from './testing';

const HAIR = { x: 300, y: 300 }; // 長い髪（290..310 × 200..400）の真ん中
const EMPTY = { x: 100, y: 100 };

let restoreSize: () => void = () => {};
beforeEach(() => {
  registry.reset();
  registerCanvasEdit();
  register();
  restoreSize = stubSize(800, 600);
});
afterEach(() => restoreSize());

async function open() {
  const shell = renderShell(() => ({ pipeline: createDeformPipeline(), evaluator: createBindingEvaluator() }));
  act(() => shell.services.store.load(hairProject()));
  await waitFor(() => expect(shell.canvas.lastDeformed()?.items.length).toBe(1));
  const panelEl = () => document.querySelector<HTMLElement>('[data-panel-id="curveGuide"]');
  const selected = () => shell.services.editor.get().selectedPartIds;
  return { ...shell, panelEl, selected, ptr: pointer(shell.canvas) };
}

describe('流れ線のパレット', () => {
  it('線で曲げるツールのときだけ、色付きのツールのパレットとして右の列の上に出る。ⓘ で目的と流れを出す', async () => {
    const shell = await open();
    act(() => shell.services.editor.set({ selectedPartIds: ['hair'] }));
    expect(shell.panelEl()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '線で曲げる' }));
    const el = shell.panelEl()!;
    expect(el.classList.contains('object')).toBe(true);
    expect(el.getAttribute('data-object')).toBe('tool');
    expect(el.parentElement!.firstElementChild).toBe(el);
    expect(within(el).getByRole('button', { name: '流れ線を描く' })).toBeTruthy();
    fireEvent.click(within(el).getByRole('button', { name: '「流れ線」の説明' }));
    const note = screen.getByRole('note', { name: '「流れ線」の説明' });
    expect(note.textContent).toMatch(/一本の線で滑らかに曲げる/);
    expect(within(note).getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: '選択・変形' }));
    expect(shell.panelEl()).toBeNull();
  });

  it('髪を選ばずにツールにすると、キャンバスで押した髪を選ぶ（何も無い所では選ばない）。右クリックで外せる', async () => {
    const shell = await open();
    fireEvent.click(screen.getByRole('button', { name: '線で曲げる' }));
    expect(CURVE_PICK_PROMPT).toMatch(/クリックして選ぶ/);
    shell.ptr.click(EMPTY);
    expect(shell.selected()).toEqual([]);
    expect(screen.queryByText(/メッシュのある、ロックされていない画像パーツを選んでください/)).toBeNull();
    shell.ptr.click(HAIR);
    expect(shell.selected()).toEqual(['hair']);
    expect(within(shell.panelEl()!).getByText('長い髪')).toBeTruthy();
    // 選んだ後の押す操作は流れ線のツールが受け取る（線を描くので、別のパーツへは切り替えない）
    expect(shell.services.store.get().model.curveGuides ?? []).toEqual([]);
    shell.ptr.rightClick(HAIR);
    expect(shell.selected()).toEqual([]);
  });
});
