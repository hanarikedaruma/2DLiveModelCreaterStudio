// カード30 パラメータパネルの方向グリッド（かんたん）と組み合わせの補正（詳細）。本物の KeyEditor と評価で確かめる
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TransformDelta } from '@app/schema';
import type { Services } from '@app/contracts';
import { createBindingEvaluator } from '@app/core';
import { createFakeServices } from '../../../services';
import { createKeyEditor } from '../../../services/keyEditor';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { register as registerParameters } from '../parameters';
import { DIRECTION_PAIR, pairBindings } from './grid';
import { register } from './index';
import { gridTestProject } from './testModel';

beforeEach(() => {
  registry.reset();
  registerParameters();
  register();
});

function setup() {
  const services: Services = {
    ...createFakeServices(),
    createRenderer: () => ({ init() {}, setTextures() {}, render() {}, dispose() {} }),
    keyEditor: createKeyEditor(),
    evaluator: createBindingEvaluator(),
  };
  const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
  render(<Shell services={services} environment={environment} />);
  act(() => services.store.load(gridTestProject()));
  return services;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// マスのボタン（名前は「左上（自動）」のように状態が付く）
const cell = (name: string) => screen.getByRole('button', { name: new RegExp(`^${escape(name)}（`) });
const directionGrid = () => screen.queryByRole('group', { name: '顔の向きのマス' });
const combinationGrid = () => screen.queryByRole('group', { name: '組み合わせのマス' });

// いまの編集中の状態での顔の差分（モデリング中のプレビューと同じ値で評価する）
function previewFace(s: Services): TransformDelta {
  return s.evaluator.evaluate(s.store.get().model, s.editor.get().editorParamValues).transforms.face!;
}

// キャンバスでパーツを動かしたのと同じ（KeyEditor のコマンドを入れる）
function moveFace(s: Services, dx: number, dy: number) {
  const command = s.keyEditor.transformEdit(s.store.get(), s.editor.get(), ['face'], { dPosition: { x: dx, y: dy } });
  if (command === 'needsKey') throw new Error('キーがあるはず');
  act(() => s.store.dispatch(command));
}

describe('方向グリッド（かんたん）', () => {
  it('補正キーのロックは選んだマスだけに作用し、1軸キーと他のマスを保つ（I-019）', () => {
    const s = setup();
    fireEvent.click(cell('右上'));
    expect(screen.getByRole('button', { name: '補正キーをロック' }).hasAttribute('disabled')).toBe(true);
    moveFace(s, 4, -2);
    fireEvent.click(cell('左上'));
    moveFace(s, -3, 1);
    fireEvent.click(cell('右上'));
    const original = s.store.get();
    fireEvent.click(screen.getByRole('button', { name: '補正キーのロックを解除' }));
    const b = pairBindings(s.store.get().model, DIRECTION_PAIR)[0]!;
    expect(b.keys.find((k) => k.coords.join() === '30,30')!.locked).toBe(false);
    expect(b.keys.find((k) => k.coords.join() === '-30,30')!.locked).toBe(true);
    expect(s.store.get().model.bindings.filter((binding) => binding.parameterIds.length === 1)).toEqual(
      original.model.bindings.filter((binding) => binding.parameterIds.length === 1),
    );
    expect(cell('右上').getAttribute('data-locked')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '補正キーをロック' }));
    expect(cell('右上').getAttribute('data-locked')).toBe('true');
    act(() => s.store.undo());
    act(() => s.store.undo());
    expect(s.store.get()).toBe(original);
  });
  it('同じパーツの2つ目の斜めも確認なしで編集でき、それぞれ1回で Undo/Redo（I-017）', () => {
    const s = setup();
    fireEvent.click(cell('右上'));
    moveFace(s, 4, -2);
    const first = s.store.get();
    fireEvent.click(cell('左上'));
    const sum = previewFace(s);
    moveFace(s, -3, 1);
    const second = s.store.get();
    expect(previewFace(s).position).toEqual({ x: sum.position.x - 3, y: sum.position.y + 1 });
    expect(cell('右上').getAttribute('aria-label')).toBe('右上（修正済み）');
    expect(cell('左上').getAttribute('aria-label')).toBe('左上（修正済み）');
    act(() => s.store.undo());
    expect(s.store.get()).toBe(first);
    expect(cell('左上').getAttribute('aria-label')).toBe('左上（自動）');
    act(() => s.store.redo());
    expect(s.store.get()).toBe(second);
  });

  it('自動生成された斜めの補正はマスと選択中の説明の両方で自動と表示（I-037）', () => {
    const s = setup();
    fireEvent.click(cell('右上'));
    moveFace(s, 4, -2);
    const p = s.store.get();
    act(() =>
      s.store.load({
        ...p,
        model: {
          ...p.model,
          bindings: p.model.bindings.map((b) =>
            b.parameterIds.length === 2 ? { ...b, keys: b.keys.map((k) => ({ ...k, source: 'auto' as const })) } : b,
          ),
        },
      }),
    );
    expect(cell('右上').getAttribute('aria-label')).toBe('右上（自動）');
    expect(screen.queryByText(/修正済み（補正のキー/)).toBeNull();
    expect(screen.getByRole('button', { name: '自動に戻す' }).hasAttribute('disabled')).toBe(true);
    moveFace(s, 1, 0);
    expect(cell('右上').getAttribute('aria-label')).toBe('右上（修正済み）');
    expect(screen.getByText('修正済み（補正のキー 1 個）')).toBeTruthy();
    act(() => s.store.undo());
    expect(cell('右上').getAttribute('aria-label')).toBe('右上（自動）');
  });

  it('組み合わせの補正の中に最初から出る。3×3 のマスで、斜めには状態が出る', () => {
    setup();
    const grid = directionGrid()!;
    expect(combinationGrid()).toBeNull();
    expect(
      within(grid)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      '左上（自動）',
      '上（顔 上下だけ）',
      '右上（自動）',
      '左（顔 左右だけ）',
      '正面（既定値のキー）',
      '右（顔 左右だけ）',
      '左下（自動）',
      '下（顔 上下だけ）',
      '右下（自動）',
    ]);

    expect(screen.getByRole('button', { name: '方向グリッド' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('マスを押すとその値を編集中にする。上下左右は1パラメータ、斜めと中央は2パラメータ', () => {
    const s = setup();
    fireEvent.click(cell('右上'));
    expect(s.editor.get().activeParameterIds).toEqual(['FaceAngleX', 'FaceAngleY']);
    expect(s.editor.get().editorParamValues).toEqual({ FaceAngleX: 30, FaceAngleY: 30 });
    expect(cell('右上').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/^右上: 自動/)).toBeTruthy();
    // パラメータの行も2つとも編集中になる
    expect(screen.getByText('キーを編集中: 顔 左右、顔 上下')).toBeTruthy();

    fireEvent.click(cell('右'));
    expect(s.editor.get().activeParameterIds).toEqual(['FaceAngleX']);
    expect(s.editor.get().editorParamValues).toEqual({ FaceAngleX: 30 });
    expect(cell('右上').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('右: 顔 左右 だけのキーを編集する')).toBeTruthy();

    fireEvent.click(cell('下'));
    expect(s.editor.get().activeParameterIds).toEqual(['FaceAngleY']);
    expect(s.editor.get().editorParamValues).toEqual({ FaceAngleY: -30 });

    fireEvent.click(cell('正面'));
    expect(s.editor.get().activeParameterIds).toEqual(['FaceAngleX', 'FaceAngleY']);
    expect(s.editor.get().editorParamValues).toEqual({ FaceAngleX: 0, FaceAngleY: 0 });
    expect(screen.getByText('正面: 2つの既定値の組み合わせのキーを編集する')).toBeTruthy();
  });

  it('斜めのマスの見た目は、補正前は上下と左右の和になる', () => {
    const s = setup();
    const model = s.store.get().model;
    const evaluator = createBindingEvaluator();
    for (const [name, x, y] of [
      ['左上', -30, 30],
      ['右上', 30, 30],
      ['左下', -30, -30],
      ['右下', 30, -30],
    ] as const) {
      fireEvent.click(cell(name));
      const onlyX = evaluator.evaluate(model, { FaceAngleX: x }).transforms.face!;
      const onlyY = evaluator.evaluate(model, { FaceAngleY: y }).transforms.face!;
      expect(previewFace(s)).toEqual({
        position: { x: onlyX.position.x + onlyY.position.x, y: onlyX.position.y + onlyY.position.y },
        rotation: onlyX.rotation + onlyY.rotation,
        scale: { x: onlyX.scale.x * onlyY.scale.x, y: onlyX.scale.y * onlyY.scale.y },
        opacity: 1,
      });
      // 頂点も上下と左右の差分の和
      const both = s.evaluator.evaluate(model, s.editor.get().editorParamValues).vertices['m-face']!;
      const vx = evaluator.evaluate(model, { FaceAngleX: x }).vertices['m-face']!;
      const vy = evaluator.evaluate(model, { FaceAngleY: y }).vertices['m-face']!;
      expect([...both]).toEqual([...vx].map((v, i) => v + vy[i]!));
    }
  });

  it('斜めのマスを直すと補正のキー（ロック）ができて修正済みになり、[自動に戻す] で消える。それぞれ1回で Undo できる', () => {
    const s = setup();
    const loaded = s.store.get();
    fireEvent.click(cell('右上'));
    const sum = previewFace(s);
    expect(screen.getByRole('button', { name: '自動に戻す' }).hasAttribute('disabled')).toBe(true);

    moveFace(s, 4, -2);
    const [binding] = pairBindings(s.store.get().model, DIRECTION_PAIR);
    expect(binding!.keys.find((k) => k.coords.join() === '30,30')).toMatchObject({ source: 'manual', locked: true });
    expect(cell('右上').getAttribute('aria-label')).toBe('右上（修正済み）');
    expect(cell('右上').dataset.status).toBe('corrected');
    expect(cell('左上').getAttribute('aria-label')).toBe('左上（自動）');
    expect(screen.getByText('修正済み（補正のキー 1 個）')).toBeTruthy();
    expect(previewFace(s).position).toEqual({ x: sum.position.x + 4, y: sum.position.y - 2 });
    const corrected = s.store.get();

    fireEvent.click(screen.getByRole('button', { name: '自動に戻す' }));
    expect(cell('右上').getAttribute('aria-label')).toBe('右上（自動）');
    expect(pairBindings(s.store.get().model, DIRECTION_PAIR)).toEqual([]);
    expect(s.store.get().model.bindings).toEqual(loaded.model.bindings);
    expect(previewFace(s)).toEqual(sum);
    expect(screen.getByRole('button', { name: '自動に戻す' }).hasAttribute('disabled')).toBe(true);

    act(() => s.store.undo());
    expect(s.store.get()).toBe(corrected);
    expect(cell('右上').getAttribute('aria-label')).toBe('右上（修正済み）');
    act(() => s.store.undo());
    expect(s.store.get()).toBe(loaded);
  });

  it('別の斜めを直しても、それぞれのマスの状態と [自動に戻す] は別々', () => {
    const s = setup();
    fireEvent.click(cell('右上'));
    moveFace(s, 4, -2);
    // 頂点も直す（補正のキーは対象ごと）
    fireEvent.click(cell('左下'));
    const command = s.keyEditor.pointsEdit(s.store.get(), s.editor.get(), { kind: 'mesh', meshId: 'm-face' }, [
      { index: 0, d: { x: 1, y: 1 } },
    ]);
    if (command === 'needsKey') throw new Error('キーがあるはず');
    act(() => s.store.dispatch(command));
    expect(cell('左下').getAttribute('aria-label')).toBe('左下（修正済み）');
    expect(cell('右上').getAttribute('aria-label')).toBe('右上（修正済み）');
    expect(pairBindings(s.store.get().model, DIRECTION_PAIR)).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '自動に戻す' }));
    expect(cell('左下').getAttribute('aria-label')).toBe('左下（自動）');
    expect(cell('右上').getAttribute('aria-label')).toBe('右上（修正済み）');
    expect(pairBindings(s.store.get().model, DIRECTION_PAIR).map((b) => b.target.id)).toEqual(['face']);
  });
});

describe('任意の組み合わせの補正', () => {
  const select = (label: string) => screen.getByRole('combobox', { name: `${label}のパラメータ` }) as HTMLSelectElement;

  it('表示切替をせず直接選べる。最初は顔の向きの組で、格子は各パラメータのキー位置の組み合わせ', () => {
    setup();
    expect(screen.queryByRole('combobox', { name: '横のパラメータ' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '任意の組み合わせ' }));
    expect(select('横').value).toBe('FaceAngleX');
    expect(select('縦').value).toBe('FaceAngleY');
    const buttons = within(combinationGrid()!).getAllByRole('button');
    expect(buttons).toHaveLength(9);
    expect(buttons[0]!.getAttribute('aria-label')).toBe('顔 左右 -30・顔 上下 +30（自動）');
  });

  it('2パラメータを編集中にしてから任意の組み合わせを選ぶと、その組で始まる', () => {
    const s = setup();
    act(() => s.editor.set({ activeParameterIds: ['EyeSmileL', 'EyeOpenL'], editorParamValues: {} }));
    fireEvent.click(screen.getByRole('button', { name: '任意の組み合わせ' }));
    expect(select('横').value).toBe('EyeSmileL');
    expect(select('縦').value).toBe('EyeOpenL');
  });

  it('任意の2パラメータを選び、組み合わせのマスを直すと補正のキーができ、[自動に戻す] で消える', () => {
    const s = setup();
    const loaded = s.store.get();
    fireEvent.click(screen.getByRole('button', { name: '任意の組み合わせ' }));
    fireEvent.change(select('横'), { target: { value: 'EyeOpenL' } });
    fireEvent.change(select('縦'), { target: { value: 'EyeSmileL' } });
    const grid = combinationGrid()!;
    expect(
      within(grid)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      '目 開閉 L 0・目 笑顔 L 1（自動）',
      '目 開閉 L 1・目 笑顔 L 1（目 笑顔 Lだけ）',
      '目 開閉 L 0・目 笑顔 L 0（目 開閉 Lだけ）',
      '目 開閉 L 1・目 笑顔 L 0（既定値のキー）',
    ]);

    // 閉じた目 × 笑顔 を押して頂点を直す
    fireEvent.click(cell('目 開閉 L 0・目 笑顔 L 1'));
    expect(s.editor.get().activeParameterIds).toEqual(['EyeOpenL', 'EyeSmileL']);
    expect(s.editor.get().editorParamValues).toEqual({ EyeOpenL: 0, EyeSmileL: 1 });
    const before = [...s.evaluator.evaluate(s.store.get().model, s.editor.get().editorParamValues).vertices['m-eye']!];
    const command = s.keyEditor.pointsEdit(s.store.get(), s.editor.get(), { kind: 'mesh', meshId: 'm-eye' }, [
      { index: 1, d: { x: 0, y: -3 } },
    ]);
    if (command === 'needsKey') throw new Error('キーがあるはず');
    act(() => s.store.dispatch(command));
    const [binding] = pairBindings(s.store.get().model, { a: 'EyeOpenL', b: 'EyeSmileL' });
    expect(binding!.keys.find((k) => k.coords.join() === '0,1')).toMatchObject({ source: 'manual', locked: true });
    expect(cell('目 開閉 L 0・目 笑顔 L 1').getAttribute('aria-label')).toBe('目 開閉 L 0・目 笑顔 L 1（修正済み）');
    const after = [...s.evaluator.evaluate(s.store.get().model, s.editor.get().editorParamValues).vertices['m-eye']!];
    expect(after).toEqual(before.map((v, i) => (i === 3 ? v - 3 : v)));

    fireEvent.click(screen.getByRole('button', { name: '自動に戻す' }));
    expect(cell('目 開閉 L 0・目 笑顔 L 1').getAttribute('aria-label')).toBe('目 開閉 L 0・目 笑顔 L 1（自動）');
    expect(s.store.get().model.bindings).toEqual(loaded.model.bindings);

    // 片方だけが動くマスは1パラメータの編集
    fireEvent.click(cell('目 開閉 L 0・目 笑顔 L 0'));
    expect(s.editor.get().activeParameterIds).toEqual(['EyeOpenL']);
    expect(s.editor.get().editorParamValues).toEqual({ EyeOpenL: 0 });
  });

  it('同じパラメータを選ぶと入れ替える。キーの無いパラメータには案内を出す', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '任意の組み合わせ' }));
    fireEvent.change(select('横'), { target: { value: 'FaceAngleY' } });
    expect(select('横').value).toBe('FaceAngleY');
    expect(select('縦').value).toBe('FaceAngleX');
    fireEvent.change(select('縦'), { target: { value: 'MouthOpen' } });
    expect(combinationGrid()).toBeNull();
    expect(screen.getByText(/^口 開閉 にキーが無い/)).toBeTruthy();
  });
});
