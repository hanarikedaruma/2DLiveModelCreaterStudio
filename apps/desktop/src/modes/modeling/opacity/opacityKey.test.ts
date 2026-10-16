// 不透明度のキー（カード34・I-026）。本物の KeyEditor・評価・変形で確かめる
import { describe, expect, it } from 'vitest';
import { ensureStandardParameters, type Binding, type Project, type TransformDelta } from '@app/schema';
import type { Command, EditorState } from '@app/contracts';
import { createBindingEvaluator } from '@app/core';
import { createKeyEditor } from '../../../services/keyEditor';
import { deepFreeze, delta, editorAt, part, projectWith } from '../../../services/keyEditor/testing';
import { addKeysCommand, opacityAt, opacityCommand } from './opacityKey';

const keyEditor = createKeyEditor();
const evaluator = createBindingEvaluator();

// 頬（cheek）・顔（face）・半透明の飾り（ribbon）。STEP1 の標準パラメータ入り。どれも親の無いグループ
function project(): Project {
  const group = { kind: 'group' as const };
  const p = projectWith({
    parts: [part('cheek', group), part('face', group), part('ribbon', { ...group, opacity: 0.5 })],
  });
  return { ...p, model: ensureStandardParameters(p.model, 'step1') };
}

function run(p: Project, command: Command | 'needsKey' | null): Project {
  if (command === null || command === 'needsKey') throw new Error(`コマンドがあるはず: ${command}`);
  return command.apply(p);
}

// 描くときの、パーツ自身の不透明度（評価 → 変形と同じ規則。親は無い）
function shown(p: Project, partId: string, values: Record<string, number>): number {
  const deltas = evaluator.evaluate(p.model, values);
  return deltas.opacities?.[partId] ?? p.model.parts.find((x) => x.id === partId)!.opacity;
}

const set = (p: Project, editor: EditorState, ids: string[], target: number) =>
  run(p, opacityCommand(keyEditor, p, editor, ids, target));
const opacityOf = (p: Project, partId: string) => p.model.parts.find((x) => x.id === partId)!.opacity;
const bindingOf = (p: Project, partId: string) => p.model.bindings.find((b) => b.target.id === partId)!;
const keyOpacities = (b: Binding) => b.keys.map((k) => (k.delta as TransformDelta).opacity);

describe('不透明度のキー（絶対値。I-026）', () => {
  it('頬染めを Cheek で出し入れできる（デフォルト値で基準の不透明度を 0 にし、値 1 のキーで出す）', () => {
    let p = project();
    const atZero = editorAt({ Cheek: 0 });
    const atOne = editorAt({ Cheek: 1 });
    expect(opacityAt(p, atZero, 'cheek')).toEqual({ base: true, value: 1, needsKey: false, others: false });
    p = set(p, atZero, ['cheek'], 0);
    expect(opacityOf(p, 'cheek')).toBe(0); // 0.001 の代わりは使わない
    expect(p.model.bindings).toHaveLength(0);

    // 値 1 ではまだキーが無いので、基準の不透明度のまま（0）。0 からキーで上げられる
    expect(opacityAt(p, atOne, 'cheek')).toEqual({ base: false, value: 0, needsKey: false, others: false });
    p = set(p, atOne, ['cheek'], 1);
    const binding = bindingOf(p, 'cheek');
    expect(binding).toMatchObject({ parameterIds: ['Cheek'], controlsOpacity: true, keyValues: [[0, 1]] });
    expect(keyOpacities(binding)).toEqual([0, 1]);
    expect(opacityAt(p, atOne, 'cheek').value).toBe(1);
    expect(shown(p, 'cheek', { Cheek: 0 })).toBe(0);
    expect(shown(p, 'cheek', { Cheek: 0.5 })).toBeCloseTo(0.5);
    expect(shown(p, 'cheek', { Cheek: 1 })).toBe(1);
    // ほかのパーツは変わらない
    expect(shown(p, 'face', { Cheek: 1 })).toBe(1);
  });

  it('キーの値はいつも指定した値になり、0 にしても上げ直せる。基準の不透明度は変えない', () => {
    let p = project();
    const editor = editorAt({ FaceAngleX: 30 });
    for (const target of [0.3, 0, 0.8, 1, 0]) {
      p = set(p, editor, ['ribbon'], target);
      expect(shown(p, 'ribbon', { FaceAngleX: 30 })).toBeCloseTo(target);
      expect(opacityAt(p, editor, 'ribbon').value).toBeCloseTo(target);
    }
    expect(opacityOf(p, 'ribbon')).toBe(0.5);
    expect(shown(p, 'ribbon', { FaceAngleX: 0 })).toBe(0.5);
    // 同じ値なら何もしない
    expect(opacityCommand(keyEditor, p, editor, ['ribbon'], 0)).toBeNull();
  });

  it('基準の不透明度が 0 のパーツも、キーで見せられる', () => {
    const p = project();
    const hidden = { ...p, model: { ...p.model, parts: p.model.parts.map((x) => ({ ...x, opacity: 0 })) } };
    const out = set(hidden, editorAt({ MouthOpen: 1 }), ['face'], 0.9);
    expect(shown(out, 'face', { MouthOpen: 1 })).toBeCloseTo(0.9);
    expect(shown(out, 'face', {})).toBe(0);
  });

  it('キーの無い値では needsKey。キーを足すと、補間した値から変えられる', () => {
    let p = project();
    p = set(p, editorAt({ Cheek: 1 }), ['cheek'], 0.2);
    const half = editorAt({ Cheek: 0.5 });
    expect(opacityAt(p, half, 'cheek')).toMatchObject({ needsKey: true, value: expect.closeTo(0.6) });
    expect(opacityCommand(keyEditor, p, half, ['cheek'], 0.9)).toBe('needsKey');

    p = addKeysCommand(keyEditor, p, half, ['cheek']).apply(p);
    expect(shown(p, 'cheek', { Cheek: 0.5 })).toBeCloseTo(0.6); // 足しただけでは見た目は変わらない
    p = set(p, half, ['cheek'], 0.9);
    expect(bindingOf(p, 'cheek').keyValues).toEqual([[0, 0.5, 1]]);
    expect(shown(p, 'cheek', { Cheek: 0.5 })).toBeCloseTo(0.9);
    expect(shown(p, 'cheek', { Cheek: 1 })).toBeCloseTo(0.2);
    expect(shown(p, 'cheek', { Cheek: 0 })).toBe(1);
  });

  it('選んだパーツすべてを同じ値にそろえる（基準の不透明度が違っても）。コマンドは1つ', () => {
    const p = project();
    const after = run(p, opacityCommand(keyEditor, p, editorAt({ MouthOpen: 1 }), ['face', 'ribbon'], 0.4));
    expect(shown(after, 'face', { MouthOpen: 1 })).toBeCloseTo(0.4);
    expect(shown(after, 'ribbon', { MouthOpen: 1 })).toBeCloseTo(0.4);
    expect(after.model.bindings).toHaveLength(2);
    // デフォルト値では基準の不透明度（Part.opacity）をそろえ、不透明度のバインディングのデフォルト値のキーも合わせる
    const base = run(after, opacityCommand(keyEditor, after, editorAt({ MouthOpen: 0 }), ['face', 'ribbon'], 0.7));
    expect([opacityOf(base, 'face'), opacityOf(base, 'ribbon')]).toEqual([0.7, 0.7]);
    expect(keyOpacities(bindingOf(base, 'ribbon'))).toEqual([0.7, 0.4]);
    expect(shown(base, 'ribbon', { MouthOpen: 1 })).toBeCloseTo(0.4);
  });

  it('2つのパラメータの組にも記録し、組・単独のどちらの手動キーもロックする', () => {
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
    const single = run(p, opacityCommand(keyEditor, p, editorAt({ FaceAngleX: 30 }), ['face'], 0.5));
    expect(single.model.bindings[0]!.keys.find((k) => k.coords[0] === 30)!.locked).toBe(true);
  });

  it('ほかのパラメータの不透明度のキーがあっても、いまの見え方を指定した値にする', () => {
    let p = project();
    p = set(p, editorAt({ Cheek: 1 }), ['ribbon'], 0.1); // Cheek 1 で 0.5 → 0.1
    const editor = editorAt({ MouthOpen: 1 }, { editorParamValues: { MouthOpen: 1, Cheek: 1 } });
    expect(opacityAt(p, editor, 'ribbon')).toMatchObject({ value: expect.closeTo(0.1), others: true });
    p = set(p, editor, ['ribbon'], 0.6);
    expect(shown(p, 'ribbon', { MouthOpen: 1, Cheek: 1 })).toBeCloseTo(0.6);
    // それぞれのデフォルト値からの変化を足す: 0.5 + (0.1 − 0.5) + (MouthOpen 1 の値 − 0.5)
    expect(shown(p, 'ribbon', { MouthOpen: 1 })).toBeCloseTo(1);
  });

  it('コマンドは入力を書き換えない', () => {
    const p = deepFreeze(project());
    const editor = deepFreeze(editorAt({ Cheek: 1 }));
    expect(() => run(p, opacityCommand(keyEditor, p, editor, ['cheek', 'face'], 0.5))).not.toThrow();
    expect(() => run(p, opacityCommand(keyEditor, p, editorAt({ Cheek: 0 }), ['cheek'], 0.5))).not.toThrow();
    const keyed: Binding = {
      id: 'b',
      target: { type: 'part', id: 'face' },
      channel: 'transform',
      parameterIds: ['Cheek'],
      keyValues: [[0, 1]],
      keys: [
        { coords: [0], delta: delta(), source: 'auto', locked: false },
        { coords: [1], delta: delta({ opacity: 0.3 }), source: 'auto', locked: false },
      ],
      generation: 'linear',
      divisions: null,
      controlsOpacity: true,
    };
    const q = deepFreeze({ ...p, model: { ...p.model, bindings: [keyed] } });
    expect(() => run(q, opacityCommand(keyEditor, q, editor, ['face'], 0.9))).not.toThrow();
  });
});
