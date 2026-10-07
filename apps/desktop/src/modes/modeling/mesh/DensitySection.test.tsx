import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject, type Binding, type Mesh, type Part, type Project, type Vec2 } from '@app/schema';
import type { AssetRepository, DrawItem } from '@app/contracts';
import type { ProjectStoreWithHistory } from '@app/core';
import { createBindingEvaluator, createDeformPipeline, createMeshGenerator } from '@app/core';
import { registry } from '../../../shell/registry';
import { register as registerCanvasEdit } from '../canvas';
import { renderShell, stubSize } from '../canvas/testUtils';
import { register as registerStructure } from '../structure';
import { testAsset } from '../warp/testProject';
import { MESH_DENSITY_SECTION_ID, meshEditor, register } from './index';
import { TRANSFER_CONFIRM_MESSAGE } from './remesh';
import { alphaImage, appearanceError } from './testAppearance';
import { densityKeyError } from './DensitySection';

// 画像パーツ p（素材 400×300、キャンバスの (300,350) から。中は楕円）とグループ g
const OFFSET: Vec2 = { x: 300, y: 350 };
const ALPHA = alphaImage(400, 300, (x, y) => ((x - 200) / 190) ** 2 + ((y - 150) / 140) ** 2 <= 1);
const CENTER: Vec2 = { x: OFFSET.x + 200, y: OFFSET.y + 150 };
// なめらかな変形（顔を横へ向けたような、中央ほど大きく動く横の移動と少しの回転）。最大 30px ほど
function field(p: Vec2): Vec2 {
  const nx = (p.x - CENTER.x) / 200;
  const ny = (p.y - CENTER.y) / 150;
  return { x: 30 * (1 - ny * ny) - 6 * ny, y: 10 * nx * nx + 5 * nx };
}

function part(id: string, patch: Partial<Part> = {}): Part {
  return {
    id,
    name: id,
    kind: 'image',
    standardType: null,
    assetId: 'asset-p',
    meshId: null,
    parentId: null,
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    pivot: { x: 500, y: 500 },
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

function generated(density: 'light' | 'standard' | 'smooth', patch: Partial<Mesh> = {}): Mesh {
  return { id: 'mesh-p', ...createMeshGenerator().generate(ALPHA, OFFSET, density), density, edited: false, ...patch };
}

// FaceAngleX = 30 に変形のキー（0 は差分なし）
function vertexBinding(mesh: Mesh): Binding {
  return {
    id: 'bv',
    target: { type: 'mesh', id: mesh.id },
    channel: 'vertices',
    parameterIds: ['FaceAngleX'],
    keyValues: [[0, 30]],
    keys: [
      { coords: [0], delta: mesh.vertices.map(() => ({ x: 0, y: 0 })), source: 'manual', locked: false },
      { coords: [30], delta: mesh.vertices.map(field), source: 'manual', locked: false },
    ],
    generation: 'linear',
    divisions: null,
  };
}

function testProject(mesh: Mesh | null, keyed = true): Project {
  const p = createEmptyProject('変形の細かさのテスト');
  return {
    ...p,
    assets: [testAsset('asset-p', OFFSET, 400, 300)],
    model: {
      ...p.model,
      parts: [part('p', { meshId: mesh?.id ?? null }), part('g', { kind: 'group', assetId: null })],
      meshes: mesh ? [mesh] : [],
      drawOrder: ['p'],
      bindings: mesh && keyed ? [vertexBinding(mesh)] : [],
    },
  };
}

function withAlpha(base: AssetRepository): AssetRepository {
  return { ...base, getImageData: (id) => (id === 'asset-p' ? ALPHA : undefined) };
}

let restoreSize: () => void = () => {};
beforeEach(() => {
  registry.reset();
  registerCanvasEdit();
  registerStructure();
  register();
  restoreSize = stubSize(800, 600);
});
afterEach(() => restoreSize());

async function open(project: Project) {
  const shell = renderShell((base) => ({
    pipeline: createDeformPipeline(),
    evaluator: createBindingEvaluator(),
    meshGenerator: createMeshGenerator(),
    assets: withAlpha(base.assets),
  }));
  act(() => shell.services.store.load(project));
  await waitFor(() => expect(shell.canvas.getState().view.scale).toBeGreaterThan(0));
  act(() => shell.services.editor.set({ selectedPartIds: ['p'], editorParamValues: { FaceAngleX: 30 } }));
  const store = shell.services.store as ProjectStoreWithHistory;
  const sectionEl = () => document.querySelector<HTMLElement>(`[data-section-id="${MESH_DENSITY_SECTION_ID}"]`);
  const radio = (name: string) => within(sectionEl()!).getByRole('radio', { name }) as HTMLInputElement;
  const mesh = () => store.get().model.meshes.find((m) => m.id === store.get().model.parts[0]!.meshId);
  // いま描いている p の三角形（変形後の位置と uv）
  const drawn = () => {
    const item = shell.canvas.lastDeformed()?.byPartId['p'];
    return item ? shapeOf(item) : null;
  };
  return { ...shell, store, sectionEl, radio, mesh, drawn };
}

function shapeOf(item: DrawItem) {
  const pairs = (a: Float32Array) =>
    Array.from({ length: a.length / 2 }, (_, i) => ({ x: a[i * 2]!, y: a[i * 2 + 1]! }));
  const triangles: [number, number, number][] = [];
  for (let i = 0; i < item.indices.length; i += 3)
    triangles.push([item.indices[i]!, item.indices[i + 1]!, item.indices[i + 2]!]);
  return { vertices: pairs(item.positions), uvs: pairs(item.uvs), triangles };
}

describe('変形の細かさのセクション', () => {
  it('確認中にモデルが変わったら、古い誤差の承認でメッシュを置き換えない', async () => {
    const shell = await open(testProject(generated('standard')));
    fireEvent.click(shell.radio('軽い'));
    await screen.findByText(/最大ずれ.*px/);
    act(() => shell.store.dispatch({ label: '名前を変える', apply: (p) => ({ ...p, name: '変更後' }) }));
    const changed = shell.store.get();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await screen.findByText(/確認中にモデルが変わった/)).toBeTruthy();
    expect(shell.store.get()).toBe(changed);
    expect(shell.mesh()!.density).toBe('standard');
  });

  it('「軽い」で失われる中心の20pxの変形を、全キーの比較で20pxと算出する', () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const old: Mesh = {
      ...generated('standard'),
      id: 'm',
      vertices: [...corners, { x: 50, y: 50 }],
      triangles: [
        [0, 1, 4],
        [1, 2, 4],
        [2, 3, 4],
        [3, 0, 4],
      ],
    };
    const b: Binding = {
      ...vertexBinding(old),
      target: { type: 'mesh', id: 'm' },
      keys: [
        { ...vertexBinding(old).keys[0]!, delta: old.vertices.map(() => ({ x: 0, y: 0 })) },
        { ...vertexBinding(old).keys[1]!, delta: old.vertices.map((_, i) => ({ x: i === 4 ? 20 : 0, y: 0 })) },
      ],
    };
    const before = testProject(old, false);
    before.model.bindings = [b];
    const after: Project = {
      ...before,
      model: {
        ...before.model,
        meshes: [
          {
            ...old,
            vertices: corners,
            triangles: [
              [0, 1, 2],
              [0, 2, 3],
            ],
          },
        ],
        bindings: [{ ...b, keys: b.keys.map((k) => ({ ...k, delta: corners.map(() => ({ x: 0, y: 0 })) })) }],
      },
    };
    expect(densityKeyError(before, after, 'm')).toEqual({ max: 20, keys: 2 });
  });

  it('「パーツの設定」の中に、画像パーツを1つ選んだときだけ出る。いまの細かさが選ばれている', async () => {
    const shell = await open(testProject(generated('standard')));
    const settings = within(document.querySelector<HTMLElement>('[data-panel-id="partSettings"]')!);
    expect(settings.getByRole('radiogroup', { name: '変形の細かさ' })).toBeTruthy();
    expect(['軽い', '標準', 'なめらか'].map((n) => shell.radio(n).checked)).toEqual([false, true, false]);
    act(() => shell.services.editor.set({ selectedPartIds: ['g'] }));
    expect(within(shell.sectionEl()!).queryByRole('radiogroup')).toBeNull();
    act(() => shell.services.editor.set({ selectedPartIds: ['p', 'g'] }));
    expect(within(shell.sectionEl()!).queryByRole('radiogroup')).toBeNull();
    act(() => shell.services.editor.set({ selectedPartIds: [] }));
    expect(within(shell.sectionEl()!).queryByRole('radiogroup')).toBeNull();
  });

  it('手で編集したメッシュなら案内を出す', async () => {
    const shell = await open(testProject(generated('light', { edited: true })));
    expect(shell.radio('軽い').checked).toBe(true);
    expect(within(shell.sectionEl()!).getByText(/手で編集したメッシュ/)).toBeTruthy();
  });

  it('メッシュが無ければ、選ぶとその細かさで作る。Undo で消える', async () => {
    const shell = await open(testProject(null));
    expect(['軽い', '標準', 'なめらか'].some((n) => shell.radio(n).checked)).toBe(false);
    fireEvent.click(shell.radio('なめらか'));
    await waitFor(() => expect(shell.mesh()).toBeDefined());
    expect(shell.mesh()).toMatchObject({ density: 'smooth', edited: false });
    expect(shell.mesh()!.vertices.length).toBe(generated('smooth').vertices.length);
    expect(shell.radio('なめらか').checked).toBe(true);
    expect(shell.store.undoLabel()).toBe('変形の細かさの変更');
    act(() => shell.store.undo());
    expect(shell.store.get().model.meshes).toEqual([]);
  });

  for (const [label, density] of [
    ['なめらか', 'smooth'],
    ['軽い', 'light'],
  ] as const) {
    it(`標準 → ${label}: 確認してから作り直し、変形を新しいメッシュへ移す。見た目はほぼ変わらず、1回の Undo で戻る`, async () => {
      const shell = await open(testProject(generated('standard')));
      // FaceAngleX = 30 の変形で描かれるまで待つ
      const v0 = generated('standard').vertices[0]!;
      await waitFor(() => expect(shell.drawn()?.vertices[0]?.x).toBeCloseTo(v0.x + field(v0).x, 3));
      const before = shell.store.get();
      const drawnBefore = shell.drawn()!;
      // キャンセルなら何もしない
      fireEvent.click(shell.radio(label));
      expect(await screen.findByText(density === 'light' ? /最大ずれ.*px/ : TRANSFER_CONFIRM_MESSAGE)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
      await waitFor(() => expect(shell.radio(label).disabled).toBe(false));
      expect(shell.store.get()).toBe(before);
      expect(shell.radio('標準').checked).toBe(true);

      fireEvent.click(shell.radio(label));
      fireEvent.click(await screen.findByRole('button', { name: 'OK' }));
      await waitFor(() => expect(shell.mesh()!.density).toBe(density));
      const mesh = shell.mesh()!;
      expect(mesh.id).toBe('mesh-p');
      expect(mesh.vertices).toEqual(generated(density).vertices);
      expect(mesh.vertices.length).not.toBe(before.model.meshes[0]!.vertices.length);
      // キーは消えずに、新しい頂点の数になる
      const keys = shell.store.get().model.bindings[0]!.keys;
      expect(keys.map((k) => (k.delta as Vec2[]).length)).toEqual([mesh.vertices.length, mesh.vertices.length]);
      // 描いた見た目（素材の各点の変形後の位置）がほぼ変わらない。リセットなら 30px ほど動く
      await waitFor(() => expect(shell.drawn()!.vertices.length).toBe(mesh.vertices.length));
      const error = appearanceError(
        { mesh: drawnBefore, deltas: undefined },
        { mesh: shell.drawn()!, deltas: undefined },
      );
      expect(error.samples).toBeGreaterThan(300);
      expect(error.max).toBeLessThan(density === 'light' ? 3 : 1);
      expect(meshEditor.selection.get()).toEqual({ meshId: null, indices: [] });

      expect(shell.store.undoLabel()).toBe('変形の細かさの変更');
      act(() => shell.store.undo());
      expect(shell.store.get().model).toBe(before.model);
      expect(shell.radio('標準').checked).toBe(true);
    });
  }

  it('キーが無くても「軽い」の限界を知らせ、取り消すとメッシュは変えない', async () => {
    const shell = await open(testProject(generated('standard'), false));
    const before = shell.store.get();
    fireEvent.click(shell.radio('軽い'));
    expect(await screen.findByText(/既存の頂点キーは無い/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(shell.radio('軽い').disabled).toBe(false));
    expect(shell.store.get()).toBe(before);
    fireEvent.click(shell.radio('軽い'));
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }));
    await waitFor(() => expect(shell.mesh()!.density).toBe('light'));
    expect(screen.queryByText(TRANSFER_CONFIRM_MESSAGE)).toBeNull();
  });

  it('素材の画像が無ければ知らせて何もしない', async () => {
    const shell = await open(testProject(generated('standard')));
    const before = shell.store.get();
    act(() =>
      shell.services.store.dispatch({
        label: '素材を外す',
        apply: (p) => ({ ...p, model: { ...p.model, parts: p.model.parts.map((x) => ({ ...x, assetId: 'none' })) } }),
      }),
    );
    fireEvent.click(shell.radio('軽い'));
    expect(await screen.findByText('素材の画像が読み込まれていない')).toBeTruthy();
    expect(shell.store.get().model.meshes).toBe(before.model.meshes);
  });
});
