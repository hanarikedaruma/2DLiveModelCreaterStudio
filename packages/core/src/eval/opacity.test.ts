import { describe, expect, it } from 'vitest';
import { createEmptyProject, type Binding, type Part, type TransformDelta } from '@app/schema';
import { patchPart } from '../store/projectStore';
import { createBindingEvaluator } from './evaluator';
import { bindingOpacity, partOpacity, rawPartOpacity, withPartOpacity } from './opacity';
import { delta, testModel, transformBinding } from './testModel';

const part = (id: string, opacity: number): Part => ({
  id,
  name: id,
  kind: 'group',
  standardType: null,
  assetId: null,
  meshId: null,
  parentId: null,
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  pivot: { x: 0, y: 0 },
  opacity,
  blendMode: 'normal',
  depth: 0,
  mask: null,
  physicsId: null,
  visible: true,
  locked: false,
});
const opacityBinding = (id: string, parameterId: string, keys: [number, number][], controls = true): Binding => ({
  ...transformBinding(
    id,
    'p',
    [parameterId],
    [keys.map(([c]) => c)],
    keys.map(([c, op]) => [[c], delta({ op })]),
  ),
  ...(controls ? { controlsOpacity: true } : {}),
});
const opacities = (b: Binding) => b.keys.map((k) => (k.delta as TransformDelta).opacity);

describe('パーツ自身の不透明度（I-026）', () => {
  const a = opacityBinding('a', 'FaceAngleX', [
    [0, 0.5],
    [30, 1],
  ]);
  const b = opacityBinding('b', 'FaceAngleY', [
    [0, 0.5],
    [30, 0],
  ]);
  const model = testModel({ parts: [part('p', 0.5)], bindings: [a, b] });

  it('評価（evaluator）と同じ値になる', () => {
    const cases: Record<string, number>[] = [
      {},
      { FaceAngleX: 30 },
      { FaceAngleX: 15, FaceAngleY: 10 },
      { FaceAngleY: 30 },
    ];
    for (const params of cases) {
      const evaluated = createBindingEvaluator().evaluate(model, params).opacities?.p;
      expect(partOpacity(model, 'p', params)).toBeCloseTo(evaluated!, 9);
    }
  });

  it('0..1 に収める前の値と、1つのバインディングを除いた値', () => {
    expect(rawPartOpacity(model, 'p', { FaceAngleX: 30, FaceAngleY: 30 })).toBeCloseTo(0.5 + 0.5 - 0.5);
    expect(rawPartOpacity(model, 'p', { FaceAngleX: 30, FaceAngleY: 30 }, 'b')).toBeCloseTo(1);
    expect(bindingOpacity(model, a, { FaceAngleX: 15 })).toEqual({ value: 0.75, atDefault: 0.5 });
    expect(bindingOpacity(model, { ...a, controlsOpacity: undefined }, {})).toBeNull();
  });

  it('不透明度のバインディングが無ければ Part.opacity', () => {
    const plain = testModel({
      parts: [part('p', 0.3)],
      bindings: [opacityBinding('x', 'FaceAngleX', [[0, 1]], false)],
    });
    expect(partOpacity(plain, 'p', { FaceAngleX: 0 })).toBe(0.3);
  });
});

describe('withPartOpacity・patchPart（I-026）', () => {
  const b = opacityBinding('b', 'FaceAngleX', [
    [-30, 0],
    [0, 0.5],
    [30, 1],
  ]);
  const plain = { ...opacityBinding('c', 'FaceAngleY', [[0, 1]], false), target: { type: 'part' as const, id: 'p' } };

  it('基準の不透明度と、不透明度のバインディングのデフォルト値のキーを同じ値にする（ほかのキーは変えない）', () => {
    const model = testModel({ parts: [part('p', 0.5)], bindings: [b, plain] });
    const next = withPartOpacity(model, 'p', 0.2);
    expect(next.parts[0]!.opacity).toBe(0.2);
    expect(opacities(next.bindings[0]!)).toEqual([0, 0.2, 1]);
    expect(next.bindings[1]).toBe(plain);
    expect(withPartOpacity(next, 'p', 0.2)).toBe(next);
    expect(withPartOpacity(model, 'p', 3).parts[0]!.opacity).toBe(1);
  });

  it('patchPart で不透明度を変えても、デフォルト値のキーがそろう', () => {
    const project = { ...createEmptyProject('t'), model: testModel({ parts: [part('p', 0.5)], bindings: [b] }) };
    const next = patchPart('不透明度', 'p', { opacity: 0.8 }).apply(project);
    expect(next.model.parts[0]!.opacity).toBe(0.8);
    expect(opacities(next.model.bindings[0]!)).toEqual([0, 0.8, 1]);
    // 不透明度を変えないパッチはバインディングを触らない
    const moved = patchPart('移動', 'p', { position: { x: 1, y: 0 } }).apply(project);
    expect(moved.model.bindings).toBe(project.model.bindings);
  });
});
