import { act, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Binding, TransformDelta } from '@app/schema';
import { createBindingEvaluator } from '@app/core';
import { registry } from '../../../shell/registry';
import { register } from './index';
import { formatNumber, PARAM_EDIT_NOTE, PREVIEW_OFF_BASE_NOTE } from './TransformPanel';
import { openSample, renderShell, stubSize } from './testUtils';

let restoreSize: () => void = () => {};
beforeEach(() => {
  registry.reset();
  register();
  restoreSize = stubSize(800, 600);
});
afterEach(() => restoreSize());

const delta = (x: number, y: number, rotation: number, scaleX: number): TransformDelta => ({
  position: { x, y },
  rotation,
  scale: { x: scaleX, y: 1 },
  opacity: 1,
});

// 顔 傾き 30 で、胴体を (+10, −20) 動かし、5° 回し、横に 1.2 倍にするキー
const torsoKey: Binding = {
  id: 'b-i070-torso',
  target: { type: 'part', id: 'part-torso' },
  channel: 'transform',
  parameterIds: ['FaceAngleZ'],
  keyValues: [[0, 30]],
  keys: [
    { coords: [0], delta: delta(0, 0, 0, 1), source: 'manual', locked: false },
    { coords: [30], delta: delta(10, -20, 5, 1.2), source: 'manual', locked: false },
  ],
  generation: 'linear',
  divisions: null,
};

describe('I-070: Transform パネルの数値は今の形', () => {
  it('パラメータの編集中・プレビュー中は、今の形の値（基準 + キーの差分）を読み取り専用で出す', async () => {
    // キーの差分を求めるので、本物の evaluator にする
    const shell = renderShell(() => ({ evaluator: createBindingEvaluator() }));
    await openSample(shell);
    const { store, editor } = shell.services;
    act(() =>
      store.dispatch({
        label: 'キー',
        apply: (p) => ({ ...p, model: { ...p.model, bindings: [...p.model.bindings, torsoKey] } }),
      }),
    );
    act(() => editor.set({ selectedPartIds: ['part-torso'] }));
    const panel = () => within(document.querySelector<HTMLElement>('[data-panel-id="transform"]')!);
    const value = (label: string) => (panel().getByLabelText(label) as HTMLInputElement).value;
    const base = store.get().model.parts.find((p) => p.id === 'part-torso')!;
    expect(value('X')).toBe(formatNumber(base.position.x, 2));

    act(() => editor.set({ activeParameterIds: ['FaceAngleZ'], editorParamValues: { FaceAngleZ: 30 } }));
    expect(panel().getByText(PARAM_EDIT_NOTE)).toBeTruthy();
    expect((panel().getByLabelText('X') as HTMLInputElement).readOnly).toBe(true);
    expect(value('X')).toBe(formatNumber(base.position.x + 10, 2));
    expect(value('Y')).toBe(formatNumber(base.position.y - 20, 2));
    expect(value('Rotation')).toBe(formatNumber(base.rotation + 5, 2));
    expect(value('Scale X')).toBe(formatNumber(base.scale.x * 1.2, 3));
    expect(value('Scale Y')).toBe(formatNumber(base.scale.y, 3));
    expect(value('回転中心 X')).toBe(formatNumber(base.pivot.x, 2)); // 回転中心はキーで変わらない
    expect(value('Opacity')).toBe(formatNumber(base.opacity, 2));

    // キーの間の値では、補間した今の形
    act(() => editor.set({ editorParamValues: { FaceAngleZ: 15 } }));
    expect(value('X')).toBe(formatNumber(base.position.x + 5, 2));
    expect(value('Rotation')).toBe(formatNumber(base.rotation + 2.5, 2));

    // 編集していないパラメータの値だけがデフォルト値でない（プレビュー中）ときも今の形
    act(() => editor.set({ activeParameterIds: [], editorParamValues: { FaceAngleZ: 30 } }));
    expect(panel().getByText(PREVIEW_OFF_BASE_NOTE)).toBeTruthy();
    expect(value('Y')).toBe(formatNumber(base.position.y - 20, 2));

    // 基準に戻すと、基準の値を編集できる
    act(() => editor.set({ editorParamValues: {} }));
    expect(value('X')).toBe(formatNumber(base.position.x, 2));
    expect((panel().getByLabelText('X') as HTMLInputElement).readOnly).toBe(false);
  });
});
