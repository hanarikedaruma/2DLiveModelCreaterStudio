// 不透明度のキー（カード34）。本物の KeyEditor と評価で確かめる
import { describe, expect, it } from 'vitest';
import { ensureStandardParameters, type Binding, type Project } from '@app/schema';
import type { Command, EditorState } from '@app/contracts';
import { createBindingEvaluator } from '@app/core';
import { createKeyEditor } from '../../../services/keyEditor';
import { deepFreeze, delta, DETAIL, editorAt, part, projectWith } from '../../../services/keyEditor/testing';
import { addKeysCommand, OPACITY_FLOOR, opacityAt, opacityCommand } from './opacityKey';

const keyEditor = createKeyEditor();
const evaluator = createBindingEvaluator();

// 頬（cheek）・顔（face）・半透明の飾り（ribbon）。STEP1 の標準パラメータ入り
function project(): Project {
  const p = projectWith({ parts: [part('cheek'), part('face'), part('ribbon', { opacity: 0.5 })] });
  return { ...p, model: ensureStandardParameters(p.model, 'step1') };
}

function run(p: Project, command: Command | 'needsKey' | null): Project {
  if (command === null || command === 'needsKey') throw new Error(`コマンドがあるはず: ${command}`);
  return command.apply(p);
}

// 描くときの不透明度（Part.opacity × 評価した差分の倍率）
function shown(p: Project, partId: string, values: Record<string, number>): number {
  const base = p.model.parts.find((x) => x.id === partId)!.opacity;
  const d = evaluator.evaluate(p.model, values).transforms[partId];
  return Math.min(1, base * (d ? d.opacity : 1));
}

const set = (p: Project, editor: EditorState, ids: string[], target: number) =>
  run(p, opacityCommand(keyEditor, p, editor, ids, target));

describe('不透明度のキー', () => {
  it('頬染めを Cheek で出し入れできる（デフォルト値で消し、値 1 のキーで出す）', () => {
    let p = project();
    const atZero = editorAt({ Cheek: 0 });
    const atOne = editorAt({ Cheek: 1 });
    // デフォルト値は基準状態。0 にすると、キーで上げられるように OPACITY_FLOOR を記録する
    expect(opacityAt(keyEditor, p, atZero, 'cheek')).toEqual({ base: true, value: 1, needsKey: false, blocked: null });
    p = set(p, atZero, ['cheek'], 0);
    expect(p.model.parts.find((x) => x.id === 'cheek')!.opacity).toBe(OPACITY_FLOOR);
    expect(p.model.bindings).toHaveLength(0);

    // 値 1 ではまだキーが無いので、基準状態のまま（ほぼ 0）
    expect(opacityAt(keyEditor, p, atOne, 'cheek')).toMatchObject({ base: false, needsKey: false, blocked: null });
    expect(opacityAt(keyEditor, p, atOne, 'cheek').value).toBeCloseTo(OPACITY_FLOOR);
    p = set(p, atOne, ['cheek'], 1);

    const binding = p.model.bindings[0]!;
    expect(binding).toMatchObject({
      target: { type: 'part', id: 'cheek' },
      channel: 'transform',
      parameterIds: ['Cheek'],
    });
    expect(binding.keyValues).toEqual([[0, 1]]);
    expect(opacityAt(keyEditor, p, atOne, 'cheek').value).toBeCloseTo(1);
    expect(shown(p, 'cheek', { Cheek: 0 })).toBeCloseTo(OPACITY_FLOOR);
    expect(shown(p, 'cheek', { Cheek: 0.5 })).toBeCloseTo(0.5, 2);
    expect(shown(p, 'cheek', { Cheek: 1 })).toBeCloseTo(1);
    // ほかのパーツは変わらない
    expect(shown(p, 'face', { Cheek: 1 })).toBe(1);
  });

  it('キーの値はいつも指定した値になり、0 にしても上げ直せる', () => {
    let p = project();
    const editor = editorAt({ FaceAngleX: 30 });
    for (const target of [0.3, 0, 0.8, 1]) {
      p = set(p, editor, ['face'], target);
      expect(shown(p, 'face', { FaceAngleX: 30 })).toBeCloseTo(Math.max(target, OPACITY_FLOOR));
      expect(opacityAt(keyEditor, p, editor, 'face').value).toBeCloseTo(Math.max(target, OPACITY_FLOOR));
    }
    // 基準状態（デフォルト値）は変えない
    expect(p.model.parts.find((x) => x.id === 'face')!.opacity).toBe(1);
    expect(shown(p, 'face', { FaceAngleX: 0 })).toBe(1);
    // 同じ値なら何もしない
    expect(opacityCommand(keyEditor, p, editor, ['face'], 1)).toBeNull();
  });

  it('キーの無い値では needsKey。キーを足すと、補間した値から変えられる', () => {
    let p = project();
    p = set(p, editorAt({ Cheek: 1 }), ['cheek'], 0.2);
    const half = editorAt({ Cheek: 0.5 });
    expect(opacityAt(keyEditor, p, half, 'cheek')).toMatchObject({ needsKey: true, blocked: null });
    expect(opacityAt(keyEditor, p, half, 'cheek').value).toBeCloseTo(0.6);
    expect(opacityCommand(keyEditor, p, half, ['cheek'], 0.9)).toBe('needsKey');

    p = addKeysCommand(keyEditor, p, half, ['cheek']).apply(p);
    expect(shown(p, 'cheek', { Cheek: 0.5 })).toBeCloseTo(0.6); // 足しただけでは見た目は変わらない
    p = set(p, half, ['cheek'], 0.9);
    expect(p.model.bindings[0]!.keyValues).toEqual([[0, 0.5, 1]]);
    expect(shown(p, 'cheek', { Cheek: 0.5 })).toBeCloseTo(0.9);
    expect(shown(p, 'cheek', { Cheek: 1 })).toBeCloseTo(0.2);
    expect(shown(p, 'cheek', { Cheek: 0 })).toBe(1);
  });

  it('選んだパーツすべてを同じ値にそろえる（基準状態の不透明度が違っても）。コマンドは1つ', () => {
    const p = project();
    const editor = editorAt({ MouthOpen: 1 });
    const command = opacityCommand(keyEditor, p, editor, ['face', 'ribbon'], 0.4);
    expect(command).not.toBeNull();
    const after = run(p, command);
    expect(shown(after, 'face', { MouthOpen: 1 })).toBeCloseTo(0.4);
    expect(shown(after, 'ribbon', { MouthOpen: 1 })).toBeCloseTo(0.4);
    expect(after.model.bindings).toHaveLength(2);
    // 基準状態では Part.opacity をそろえる
    const base = run(p, opacityCommand(keyEditor, p, editorAt({ MouthOpen: 0 }), ['face', 'ribbon'], 0.7));
    expect(base.model.parts.filter((x) => x.id !== 'cheek').map((x) => x.opacity)).toEqual([0.7, 0.7]);
  });

  it('2つのパラメータの組のキーにも記録する（かんたんモードではロックする）', () => {
    const p = project();
    const editor = editorAt({ FaceAngleX: 30, FaceAngleY: -30 });
    const after = run(p, opacityCommand(keyEditor, p, editor, ['face'], 0.25));
    const binding = after.model.bindings[0]!;
    expect(binding.parameterIds).toEqual(['FaceAngleX', 'FaceAngleY']);
    expect(binding.keys.find((k) => k.coords[0] === 30 && k.coords[1] === -30)).toMatchObject({
      source: 'manual',
      locked: true,
    });
    expect(shown(after, 'face', { FaceAngleX: 30, FaceAngleY: -30 })).toBeCloseTo(0.25);
    // 詳細モードではロックしない
    const detail = run(p, opacityCommand(keyEditor, p, editorAt({ FaceAngleX: 30 }, DETAIL), ['face'], 0.5));
    expect(detail.model.bindings[0]!.keys.find((k) => k.coords[0] === 30)!.locked).toBe(false);
  });

  it('基準状態の不透明度やキーの倍率が 0 なら、倍率では上げられない（そのパーツは変えない）', () => {
    const p = project();
    const hidden = {
      ...p,
      model: { ...p.model, parts: p.model.parts.map((x) => (x.id === 'cheek' ? { ...x, opacity: 0 } : x)) },
    };
    const editor = editorAt({ Cheek: 1 });
    expect(opacityAt(keyEditor, hidden, editor, 'cheek')).toMatchObject({ value: 0, blocked: 'baseZero' });
    expect(opacityCommand(keyEditor, hidden, editor, ['cheek'], 1)).toBeNull();
    // デフォルト値（基準状態）では 0 からでも上げられる
    const raised = run(hidden, opacityCommand(keyEditor, hidden, editorAt({ Cheek: 0 }), ['cheek'], 0.5));
    expect(raised.model.parts.find((x) => x.id === 'cheek')!.opacity).toBe(0.5);

    const zeroKey: Binding = {
      id: 'b-zero',
      target: { type: 'part', id: 'face' },
      channel: 'transform',
      parameterIds: ['Cheek'],
      keyValues: [[0, 1]],
      keys: [
        { coords: [0], delta: delta(), source: 'auto', locked: false },
        { coords: [1], delta: delta({ opacity: 0 }), source: 'auto', locked: false },
      ],
      generation: 'linear',
      divisions: null,
    };
    const withZero = { ...p, model: { ...p.model, bindings: [zeroKey] } };
    expect(opacityAt(keyEditor, withZero, editor, 'face')).toMatchObject({ value: 0, blocked: 'keyZero' });
    expect(opacityCommand(keyEditor, withZero, editor, ['face'], 1)).toBeNull();
  });

  it('コマンドは入力を書き換えない', () => {
    const p = deepFreeze(project());
    const editor = deepFreeze(editorAt({ Cheek: 1 }));
    expect(() => run(p, opacityCommand(keyEditor, p, editor, ['cheek', 'face'], 0.5))).not.toThrow();
    expect(() => run(p, opacityCommand(keyEditor, p, editorAt({ Cheek: 0 }), ['cheek'], 0.5))).not.toThrow();
  });
});

// かんたんセットアップ（カード42）の頬染めと同じ形: 値 0（デフォルト値）に倍率 0.001、値 1 に差分なし
function setupCheek(partId: string): Binding {
  return {
    id: `b-${partId}`,
    target: { type: 'part', id: partId },
    channel: 'transform',
    parameterIds: ['Cheek'],
    keyValues: [[0, 1]],
    keys: [
      { coords: [0], delta: delta({ opacity: OPACITY_FLOOR }), source: 'auto', locked: false },
      { coords: [1], delta: delta(), source: 'auto', locked: false },
    ],
    generation: 'linear',
    divisions: null,
  };
}

const withBindings = (p: Project, bindings: Binding[]): Project => ({ ...p, model: { ...p.model, bindings } });
const keyAt = (p: Project, partId: string, value: number) =>
  p.model.bindings.find((b) => b.target.id === partId)!.keys.find((k) => Math.abs(k.coords[0]! - value) < 1e-6)!;
const opacityOf = (p: Project, partId: string) => p.model.parts.find((x) => x.id === partId)!.opacity;

describe('デフォルト値のキー（I-038）', () => {
  it('頬染めの値 0 のキー（倍率 0.001）を、デフォルト値で表示して変えられる（基準状態は変えない）', () => {
    const before = withBindings(project(), [setupCheek('cheek')]);
    const atZero = editorAt({ Cheek: 0 });
    const state = opacityAt(keyEditor, before, atZero, 'cheek');
    expect(state).toMatchObject({ base: false, needsKey: false, blocked: null });
    expect(state.value).toBeCloseTo(OPACITY_FLOOR); // 見た目どおり（Part.opacity の 1 ではない）

    let p = set(before, atZero, ['cheek'], 0.6);
    expect(opacityOf(p, 'cheek')).toBe(1);
    expect(keyAt(p, 'cheek', 0)).toMatchObject({ delta: { opacity: expect.closeTo(0.6, 6) }, source: 'manual' });
    expect(keyAt(p, 'cheek', 1)).toEqual(keyAt(before, 'cheek', 1));
    expect(shown(p, 'cheek', { Cheek: 0 })).toBeCloseTo(0.6);
    expect(shown(p, 'cheek', { Cheek: 0.5 })).toBeCloseTo(0.8);
    expect(shown(p, 'cheek', { Cheek: 1 })).toBeCloseTo(1);
    expect(opacityAt(keyEditor, p, atZero, 'cheek').value).toBeCloseTo(0.6);
    expect(opacityCommand(keyEditor, p, atZero, ['cheek'], 0.6)).toBeNull();

    // 0 にすると OPACITY_FLOOR を記録し、また上げられる
    p = set(p, atZero, ['cheek'], 0);
    expect(shown(p, 'cheek', { Cheek: 0 })).toBeCloseTo(OPACITY_FLOOR);
    p = set(p, atZero, ['cheek'], 1);
    expect(shown(p, 'cheek', { Cheek: 0 })).toBeCloseTo(1);
    expect(opacityOf(p, 'cheek')).toBe(1);
  });

  it('基準状態の不透明度が 1 でなくても、見た目の不透明度で指定する。かんたんモードではロックする', () => {
    const before = withBindings(project(), [setupCheek('ribbon')]); // ribbon の基準状態は 0.5
    const atZero = editorAt({ Cheek: 0 });
    expect(opacityAt(keyEditor, before, atZero, 'ribbon').value).toBeCloseTo(0.5 * OPACITY_FLOOR);
    const p = set(before, atZero, ['ribbon'], 0.4);
    expect(keyAt(p, 'ribbon', 0).delta).toMatchObject({ opacity: expect.closeTo(0.8, 6) });
    expect(keyAt(p, 'ribbon', 0).locked).toBe(true);
    expect(shown(p, 'ribbon', { Cheek: 0 })).toBeCloseTo(0.4);
    expect(opacityOf(p, 'ribbon')).toBe(0.5);
    // 詳細モードではロックしない
    const detail = set(before, editorAt({ Cheek: 0 }, DETAIL), ['ribbon'], 0.4);
    expect(keyAt(detail, 'ribbon', 0).locked).toBe(false);
  });

  it('デフォルト値にキーが無いパーツは、いまどおり基準状態を変える（選んだパーツごとに決める）', () => {
    // ribbon のバインディングは値 1 にだけキーがある
    const onlyOne: Binding = { ...setupCheek('ribbon'), keyValues: [[1]], keys: [setupCheek('ribbon').keys[1]!] };
    const before = withBindings(project(), [setupCheek('cheek'), onlyOne]);
    const atZero = editorAt({ Cheek: 0 });
    expect(opacityAt(keyEditor, before, atZero, 'face')).toEqual({
      base: true,
      value: 1,
      needsKey: false,
      blocked: null,
    });
    expect(opacityAt(keyEditor, before, atZero, 'ribbon')).toMatchObject({ base: true, value: 0.5 });

    const p = set(before, atZero, ['cheek', 'face', 'ribbon'], 0.3);
    expect(keyAt(p, 'cheek', 0).delta).toMatchObject({ opacity: expect.closeTo(0.3, 6) });
    expect(opacityOf(p, 'cheek')).toBe(1);
    expect(opacityOf(p, 'face')).toBe(0.3);
    expect(opacityOf(p, 'ribbon')).toBe(0.3);
    expect(p.model.bindings[1]).toEqual(onlyOne);
  });

  it('基準状態の不透明度が 0 なら、デフォルト値のキーでも倍率では上げられない', () => {
    const p = withBindings(project(), [setupCheek('cheek')]);
    const hidden = {
      ...p,
      model: { ...p.model, parts: p.model.parts.map((x) => (x.id === 'cheek' ? { ...x, opacity: 0 } : x)) },
    };
    const atZero = editorAt({ Cheek: 0 });
    expect(opacityAt(keyEditor, hidden, atZero, 'cheek')).toMatchObject({ base: false, value: 0, blocked: 'baseZero' });
    expect(opacityCommand(keyEditor, hidden, atZero, ['cheek'], 1)).toBeNull();
  });

  it('デフォルト値のキーを変えるコマンドも入力を書き換えない', () => {
    const p = deepFreeze(withBindings(project(), [setupCheek('cheek')]));
    expect(() =>
      run(p, opacityCommand(keyEditor, p, deepFreeze(editorAt({ Cheek: 0 })), ['cheek'], 0.5)),
    ).not.toThrow();
  });
});
