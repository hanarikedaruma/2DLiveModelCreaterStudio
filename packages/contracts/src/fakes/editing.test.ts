import { createEmptyProject, type Binding, type Part, type Project } from '@app/schema';
import { describe, expect, it } from 'vitest';
import type { EditorState, KeyEditor } from '../index';
import { FakeAutoSetup, FakeKeyEditor, FakeKeyGenerator, FakeMeshGenerator } from './editing';

const editor: EditorState = {
  mode: 'modeling',

  selectedPartIds: [],
  activeParameterIds: ['FaceAngleX'],
  editorParamValues: { FaceAngleX: 30 },
};

const part: Part = {
  id: 'p1',
  name: 'p1',
  kind: 'image',
  standardType: null,
  assetId: 'a1',
  meshId: 'm1',
  parentId: null,
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  pivot: { x: 5, y: 5 },
  opacity: 0.8,
  blendMode: 'normal',
  depth: 0,
  mask: null,
  physicsId: null,
  visible: true,
  locked: false,
};

function sample(): Project {
  const p = createEmptyProject('t');
  return {
    ...p,
    model: {
      ...p.model,
      parts: [part, { ...part, id: 'p2' }],
      meshes: [
        {
          id: 'm1',
          vertices: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
          uvs: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
          triangles: [],
          density: 'standard',
          edited: false,
        },
      ],
      warps: [
        {
          id: 'w1',
          partId: 'p1',
          columns: 1,
          rows: 1,
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: 1, y: 1 },
          ],
        },
      ],
    },
  };
}

describe('FakeMeshGenerator', () => {
  it('画像全体を覆う四角形（三角形2枚）', () => {
    const out = new FakeMeshGenerator().generate({ width: 10, height: 20 } as ImageData, { x: 5, y: 6 }, 'standard');
    expect(out.vertices).toEqual([
      { x: 5, y: 6 },
      { x: 15, y: 6 },
      { x: 15, y: 26 },
      { x: 5, y: 26 },
    ]);
    expect(out.uvs[2]).toEqual({ x: 1, y: 1 });
    expect(out.triangles).toEqual([
      [0, 1, 2],
      [0, 2, 3],
    ]);
  });
});

describe('FakeKeyGenerator・FakeAutoSetup', () => {
  it('何も変えない', () => {
    const p = sample();
    const binding: Binding = {
      id: 'b1',
      target: { type: 'part', id: 'p1' },
      channel: 'transform',
      parameterIds: ['FaceAngleX'],
      keyValues: [[-30, 0, 30]],
      keys: [],
      generation: 'linear',
      divisions: null,
    };
    const gen = new FakeKeyGenerator();
    expect(gen.linear(binding, 4)).toBe(binding);
    const model = { ...p.model, bindings: [binding] };
    expect(gen.depthParallax(model, 'FaceAngleX')).toEqual([binding]);
    expect(gen.depthParallax(model, 'FaceAngleY')).toEqual([]);
    const { command, warnings } = new FakeAutoSetup().plan(p);
    expect(command.apply(p)).toBe(p);
    expect(warnings).toEqual([]);
  });
});

describe('FakeKeyEditor', () => {
  const ke: KeyEditor = new FakeKeyEditor();

  it('パラメータを選んでいても基準状態のパーツを変える', () => {
    const p = sample();
    const cmd = ke.transformEdit(p, editor, ['p1'], {
      dPosition: { x: 3, y: 4 },
      dRotation: 15,
      scaleFactor: { x: 2, y: 0.5 },
      opacity: 1.6,
      dPivot: { x: 1, y: -1 },
    });
    if (cmd === 'needsKey') throw new Error('needsKey になった');
    const out = cmd.apply(p);
    expect(out.model.parts[0]).toMatchObject({
      position: { x: 3, y: 4 },
      rotation: 15,
      scale: { x: 2, y: 0.5 },
      opacity: 1, // 0..1 に収める
      pivot: { x: 6, y: 4 },
    });
    expect(out.model.parts[1]).toBe(p.model.parts[1]);
    expect(p.model.parts[0]!.position).toEqual({ x: 0, y: 0 }); // 元は変えない
    expect(out.model.bindings).toEqual([]);
  });

  it('メッシュの基準頂点・ワープの制御点を動かす', () => {
    const p = sample();
    const meshCmd = ke.pointsEdit(p, editor, { kind: 'mesh', meshId: 'm1' }, [{ index: 1, d: { x: 2, y: 3 } }]);
    const warpCmd = ke.pointsEdit(p, editor, { kind: 'warp', warpId: 'w1' }, [{ index: 3, d: { x: -1, y: 0 } }]);
    if (meshCmd === 'needsKey' || warpCmd === 'needsKey') throw new Error('needsKey になった');
    expect(meshCmd.apply(p).model.meshes[0]!.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 3 },
    ]);
    expect(warpCmd.apply(p).model.warps[0]!.points[3]).toEqual({ x: 0, y: 1 });
  });

  it('キーの追加は何も変えない', () => {
    const p = sample();
    expect(ke.addKeyAtCurrentValue(p, editor, { partId: 'p1' }).apply(p)).toBe(p);
  });
});
