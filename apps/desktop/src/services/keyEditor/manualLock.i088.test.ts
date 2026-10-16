import { describe, expect, it } from 'vitest';
import { createKeyGenerator } from '@app/core';
import { createKeyEditor } from './index';
import { editorAt, part, projectWith } from './testing';

describe('I-088 手動キーの保護', () => {
  it.each(['transform', 'mesh', 'warp'] as const)('%s の追加・編集したキーをロックし、再補間で残す', (kind) => {
    const original = projectWith({
      parameters: [{ id: 'p', name: 'テスト', groupId: 'face', min: -1, max: 1, default: 0, standard: false }],
      parts: [part('face', { meshId: 'm' })],
      meshes: [
        {
          id: 'm',
          vertices: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 0, y: 10 },
          ],
          uvs: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
          ],
          triangles: [[0, 1, 2]],
          density: 'standard',
          edited: false,
        },
      ],
      warps: [
        {
          id: 'w',
          partId: 'face',
          columns: 1,
          rows: 1,
          bounds: { x: 0, y: 0, width: 10, height: 10 },
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 0, y: 10 },
            { x: 10, y: 10 },
          ],
        },
      ],
    });
    const editor = editorAt({ p: 0.5 });
    const keyEditor = createKeyEditor();
    const target =
      kind === 'transform'
        ? { partId: 'face' }
        : kind === 'mesh'
          ? { kind: 'mesh' as const, meshId: 'm' }
          : { kind: 'warp' as const, warpId: 'w' };
    const added = keyEditor.addKeyAtCurrentValue(original, editor, target).apply(original);
    const addedKey = added.model.bindings[0]!.keys.find((k) => k.coords[0] === 0.5)!;
    expect(addedKey).toMatchObject({ source: 'manual', locked: true });
    // 一度解除したキーも、もう一度手で編集したら保護する。
    const unlocked = {
      ...added,
      model: {
        ...added.model,
        bindings: added.model.bindings.map((b) => ({ ...b, keys: b.keys.map((k) => ({ ...k, locked: false })) })),
      },
    };
    const command =
      kind === 'transform'
        ? keyEditor.transformEdit(unlocked, editor, ['face'], { dRotation: 5 })
        : keyEditor.pointsEdit(
            unlocked,
            editor,
            kind === 'mesh' ? { kind: 'mesh', meshId: 'm' } : { kind: 'warp', warpId: 'w' },
            [{ index: 0, d: { x: 2, y: 3 } }],
          );
    if (command === 'needsKey') throw new Error('追加したキーが無い');
    const edited = command.apply(unlocked);
    const binding = edited.model.bindings[0]!;
    const manual = binding.keys.find((k) => k.coords[0] === 0.5)!;
    expect(manual).toMatchObject({ source: 'manual', locked: true });
    expect(binding.keys.find((k) => k.coords[0] === 0)).toMatchObject({ source: 'auto', locked: false });
    const generator = createKeyGenerator({ parameters: () => edited.model.parameters });
    const regenerated = generator.regenerate({ ...binding, generation: 'ease', divisions: 4 }, edited.model);
    expect(regenerated.keys.find((k) => k.coords[0] === 0.5)).toBe(manual);
    expect(original.model.bindings).toEqual([]);
  });
});
