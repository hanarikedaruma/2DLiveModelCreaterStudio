import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject, type Binding, type Part, type Project, type Vec2, type Warp } from '@app/schema';
import { emptyDeltas } from '@app/contracts';
import {
  createBindingEvaluator,
  createDeformPipeline,
  regularWarpPoints,
  type ProjectStoreWithHistory,
} from '@app/core';
import { createKeyEditor } from '../../../services/keyEditor';
import { registry } from '../../../shell/registry';
import { register as registerCanvasEdit } from '../canvas';
import { NEEDS_KEY_MESSAGE, PREVIEW_OFF_BASE_MESSAGE } from '../canvas/liveEdit';
import { keyBinding, pointer, redrawn, renderShell, stubSize } from '../canvas/testUtils';
import { rectMesh, testAsset } from '../warp/testProject';
import { meshEditor, register } from './index';
import { displayPositions } from './meshTool';

const BOUNDS = { x: 200, y: 300, width: 200, height: 200 };
const FLIPPED = [
  { x: 200, y: 500 },
  { x: 400, y: 500 },
  { x: 200, y: 300 },
  { x: 400, y: 300 },
];

function part(id: string, patch: Partial<Part> = {}): Part {
  return {
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
    pivot: { x: 300, y: 400 },
    opacity: 1,
    blendMode: 'normal',
    depth: 0,
    mask: null,
    physicsId: null,
    visible: true,
    locked: false,
    ...patch,
  };
}

function projectWithWarp(points = FLIPPED, patch: Partial<Warp> = {}): Project {
  const project = createEmptyProject('Mesh warp editing');
  return {
    ...project,
    assets: [testAsset('asset-a', { x: 200, y: 300 }, 200, 200)],
    model: {
      ...project.model,
      parts: [part('g'), part('a', { kind: 'image', parentId: 'g', assetId: 'asset-a', meshId: 'mesh-a' })],
      meshes: [rectMesh('mesh-a', 200, 300, 200, 200)],
      warps: [{ id: 'w', partId: 'g', columns: 1, rows: 1, bounds: BOUNDS, points, ...patch }],
      drawOrder: ['a'],
    },
  };
}

let restoreSize = () => {};
beforeEach(() => {
  registry.reset();
  registerCanvasEdit();
  register();
  restoreSize = stubSize(800, 600);
});
afterEach(() => restoreSize());

async function open(project = projectWithWarp()) {
  const shell = renderShell(() => ({
    pipeline: createDeformPipeline(),
    evaluator: createBindingEvaluator(),
    keyEditor: createKeyEditor(),
  }));
  act(() => shell.services.store.load(project));
  await waitFor(() => expect(shell.canvas.lastDeformed()?.items).toHaveLength(1));
  await waitFor(() => expect(shell.canvas.getState().view.scale).toBeCloseTo(0.54));
  act(() => shell.services.editor.set({ selectedPartIds: ['a'] }));
  const panel = within(document.querySelector<HTMLElement>('[data-panel-id="mesh"]')!);
  fireEvent.click(panel.getByRole('button', { name: 'メッシュ編集ツールにする' }));
  const store = shell.services.store as ProjectStoreWithHistory;
  const mesh = () => store.get().model.meshes[0]!;
  const positions = () => {
    const values = shell.canvas.lastDeformed()!.byPartId.a!.positions;
    return mesh().vertices.map((_, i) => ({ x: values[i * 2]!, y: values[i * 2 + 1]! }));
  };
  return { ...shell, store, mesh, positions, ptr: pointer(shell.canvas) };
}

function near(actual: Vec2, expected: Vec2) {
  expect(actual.x).toBeCloseTo(expected.x, 3);
  expect(actual.y).toBeCloseTo(expected.y, 3);
}

describe('Mesh dragging through a warp', () => {
  it.each([
    { x: 0, y: -40 },
    { x: 0, y: 40 },
    { x: -40, y: 0 },
    { x: 40, y: 0 },
  ])('follows the pointer after vertical inversion: %j', async (delta) => {
    const shell = await open();
    const from = shell.positions()[2]!;
    const to = { x: from.x + delta.x, y: from.y + delta.y };
    shell.ptr.drag(from, to);
    await redrawn(shell.canvas, () => near(shell.positions()[2]!, to));
    near(shell.mesh().vertices[2]!, { x: 400 + delta.x, y: 500 - delta.y });
  });

  it('keeps a warped drag in one undo transaction and supports redo', async () => {
    const shell = await open();
    const initial = shell.store.get();
    shell.ptr.drag({ x: 400, y: 300 }, { x: 420, y: 260 });
    near(shell.mesh().vertices[2]!, { x: 420, y: 540 });
    expect(shell.store.undoLabel()).toBe('頂点の移動');
    act(() => shell.store.undo());
    expect(shell.store.get()).toBe(initial);
    expect(shell.store.canUndo()).toBe(false);
    act(() => shell.store.redo());
    await redrawn(shell.canvas, () => near(shell.positions()[2]!, { x: 420, y: 260 }));
  });

  it('moves every selected vertex by the same visible delta under a nonuniform warp', async () => {
    const shell = await open(
      projectWithWarp([
        { x: 200, y: 300 },
        { x: 400, y: 300 },
        { x: 250, y: 500 },
        { x: 500, y: 600 },
      ]),
    );
    const before = shell.positions();
    shell.ptr.drag({ x: 180, y: 280 }, { x: 520, y: 620 });
    expect(meshEditor.selection.get().indices).toEqual([0, 1, 2, 3]);
    shell.ptr.drag(before[0]!, { x: before[0]!.x + 20, y: before[0]!.y + 30 });
    await redrawn(shell.canvas, () => {
      shell.positions().forEach((point, i) => near(point, { x: before[i]!.x + 20, y: before[i]!.y + 30 }));
    });
  });

  it('inverts each selected vertex separately when their local directions are opposite', async () => {
    const shell = await open(
      projectWithWarp([
        { x: 200, y: 300 },
        { x: 400, y: 500 },
        { x: 200, y: 500 },
        { x: 400, y: 300 },
      ]),
    );
    shell.ptr.drag({ x: 190, y: 280 }, { x: 410, y: 310 });
    expect(meshEditor.selection.get().indices).toEqual([0, 2]);
    shell.ptr.drag({ x: 200, y: 300 }, { x: 200, y: 280 });
    near(shell.mesh().vertices[0]!, { x: 200, y: 280 });
    near(shell.mesh().vertices[2]!, { x: 400, y: 520 });
    await redrawn(shell.canvas, () => {
      near(shell.positions()[0]!, { x: 200, y: 280 });
      near(shell.positions()[2]!, { x: 400, y: 280 });
    });
  });

  it('includes rotated and mirrored transforms and nested nonlinear warps', async () => {
    const project = projectWithWarp();
    project.model.parts = [
      part('root', { rotation: 23, scale: { x: -0.8, y: 1.4 } }),
      part('g', { parentId: 'root', rotation: -35, scale: { x: 1.3, y: 0.6 } }),
      part('a', {
        kind: 'image',
        parentId: 'g',
        assetId: 'asset-a',
        meshId: 'mesh-a',
        rotation: 17,
        scale: { x: 1.2, y: 0.9 },
        position: { x: 20, y: -10 },
      }),
    ];
    const bounds = { x: 0, y: 0, width: 1000, height: 1000 };
    project.model.warps.push({
      id: 'outer',
      partId: 'root',
      columns: 2,
      rows: 2,
      bounds,
      points: regularWarpPoints(bounds, 2, 2).map((p) => ({ x: p.x + 0.0001 * p.x * p.y, y: p.y + 0.2 * p.x })),
    });
    const shell = await open(project);
    const from = shell.positions()[2]!;
    const to = { x: from.x + 40, y: from.y - 30 };
    shell.ptr.drag(from, to, undefined, 1);
    await redrawn(shell.canvas, () => near(shell.positions()[2]!, to));
    expect(shell.store.get().model.warps).toEqual(project.model.warps);
    expect(shell.store.get().model.parts).toEqual(project.model.parts);
  });

  it('follows a long drag across warp cells and outside the original bounds', async () => {
    const shell = await open(
      projectWithWarp(
        [
          { x: 200, y: 300 },
          { x: 240, y: 300 },
          { x: 400, y: 300 },
          { x: 200, y: 500 },
          { x: 240, y: 500 },
          { x: 400, y: 500 },
        ],
        { columns: 2 },
      ),
    );
    shell.ptr.drag({ x: 200, y: 300 }, { x: 410, y: 280 }, undefined, 1);
    await redrawn(shell.canvas, () => near(shell.positions()[0]!, { x: 410, y: 280 }));
    near(shell.mesh().vertices[0]!, { x: 406.25, y: 280 });
  });

  it('uses the current warp and vertex keys without changing their base geometry', async () => {
    const project = projectWithWarp(regularWarpPoints(BOUNDS, 1, 1));
    const vertexDeltas = project.model.meshes[0]!.vertices.map((_, i) => (i === 2 ? { x: 10, y: -5 } : { x: 0, y: 0 }));
    const warpBinding: Binding = {
      ...keyBinding('mesh', 'mesh-a', []),
      id: 'warp-key',
      target: { type: 'warp', id: 'w' },
      channel: 'warpPoints',
      keys: [
        {
          coords: [30],
          delta: [
            { x: 0, y: 200 },
            { x: 0, y: 200 },
            { x: 0, y: -200 },
            { x: 0, y: -200 },
          ],
          source: 'manual',
          locked: false,
        },
      ],
    };
    project.model.bindings = [keyBinding('mesh', 'mesh-a', vertexDeltas), warpBinding];
    const shell = await open(project);
    act(() => shell.services.editor.set({ activeParameterIds: ['FaceAngleX'], editorParamValues: { FaceAngleX: 30 } }));
    await redrawn(shell.canvas, () => near(shell.positions()[2]!, { x: 410, y: 305 }));
    shell.ptr.drag({ x: 410, y: 305 }, { x: 440, y: 285 });
    await redrawn(shell.canvas, () => near(shell.positions()[2]!, { x: 440, y: 285 }));
    const binding = shell.store.get().model.bindings.find((b) => b.target.type === 'mesh')!;
    near((binding.keys[0]!.delta as Vec2[])[2]!, { x: 40, y: 15 });
    expect(shell.mesh().vertices).toEqual(project.model.meshes[0]!.vertices);
    expect(shell.store.get().model.warps).toEqual(project.model.warps);
    expect(shell.store.get().model.bindings.find((b) => b.id === 'warp-key')).toEqual(warpBinding);
  });

  it('adds a missing mesh key after confirmation in the warped coordinate space', async () => {
    const project = projectWithWarp();
    project.model.bindings = [
      keyBinding(
        'mesh',
        'mesh-a',
        project.model.meshes[0]!.vertices.map(() => ({ x: 0, y: 0 })),
      ),
    ];
    const shell = await open(project);
    const initial = shell.store.get();
    act(() => shell.services.editor.set({ activeParameterIds: ['FaceAngleX'], editorParamValues: { FaceAngleX: 10 } }));
    shell.ptr.drag({ x: 400, y: 300 }, { x: 420, y: 260 });
    expect(await screen.findByText(NEEDS_KEY_MESSAGE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await meshEditor.settled();
    await redrawn(shell.canvas, () => near(shell.positions()[2]!, { x: 420, y: 260 }));
    const key = shell.store.get().model.bindings[0]!.keys.find((k) => k.coords[0] === 10)!;
    near((key.delta as Vec2[])[2]!, { x: 20, y: 40 });
    expect(shell.mesh().vertices).toEqual(project.model.meshes[0]!.vertices);
    act(() => shell.store.undo());
    expect(shell.store.get()).toBe(initial);
  });

  it('cancels a warped drag without leaving a history entry', async () => {
    const shell = await open();
    const initial = shell.store.get();
    shell.ptr.down({ x: 400, y: 300 });
    shell.ptr.move({ x: 420, y: 260 });
    near(shell.mesh().vertices[2]!, { x: 420, y: 540 });
    fireEvent.keyDown(screen.getByTestId('canvas-stage'), { key: 'Escape' });
    expect(shell.store.get()).toBe(initial);
    expect(shell.store.canUndo()).toBe(false);
  });

  it('returns exactly to the initial geometry and history when dragged back to the start', async () => {
    const shell = await open(
      projectWithWarp([
        { x: 200, y: 300 },
        { x: 400, y: 300 },
        { x: 250, y: 500 },
        { x: 500, y: 600 },
      ]),
    );
    const initial = shell.store.get();
    const from = shell.positions()[0]!;
    shell.ptr.down(from);
    shell.ptr.move({ x: from.x + 40, y: from.y + 30 });
    expect(shell.store.get()).not.toBe(initial);
    shell.ptr.move(from);
    shell.ptr.up(from);
    expect(shell.store.get()).toBe(initial);
    expect(shell.store.canUndo()).toBe(false);
  });

  it('still blocks base edits during an off-base preview', async () => {
    const shell = await open();
    const initial = shell.store.get();
    act(() => shell.services.editor.set({ editorParamValues: { FaceAngleX: 30 } }));
    shell.ptr.drag({ x: 400, y: 300 }, { x: 400, y: 270 });
    expect(shell.store.get()).toBe(initial);
    expect(screen.queryAllByText(PREVIEW_OFF_BASE_MESSAGE)).toHaveLength(1);
  });

  it('does not edit an uninvertible collapsed warp or fall back to a wrong direction', async () => {
    const shell = await open(
      projectWithWarp([
        { x: 200, y: 400 },
        { x: 400, y: 400 },
        { x: 200, y: 400 },
        { x: 400, y: 400 },
      ]),
    );
    const initial = shell.store.get();
    shell.ptr.drag({ x: 200, y: 400 }, { x: 200, y: 370 });
    expect(shell.store.get()).toBe(initial);
    expect(shell.store.canUndo()).toBe(false);
    expect(screen.queryAllByText(/変形.*逆算/)).toHaveLength(1);
  });

  it('retains the last valid edit at a fold and recovers when the pointer returns', async () => {
    const shell = await open(
      projectWithWarp([
        { x: 200, y: 300 },
        { x: 400, y: 500 },
        { x: 200, y: 500 },
        { x: 400, y: 300 },
      ]),
    );
    shell.ptr.down({ x: 200, y: 300 });
    shell.ptr.move({ x: 210, y: 290 });
    await redrawn(shell.canvas, () => near(shell.positions()[0]!, { x: 210, y: 290 }));
    const lastValid = shell.store.get();
    shell.ptr.move({ x: 300, y: 280 });
    expect(shell.store.get()).toBe(lastValid);
    expect(screen.queryAllByText(/変形.*逆算/)).toHaveLength(1);
    shell.ptr.move({ x: 200, y: 270 });
    shell.ptr.up({ x: 200, y: 270 });
    await redrawn(shell.canvas, () => near(shell.positions()[0]!, { x: 200, y: 270 }));
    expect(shell.store.undoLabel()).toBe('頂点の移動');
  });

  it('includes warps in the display fallback before a matching render is available', () => {
    const project = projectWithWarp();
    const mesh = project.model.meshes[0]!;
    const deltas = { ...emptyDeltas(), vertices: { 'mesh-a': new Float32Array([1, 2, 0, 0, 0, 0, 0, 0]) } };
    const positions = displayPositions(project.model, deltas, null, project.model.parts[1]!, mesh);
    near(positions[0]!, { x: 201, y: 498 });
    near(positions[2]!, { x: 400, y: 300 });
  });
});
