// カード58 の受け入れテスト（担当 CO）。削除と前の版の修復を、Undo と保存から確かめる。
import { describe, expect, it } from 'vitest';
import { createEmptyProject, type Physics, type Project, validateProject } from '@app/schema';
import { MemoryFileSystem } from '@app/contracts';
import { createProjectStore } from '@app/core';
import { createProjectIO } from '@app/io';
import { part } from '../../../services/keyEditor/testing';
import { removeParameterCommand } from './userParams';

function modelWithPhysics(): Project {
  const project = createEmptyProject('カード58: 物理の出力');
  const physics = (id: string, outputParameterId: string): Physics => ({
    id,
    partId: id,
    preset: 'hair',
    strength: 0.5,
    direction: 'horizontal',
    length: 100,
    spring: 0.5,
    damping: 0.5,
    gravity: 0.5,
    inertia: 0.5,
    range: 0.5,
    inputs: [{ parameterId: 'FaceAngleX', weight: 1 }],
    outputParameterId,
  });
  return {
    ...project,
    model: {
      ...project.model,
      parameters: [
        ...project.model.parameters,
        { id: 'custom-output', name: '揺れ', groupId: 'other', min: -1, max: 1, default: 0, standard: false },
      ],
      parts: [part('affected', { physicsId: 'affected' }), part('unrelated', { physicsId: 'unrelated' })],
      drawOrder: ['affected', 'unrelated'],
    },
    physics: [physics('affected', 'custom-output'), physics('unrelated', 'FaceAngleX')],
  };
}

describe('カード58: パラメータを消した物理の後始末', () => {
  it('出力先の物理とパーツの参照だけを外し、1回の Undo と Redo で一緒に戻る', () => {
    const initial = modelWithPhysics();
    const store = createProjectStore(initial);
    store.dispatch(removeParameterCommand('custom-output'));
    const deleted = store.get();
    expect(deleted.physics).toEqual([initial.physics[1]]);
    expect(deleted.model.parts.map((p) => p.physicsId)).toEqual([null, 'unrelated']);
    expect(deleted.model.parameters.some((p) => p.id === 'custom-output')).toBe(false);
    expect(() => validateProject(deleted)).not.toThrow();
    store.undo();
    expect(store.get()).toEqual(initial);
    expect(store.canUndo()).toBe(false);
    store.redo();
    expect(store.get()).toEqual(deleted);
  });

  it('前の版で残った参照を開くときに外して知らせ、保存して開き直すと修復の注意が消える', async () => {
    const initial = modelWithPhysics();
    const legacy = {
      ...initial,
      model: { ...initial.model, parameters: initial.model.parameters.filter((p) => p.id !== 'custom-output') },
    };
    const fs = new MemoryFileSystem();
    const io = createProjectIO(fs);
    const dir = '/c58/legacy-physics';
    await io.save(dir, legacy, {});
    const loaded = await io.load(dir);
    expect(loaded.project.physics).toEqual([initial.physics[1]]);
    expect(loaded.project.model.parts.map((p) => p.physicsId)).toEqual([null, 'unrelated']);
    expect(loaded.report.repairs.join(' ')).toContain('出力先のパラメータが無い物理');
    await io.save(dir, loaded.project, loaded.assetPngs);
    expect((await io.load(dir)).report.repairs).toEqual([]);
  });
});
