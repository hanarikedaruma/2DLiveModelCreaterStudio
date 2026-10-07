// カード63のテスト担当 CO。実際の生成器で値と対象を検証し、選んでいないパーツを参照ごと保つ。
import { describe, expect, it } from 'vitest';
import { createKeyGenerator, createProjectStore } from '@app/core';
import { basePart } from '../structure/modelOps';
import { generateBetween, regenerateKeys } from './generate';
import { binding63, key63, project63 } from './fixture.c63';

function setup(regenerate = false) {
  const project = project63();
  for (const binding of project.model.bindings) {
    binding.keyValues = [[-30, 0, 15, 30]];
    binding.keys = [key63(-30, -11), key63(0, 0, false, 'auto'), key63(30, 21)];
    if (regenerate) binding.keys.splice(2, 0, key63(15, 999, false, 'generated'));
  }
  const store = createProjectStore(project);
  const generator = createKeyGenerator({ parameters: () => store.get().model.parameters });
  return { project, store, generator };
}

describe('カード63: 間を生成とすべて再補間の対象', () => {
  for (const regenerate of [false, true]) {
    const label = regenerate ? 'すべて再補間' : '間を生成';
    for (const selected of [true, false]) {
      it(`${label}は${selected ? '選んだパーツだけ' : '選んでいなければ全パーツ'}に掛かり、1回のUndoで戻る`, () => {
        const { project, store, generator } = setup(regenerate);
        const partIds = selected ? ['a'] : [];
        const count = regenerate
          ? regenerateKeys(store, generator, ['FaceAngleX'], undefined, partIds)
          : generateBetween(store, generator, ['FaceAngleX'], partIds);
        expect(count).toBe(selected ? 1 : 2);
        const bindings = store.get().model.bindings;
        expect(bindings[0]!.keys.find((k) => k.coords[0] === 15)?.delta).toEqual({ ...key63(15, 10.5).delta });
        if (selected) expect(bindings[1]).toBe(project.model.bindings[1]);
        else expect(bindings[1]!.keys.find((k) => k.coords[0] === 15)?.delta).toEqual({ ...key63(15, 10.5).delta });
        expect(bindings[0]!.keys.find((k) => k.coords[0] === 0)).toBe(
          project.model.bindings[0]!.keys.find((k) => k.coords[0] === 0),
        );
        store.undo();
        expect(store.get()).toBe(project);
        expect(store.canUndo()).toBe(false);
      });
    }
  }

  it('選んだグループの子孫のキーも生成し、別の木のキーは保持する', () => {
    const { project, store, generator } = setup();
    project.model.parts = [
      basePart({ id: 'g', name: 'グループ', kind: 'group' }),
      ...project.model.parts.map((p) => (p.id === 'a' ? { ...p, parentId: 'g' } : p)),
    ];
    const group = binding63('g-key', 'g');
    group.keys = [key63(0, 0), key63(30, 21)];
    group.keyValues = [[0, 15, 30]];
    project.model.bindings.push(group);
    expect(generateBetween(store, generator, ['FaceAngleX'], ['g'])).toBe(2);
    expect(store.get().model.bindings[0]!.keys.find((k) => k.coords[0] === 15)?.delta).toEqual(key63(15, 10.5).delta);
    expect(store.get().model.bindings[2]!.keys.find((k) => k.coords[0] === 15)?.delta).toEqual(key63(15, 10.5).delta);
    expect(store.get().model.bindings[1]).toBe(project.model.bindings[1]);
    store.undo();
    expect(store.get()).toBe(project);
  });
});
