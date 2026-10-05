import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Binding, Mesh, Model, Project, Vec2 } from '@app/schema';
import {
  FakePipeline,
  emptyDeltas,
  transformPoint,
  type AssetRepository,
  type BindingEvaluator,
  type DeformPipeline,
  type DeformedModel,
  type DrawItem,
  type TargetDeltas,
} from '@app/contracts';
import type { ProjectStoreWithHistory } from '@app/core';
import { patchPart } from '@app/core';
import { registry } from '../../../shell/registry';
import { register as registerCanvasEdit } from '../canvas';
import { NEEDS_KEY_MESSAGE, PREVIEW_OFF_BASE_MESSAGE } from '../canvas/liveEdit';
import { effectivePose } from '../canvas/parts';
import {
  KeyedStubEditor,
  RecordingContext,
  keyBinding,
  openSample,
  pointer,
  redrawn,
  renderShell,
  sampleProject,
  stubSize,
} from '../canvas/testUtils';
import { meshEditor, register } from './index';
import { displayPositions } from './meshTool';
import { TRANSFER_CONFIRM_MESSAGE } from './remesh';
import { appearanceError } from './testAppearance';

// メッシュの頂点（と頂点の差分）を使う変形。メッシュの無いパーツは仮実装と同じ
class MeshPipeline implements DeformPipeline {
  private readonly fake: FakePipeline;
  constructor(assetsOf: ConstructorParameters<typeof FakePipeline>[0]) {
    this.fake = new FakePipeline(assetsOf);
  }
  deform(model: Model, deltas: TargetDeltas): DeformedModel {
    const items = this.fake.deform(model, deltas).items.map((item): DrawItem => {
      const part = model.parts.find((p) => p.id === item.partId)!;
      const mesh = part.meshId ? model.meshes.find((m) => m.id === part.meshId) : undefined;
      if (!mesh) return item;
      const d = deltas.vertices[mesh.id];
      const pose = effectivePose(part, deltas.transforms[part.id]);
      const points = mesh.vertices.map((v, i) =>
        transformPoint(pose, { x: v.x + (d?.[i * 2] ?? 0), y: v.y + (d?.[i * 2 + 1] ?? 0) }),
      );
      return {
        ...item,
        positions: new Float32Array(points.flatMap((p) => [p.x, p.y])),
        uvs: new Float32Array(mesh.uvs.flatMap((p) => [p.x, p.y])),
        indices: new Uint32Array(mesh.triangles.flat()),
      };
    });
    return { items, byPartId: Object.fromEntries(items.map((i) => [i.partId, i])) };
  }
}

// 素材の大きさだけを持つ ImageData（仮のメッシュ生成は幅と高さしか見ない）
function withImageData(base: AssetRepository, store: () => Project): AssetRepository {
  return {
    ...base,
    getImageData(id) {
      const asset = store().assets.find((a) => a.id === id);
      return asset
        ? ({ width: asset.width, height: asset.height, data: new Uint8ClampedArray(0) } as ImageData)
        : undefined;
    },
  };
}

const TORSO_CORNERS = [
  { x: 200, y: 840 },
  { x: 800, y: 840 },
  { x: 800, y: 1500 },
  { x: 200, y: 1500 },
];
const torsoMesh = (): Mesh => ({
  id: 'mesh-torso',
  vertices: TORSO_CORNERS,
  uvs: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
  triangles: [
    [0, 1, 2],
    [0, 2, 3],
  ],
  density: 'standard',
  edited: false,
});

function withTorsoMesh(bindings: Binding[] = []): Project {
  const p = sampleProject();
  return {
    ...p,
    model: {
      ...p.model,
      meshes: [torsoMesh()],
      parts: p.model.parts.map((part) => (part.id === 'part-torso' ? { ...part, meshId: 'mesh-torso' } : part)),
      bindings,
    },
  };
}

const zeros = () => TORSO_CORNERS.map(() => ({ x: 0, y: 0 }));
function vertexKeys(count: number): Binding {
  const b = keyBinding('mesh', 'mesh-torso', zeros());
  return { ...b, keys: Array.from({ length: count }, (_, i) => ({ ...b.keys[0]!, coords: [i * 10] })) };
}

let restoreSize: () => void = () => {};
beforeEach(() => {
  registry.reset();
  registerCanvasEdit();
  register();
  restoreSize = stubSize(800, 600);
});
afterEach(() => restoreSize());

async function open(
  project: Project,
  options: { keyEditor?: KeyedStubEditor; vertexDeltas?: Record<string, Float32Array> } = {},
) {
  const evaluator: BindingEvaluator = {
    evaluate: () => ({ ...emptyDeltas(), vertices: options.vertexDeltas ?? {} }),
  };
  const shell = renderShell((base) => ({
    pipeline: new MeshPipeline(() => base.store.get().assets),
    evaluator,
    assets: withImageData(base.assets, () => base.store.get()),
    ...(options.keyEditor ? { keyEditor: options.keyEditor } : {}),
  }));
  await openSample(shell, project);
  const store = shell.services.store as ProjectStoreWithHistory;
  const mesh = () => store.get().model.meshes.find((m) => m.id === 'mesh-torso');
  const torso = () => store.get().model.parts.find((p) => p.id === 'part-torso')!;
  const panel = () => within(document.querySelector<HTMLElement>('[data-panel-id="mesh"]')!);
  act(() => shell.services.editor.set({ selectedPartIds: ['part-torso'] }));
  fireEvent.click(panel().getByRole('button', { name: 'メッシュ編集ツールにする' }));
  return { ...shell, store, mesh, torso, panel, ptr: pointer(shell.canvas) };
}

const near = (a: Vec2, b: Vec2, digits = 3) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

describe('ワイヤーフレーム', () => {
  it('メッシュ編集ツールにでき、選択中の画像パーツのワイヤーフレームを変形後の位置に描く', async () => {
    const project = withTorsoMesh();
    const moved = {
      ...project,
      model: {
        ...project.model,
        parts: project.model.parts.map((p) => (p.id === 'part-torso' ? { ...p, position: { x: 50, y: 0 } } : p)),
      },
    };
    const { canvas, ptr } = await open(moved, {
      vertexDeltas: { 'mesh-torso': new Float32Array([10, 20, 0, 0, 0, 0, 0, 0]) },
    });
    expect(screen.getByRole('button', { name: 'メッシュ編集' }).getAttribute('aria-pressed')).toBe('true');
    await redrawn(canvas, (m) => expect(m.byPartId['part-torso']!.positions[0]).toBeCloseTo(260));

    const ctx = new RecordingContext();
    meshEditor.tool.drawOverlay!(ctx.asContext(), canvas.getState().view);
    // 頂点の差分 (10,20) と position (50,0) を足した位置
    const deformed = [
      { x: 260, y: 860 },
      { x: 850, y: 840 },
      { x: 850, y: 1500 },
      { x: 250, y: 1500 },
    ].map(ptr.toScreen);
    const squares = ctx.named('fillRect').map(([x, y, w, h]) => ({ x: x! + w! / 2, y: y! + h! / 2 }));
    expect(squares).toHaveLength(4);
    squares.forEach((p, i) => near(p, deformed[i]!));
    // 辺は 5 本（四角形と対角線）
    expect(ctx.named('lineTo')).toHaveLength(5);
    const ends = [...ctx.named('moveTo'), ...ctx.named('lineTo')].map(([x, y]) => ({ x: x!, y: y! }));
    for (const p of ends) expect(deformed.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-3)).toBe(true);
  });

  it('変形の結果の頂点の数が合わないときは、頂点の差分と変形から求める', () => {
    const base = withTorsoMesh();
    const model: Model = {
      ...base.model,
      parts: base.model.parts.map((x) => (x.id === 'part-torso' ? { ...x, position: { x: 5, y: 0 } } : x)),
    };
    const part = model.parts.find((x) => x.id === 'part-torso')!;
    const mesh = { ...torsoMesh(), vertices: [...TORSO_CORNERS, { x: 500, y: 1000 }] };
    const deltas = { ...emptyDeltas(), vertices: { 'mesh-torso': new Float32Array([1, 2, 0, 0, 0, 0, 0, 0, 0, 0]) } };
    const four = new FakePipeline(() => base.assets).deform(model, deltas);
    expect(four.byPartId['part-torso']!.positions).toHaveLength(8);
    const points = displayPositions(model, deltas, four, part, mesh);
    expect(points).toHaveLength(5);
    near(points[0]!, { x: 206, y: 842 });
    near(points[4]!, { x: 505, y: 1000 });
  });
});

describe('頂点のドラッグ', () => {
  it('基準状態: 頂点が動き、edited が true になる。1回のドラッグが1回の Undo', async () => {
    const { ptr, mesh, store } = await open(withTorsoMesh());
    ptr.drag({ x: 800, y: 1500 }, { x: 830, y: 1520 });
    near(mesh()!.vertices[2]!, { x: 830, y: 1520 });
    expect(mesh()!.edited).toBe(true);
    expect(store.undoLabel()).toBe('頂点の移動');
    act(() => store.undo());
    expect(mesh()!.vertices[2]).toEqual({ x: 800, y: 1500 });
    expect(mesh()!.edited).toBe(false);
    expect(store.canUndo()).toBe(false);
  });

  it('パーツが拡縮されていれば、見た目の移動量を基準の頂点の座標に直す', async () => {
    const { ptr, mesh, store, canvas } = await open(withTorsoMesh());
    // ピボット (500,1170) を中心に横 2 倍: 頂点 2 は (1100,1500) に見える
    act(() => store.dispatch(patchPart('拡縮', 'part-torso', { scale: { x: 2, y: 1 } })));
    await redrawn(canvas, (m) => expect(m.byPartId['part-torso']!.positions[4]).toBeCloseTo(1100));
    ptr.drag({ x: 1100, y: 1500 }, { x: 1140, y: 1500 });
    near(mesh()!.vertices[2]!, { x: 820, y: 1500 });
  });

  it('キー: 編集中のパラメータがあれば KeyEditor がキーを変え、基準の頂点とキーはそのまま残る', async () => {
    const keyEditor = new KeyedStubEditor();
    const { ptr, mesh, store, services } = await open(withTorsoMesh([vertexKeys(1)]), { keyEditor });
    act(() => services.editor.set({ activeParameterIds: ['FaceAngleX'] }));
    ptr.drag({ x: 800, y: 1500 }, { x: 830, y: 1520 });
    expect(screen.queryByText(NEEDS_KEY_MESSAGE)).toBeNull();
    const b = store.get().model.bindings[0]!;
    near((b.keys[0]!.delta as Vec2[])[2]!, { x: 30, y: 20 });
    expect(mesh()!.vertices).toEqual(TORSO_CORNERS);
    expect(mesh()!.edited).toBe(false);
    expect(store.get().model.bindings).toHaveLength(1);
    act(() => store.undo());
    expect((store.get().model.bindings[0]!.keys[0]!.delta as Vec2[])[2]).toEqual({ x: 0, y: 0 });
  });

  it('プレビューが基準状態と違う間は、頂点を動かさずに知らせる。値を戻すと動かせる（I-046）', async () => {
    const { ptr, mesh, store, services } = await open(withTorsoMesh());
    // 表情を作っている途中と同じ状態: 編集中のパラメータは無く、プレビューの値だけがデフォルト値でない
    act(() => services.editor.set({ activeParameterIds: [], editorParamValues: { FaceAngleX: 30 } }));
    ptr.drag({ x: 800, y: 1500 }, { x: 830, y: 1520 });
    expect(mesh()!.vertices).toEqual(TORSO_CORNERS);
    expect(store.canUndo()).toBe(false);
    expect(screen.queryAllByText(PREVIEW_OFF_BASE_MESSAGE)).toHaveLength(1); // 1回のドラッグで1回だけ
    expect(services.editor.get().editorParamValues).toEqual({ FaceAngleX: 30 });

    act(() => services.editor.set({ editorParamValues: {} }));
    ptr.drag({ x: 800, y: 1500 }, { x: 830, y: 1520 });
    near(mesh()!.vertices[2]!, { x: 830, y: 1520 });
  });

  it("'needsKey' なら確認し、承認されたらキーを足してから編集する", async () => {
    const keyEditor = new KeyedStubEditor();
    const { ptr, store, services } = await open(withTorsoMesh(), { keyEditor });
    act(() => services.editor.set({ activeParameterIds: ['FaceAngleX'] }));
    ptr.drag({ x: 200, y: 840 }, { x: 180, y: 830 });
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }));
    await waitFor(() => expect(store.get().model.bindings).toHaveLength(1));
    await meshEditor.settled();
    expect(keyEditor.calls.addKey).toEqual(['mesh-torso']);
    near((store.get().model.bindings[0]!.keys[0]!.delta as Vec2[])[0]!, { x: -20, y: -10 });
    act(() => store.undo());
    expect(store.get().model.bindings).toHaveLength(0);
    expect(store.canUndo()).toBe(false);
  });

  it('矩形で複数の頂点を選び、まとめて動かす', async () => {
    const { ptr, mesh, panel } = await open(withTorsoMesh());
    expect(panel().getByRole('button', { name: '選んだ頂点を削除' })).toHaveProperty('disabled', true);
    ptr.drag({ x: 150, y: 800 }, { x: 850, y: 900 });
    expect(meshEditor.selection.get()).toEqual({ meshId: 'mesh-torso', indices: [0, 1] });
    expect(panel().getByRole('button', { name: '選んだ頂点を削除' })).toHaveProperty('disabled', false);
    ptr.drag({ x: 200, y: 840 }, { x: 220, y: 850 });
    near(mesh()!.vertices[0]!, { x: 220, y: 850 });
    near(mesh()!.vertices[1]!, { x: 820, y: 850 });
    expect(mesh()!.vertices[2]).toEqual({ x: 800, y: 1500 });
    // Shift で足す
    ptr.drag({ x: 150, y: 1450 }, { x: 250, y: 1550 }, { shiftKey: true });
    expect(meshEditor.selection.get().indices).toEqual([0, 1, 3]);
  });
});

describe('頂点の追加・削除・自動生成', () => {
  it('ダブルクリックで追加し、Delete で削除する。三角形が作り直され、Undo できる', async () => {
    const { ptr, mesh, store, panel } = await open(withTorsoMesh());
    const p = { x: 500, y: 1200 };
    ptr.click(p);
    ptr.click(p);
    expect(mesh()!.vertices).toHaveLength(5);
    near(mesh()!.vertices[4]!, p);
    expect(mesh()!.triangles).toHaveLength(4);
    expect(mesh()!.uvs[4]!.x).toBeCloseTo(0.5);
    expect(mesh()!.edited).toBe(true);
    expect(meshEditor.selection.get().indices).toEqual([4]);
    expect(panel().getByTestId('mesh-stats').textContent).toBe('頂点 5・三角形 4');

    fireEvent.keyDown(screen.getByTestId('canvas-stage'), { key: 'Delete' });
    expect(mesh()!.vertices).toHaveLength(4);
    expect(mesh()!.triangles).toHaveLength(2);
    expect(store.undoLabel()).toBe('頂点の削除');

    act(() => store.undo());
    expect(mesh()!.vertices).toHaveLength(5);
    act(() => store.undo());
    expect(mesh()!).toEqual(torsoMesh());
    expect(store.canUndo()).toBe(false);
  });

  it('輪郭の頂点をパネルのボタンで消すと、残りで三角形を作り直す', async () => {
    const { ptr, mesh, panel } = await open(withTorsoMesh());
    ptr.click({ x: 800, y: 840 });
    fireEvent.click(panel().getByRole('button', { name: '選んだ頂点を削除' }));
    expect(mesh()!.vertices).toEqual([TORSO_CORNERS[0], TORSO_CORNERS[2], TORSO_CORNERS[3]]);
    expect(mesh()!.triangles).toHaveLength(1);
  });

  it('できないときは知らせる（3つより少なくする・画像の外に足す）', async () => {
    const { ptr, mesh } = await open(withTorsoMesh());
    ptr.drag({ x: 150, y: 800 }, { x: 850, y: 900 });
    ptr.click({ x: 200, y: 1500 }, { shiftKey: true });
    fireEvent.keyDown(screen.getByTestId('canvas-stage'), { key: 'Delete' });
    expect(await screen.findByText('頂点は3つより少なくできない')).toBeTruthy();
    expect(mesh()!.vertices).toHaveLength(4);
    // 胴体の素材の右（x > 800）。顔などのパーツも無い所
    ptr.click({ x: 900, y: 1300 });
    ptr.click({ x: 900, y: 1300 });
    expect(await screen.findByText('画像の外には頂点を追加できない')).toBeTruthy();
    expect(mesh()!.vertices).toHaveLength(4);
  });

  it('[自動生成] でメッシュを作ってパーツに付ける（standard）。Undo できる', async () => {
    const { store, panel, torso } = await open(sampleProject());
    expect(panel().getByTestId('mesh-stats').textContent).toBe('メッシュはまだ無い');
    fireEvent.click(panel().getByRole('button', { name: '自動生成' }));
    await meshEditor.settled();
    const meshId = torso().meshId!;
    const mesh = store.get().model.meshes.find((m) => m.id === meshId)!;
    expect(mesh).toMatchObject({ vertices: TORSO_CORNERS, density: 'standard', edited: false });
    expect(mesh.triangles).toHaveLength(2);
    expect(panel().getByTestId('mesh-stats').textContent).toBe('頂点 4・三角形 2');
    expect(store.undoLabel()).toBe('メッシュの自動生成');
    act(() => store.undo());
    expect(torso().meshId).toBeNull();
    expect(store.get().model.meshes).toEqual([]);
  });
});

describe('キーがあるときの形の変更（カード28: リセットから転写に替えた）', () => {
  // 角ごとに違う差分（なめらかでない変形でも、旧い頂点の差分はそのまま残る）
  const CORNER_DELTAS = [
    { x: 10, y: 0 },
    { x: 30, y: -20 },
    { x: 50, y: 40 },
    { x: -10, y: 60 },
  ];
  function cornerKeys(count: number): Binding {
    const b = keyBinding('mesh', 'mesh-torso', CORNER_DELTAS);
    return { ...b, keys: Array.from({ length: count }, (_, i) => ({ ...b.keys[0]!, coords: [i * 10] })) };
  }
  const keysOf = (project: Project) =>
    project.model.bindings.find((b) => b.id === 'key-mesh-mesh-torso')!.keys.map((k) => k.delta as Vec2[]);

  it('「変形を新しいメッシュへ移します」と確認し、承認されたらキーを新しいメッシュへ移して追加する（1回の Undo）', async () => {
    const other = { ...keyBinding('mesh', 'mesh-other', []), id: 'other' };
    const { ptr, mesh, store } = await open(withTorsoMesh([cornerKeys(2), other]));
    const before = store.get();
    const p = { x: 500, y: 1200 };
    ptr.click(p);
    ptr.click(p);
    expect(await screen.findByText(TRANSFER_CONFIRM_MESSAGE)).toBeTruthy();
    expect(TRANSFER_CONFIRM_MESSAGE).toBe('変形を新しいメッシュへ移します');
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    await meshEditor.settled();
    expect(store.get()).toBe(before);

    ptr.click(p);
    ptr.click(p);
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }));
    await meshEditor.settled();
    expect(mesh()!.vertices).toHaveLength(5);
    // キーは消えずに 5 頂点ぶんになる。旧い頂点の差分はそのまま、足した頂点は旧いメッシュでの補間
    expect(store.get().model.bindings.map((b) => b.id)).toEqual(['key-mesh-mesh-torso', 'other']);
    const keys = keysOf(store.get());
    expect(keys).toHaveLength(2);
    for (const d of keys) {
      expect(d.slice(0, 4)).toEqual(CORNER_DELTAS);
      // (500,1200) は三角形 (0,2,3) の中: 重心座標は 頂点0 が 5/11、頂点2 が 1/2、頂点3 が 1/22
      near(d[4]!, { x: (5 / 11) * 10 + 0.5 * 50 + (1 / 22) * -10, y: 0.5 * 40 + (1 / 22) * 60 });
    }
    expect(store.get().model.bindings[1]).toBe(before.model.bindings[1]);
    // 見た目（素材の各点の変形後の位置）がほぼ変わらない
    const error = appearanceError({ mesh: torsoMesh(), deltas: CORNER_DELTAS }, { mesh: mesh()!, deltas: keys[0] });
    expect(error.samples).toBeGreaterThan(400);
    expect(error.max).toBeLessThan(3); // 差分は最大 60px。ずれは三角形の張り方が変わる所だけ（2px ほど）
    expect(store.undoLabel()).toBe('頂点の追加');
    act(() => store.undo());
    expect(store.get().model).toBe(before.model);
    expect(store.canUndo()).toBe(false);
  });

  it('頂点の削除でもキーを移す。残る頂点の差分はそのまま', async () => {
    const five = { ...torsoMesh(), vertices: [...TORSO_CORNERS, { x: 500, y: 1170 }] };
    const fiveTriangles: [number, number, number][] = [
      [0, 1, 4],
      [1, 2, 4],
      [2, 3, 4],
      [3, 0, 4],
    ];
    // 一様な変形（全頂点 (7,-3)）と、中央を持ち上げる変形
    const uniform = five.vertices.map(() => ({ x: 7, y: -3 }));
    const bump = five.vertices.map((_, i) => (i === 4 ? { x: 0, y: -40 } : { x: 0, y: 0 }));
    const b = keyBinding('mesh', 'mesh-torso', uniform);
    const binding = { ...b, keys: [b.keys[0]!, { ...b.keys[0]!, coords: [0], delta: bump }] };
    const project = withTorsoMesh([binding]);
    const { ptr, mesh, store } = await open({
      ...project,
      model: {
        ...project.model,
        meshes: [{ ...five, uvs: [...five.uvs, { x: 0.5, y: 0.5 }], triangles: fiveTriangles }],
      },
    });
    ptr.click({ x: 500, y: 1170 });
    expect(meshEditor.selection.get().indices).toEqual([4]);
    fireEvent.keyDown(screen.getByTestId('canvas-stage'), { key: 'Delete' });
    expect(await screen.findByText(TRANSFER_CONFIRM_MESSAGE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await meshEditor.settled();
    expect(mesh()!.vertices).toEqual(TORSO_CORNERS);
    const [u, k] = keysOf(store.get());
    expect(u).toEqual(TORSO_CORNERS.map(() => ({ x: 7, y: -3 })));
    expect(k).toEqual(TORSO_CORNERS.map(() => ({ x: 0, y: 0 })));
    expect(store.undoLabel()).toBe('頂点の削除');
  });

  it('[自動生成] でもキーを移す（同じ形なら差分は変わらない）', async () => {
    const { store, panel } = await open(withTorsoMesh([cornerKeys(3)]));
    fireEvent.click(panel().getByRole('button', { name: '自動生成' }));
    expect(await screen.findByText(TRANSFER_CONFIRM_MESSAGE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await meshEditor.settled();
    expect(keysOf(store.get())).toEqual([CORNER_DELTAS, CORNER_DELTAS, CORNER_DELTAS]);
    expect(store.get().model.meshes[0]).toMatchObject({ id: 'mesh-torso', density: 'standard', edited: false });
    expect(store.undoLabel()).toBe('メッシュの自動生成');
  });

  it('[自動生成] はいまの細かさで作り直す', async () => {
    const project = withTorsoMesh();
    const { store, panel } = await open({
      ...project,
      model: { ...project.model, meshes: [{ ...torsoMesh(), density: 'smooth', edited: true }] },
    });
    fireEvent.click(panel().getByRole('button', { name: '自動生成' }));
    await meshEditor.settled();
    expect(store.get().model.meshes[0]).toMatchObject({ density: 'smooth', edited: false });
  });
});

describe('パーツの切り替え', () => {
  it('メッシュの外で別のパーツを押すと、そのパーツに切り替える', async () => {
    const { ptr, services, panel } = await open(withTorsoMesh());
    ptr.click({ x: 400, y: 650 });
    expect(services.editor.get().selectedPartIds).toEqual(['part-face']);
    expect(panel().getByText('顔')).toBeTruthy();
    expect(panel().getByTestId('mesh-stats').textContent).toBe('メッシュはまだ無い');
  });
});
