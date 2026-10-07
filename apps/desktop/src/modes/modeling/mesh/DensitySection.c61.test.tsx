// カード61（「軽い」を選ぶときのずれの注意・I-016）のテスト。テストの担当は CL（実装の担当は CO）
// メッシュの生成を決まった形にし、ずれを手で計算できるモデルで、画面に出る px の値と取り消しを確かめる。
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject, type Binding, type Mesh, type Part, type Project, type Vec2 } from '@app/schema';
import type { MeshGenerator } from '@app/contracts';
import type { ProjectStoreWithHistory } from '@app/core';
import { registry } from '../../../shell/registry';
import { register as registerCanvasEdit } from '../canvas';
import { renderShell, stubSize } from '../canvas/testUtils';
import { register as registerStructure } from '../structure';
import { testAsset } from '../warp/testProject';
import { MESH_DENSITY_SECTION_ID, register } from './index';

// 素材は (100,100) から 200×200。「標準」は四隅と中心の5頂点（三角形4つ）、「軽い」は四隅だけの4頂点（三角形2つ）。
// 「軽い」の三角形は対角線 0–2 で分けるので、中心 (200,200) はその線の上にあり、四隅の差分の 0 と 2 の平均になる
const CORNERS: Vec2[] = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 300 },
  { x: 100, y: 300 },
];
const CENTER: Vec2 = { x: 200, y: 200 };
const UV_CORNERS: Vec2[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
type Shape = Pick<Mesh, 'vertices' | 'uvs' | 'triangles'>;
const SHAPES: Record<'light' | 'standard' | 'smooth', () => Shape> = {
  light: () => ({
    vertices: CORNERS.map((p) => ({ ...p })),
    uvs: UV_CORNERS.map((p) => ({ ...p })),
    triangles: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  }),
  standard: () => ({
    vertices: [...CORNERS, CENTER].map((p) => ({ ...p })),
    uvs: [...UV_CORNERS, { x: 0.5, y: 0.5 }].map((p) => ({ ...p })),
    triangles: [
      [0, 1, 4],
      [1, 2, 4],
      [2, 3, 4],
      [3, 0, 4],
    ],
  }),
  smooth: () => SHAPES.standard(),
};
const generator: MeshGenerator = { generate: (_alpha, _offset, density) => SHAPES[density]() };
const ALPHA = { width: 200, height: 200, data: new Uint8ClampedArray(200 * 200 * 4), colorSpace: 'srgb' } as ImageData;

const add = (p: Vec2, q: Vec2): Vec2 => ({ x: p.x + q.x, y: p.y + q.y });
const ZERO: Vec2 = { x: 0, y: 0 };

// 四隅は同じだけ動き（「軽い」でも表せる）、中心だけがさらに extra 動く（「軽い」では失われる）
function cornerKey(value: number, corner: Vec2, extra: Vec2) {
  return {
    coords: [value],
    delta: [...CORNERS.map(() => ({ ...corner })), add(corner, extra)],
    source: 'manual' as const,
    locked: false,
  };
}

// FaceAngleX の -30・0・30 にキー。
// -30: 四隅 (-6,0)、中心はさらに (9,-12) → 「軽い」では中心が (-6,0) になり、ずれは |(-9,12)| = 15px
//   0: 差分なし
//  30: 四隅 (4,2)、中心はさらに (12,-5) → ずれは |(-12,5)| = 13px
// いま編集中の値（30）のキーより、ほかのキー（-30）のずれが大きいので、全部のキーを比べていれば 15px になる
function localBinding(): Binding {
  return {
    id: 'bv',
    target: { type: 'mesh', id: 'mesh-p' },
    channel: 'vertices',
    parameterIds: ['FaceAngleX'],
    keyValues: [[-30, 0, 30]],
    keys: [
      cornerKey(-30, { x: -6, y: 0 }, { x: 9, y: -12 }),
      cornerKey(0, ZERO, ZERO),
      cornerKey(30, { x: 4, y: 2 }, { x: 12, y: -5 }),
    ],
    generation: 'linear',
    divisions: null,
  };
}

// 1次式の変形（どの三角形の中でも線形なので「軽い」でも表せる）: d = (0.1(x-100)+5, 0.05(y-100)-3)
function affineBinding(): Binding {
  const field = (p: Vec2): Vec2 => ({ x: 0.1 * (p.x - 100) + 5, y: 0.05 * (p.y - 100) - 3 });
  return {
    ...localBinding(),
    keyValues: [[0, 30]],
    keys: [
      { coords: [0], delta: [...CORNERS, CENTER].map(() => ({ ...ZERO })), source: 'manual', locked: false },
      { coords: [30], delta: [...CORNERS, CENTER].map(field), source: 'manual', locked: false },
    ],
  };
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
    pivot: { x: 200, y: 200 },
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

function testProject(binding: Binding): Project {
  const p = createEmptyProject('カード61のテスト');
  const mesh: Mesh = { id: 'mesh-p', ...SHAPES.standard(), density: 'standard', edited: false };
  return {
    ...p,
    assets: [testAsset('asset-p', { x: 100, y: 100 }, 200, 200)],
    model: {
      ...p.model,
      parts: [part('p', { meshId: 'mesh-p' })],
      meshes: [mesh],
      drawOrder: ['p'],
      bindings: [binding],
    },
  };
}

let restoreSize: () => void = () => {};
beforeEach(() => {
  registry.reset();
  registerCanvasEdit();
  registerStructure();
  register();
  restoreSize = stubSize(800, 600);
});
afterEach(() => {
  restoreSize();
  registry.reset();
});

async function open(project: Project) {
  const shell = renderShell((base) => ({
    meshGenerator: generator,
    assets: { ...base.assets, getImageData: (id: string) => (id === 'asset-p' ? ALPHA : undefined) },
  }));
  const store = shell.services.store as ProjectStoreWithHistory;
  act(() => store.load(project));
  await waitFor(() => expect(shell.canvas.getState().view.scale).toBeGreaterThan(0));
  act(() => shell.services.editor.set({ selectedPartIds: ['p'], editorParamValues: { FaceAngleX: 30 } }));
  // 開いた直後のプロジェクトに、取り消せる変更を1つ入れておく（履歴が変わらないことを確かめるため）
  act(() => store.dispatch({ label: 'テスト前の変更', apply: (p) => ({ ...p, name: 'テスト前の変更のあと' }) }));
  const section = () => document.querySelector<HTMLElement>(`[data-section-id="${MESH_DENSITY_SECTION_ID}"]`)!;
  const radio = (name: string) => within(section()).getByRole('radio', { name }) as HTMLInputElement;
  const checked = () => ['軽い', '標準', 'なめらか'].filter((n) => radio(n).checked);
  const mesh = () => store.get().model.meshes.find((m) => m.id === 'mesh-p')!;
  return { ...shell, store, radio, checked, mesh, loaded: project };
}

// 確認のダイアログの文と、その中の px の数値
async function confirmDialog() {
  const dialog = await screen.findByRole('dialog');
  const message = dialog.querySelector('.dialog-message')!.textContent!;
  const px = [...message.matchAll(/(\d+(?:\.\d+)?)\s*px/g)].map((m) => Number(m[1]));
  const keys = [...message.matchAll(/(\d+)\s*キー/g)].map((m) => Number(m[1]));
  return { dialog, message, px, keys };
}

describe('カード61: 「軽い」を選ぶときのずれの量', () => {
  it('「軽い」で表せない中心の変形があると、確認の前にずれの最大値（15px）を出す', async () => {
    const shell = await open(testProject(localBinding()));
    fireEvent.click(shell.radio('軽い'));
    const { message, px, keys } = await confirmDialog();
    expect(message).toContain('軽い');
    expect(px).toEqual([15]);
    expect(message).toMatch(/15\.00\s*px/);
    // 3つのキー（-30・0・30）を比べた
    expect(keys).toEqual([3]);
    // 確認中は細かさの選択を押せない
    expect(shell.radio('標準').disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(shell.radio('軽い').disabled).toBe(false));
  });

  it('「軽い」でも表せる変形（1次式）なら、ずれは 0px と出る', async () => {
    const shell = await open(testProject(affineBinding()));
    fireEvent.click(shell.radio('軽い'));
    const { message, px, keys } = await confirmDialog();
    expect(message).toContain('軽い');
    expect(px).toEqual([0]);
    expect(keys).toEqual([2]);
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(shell.radio('軽い').disabled).toBe(false));
  });

  it('取り消すと、メッシュ・キー・Undo の履歴を変えない（キャンセルのボタンでも Esc でも）', async () => {
    const shell = await open(testProject(localBinding()));
    const before = shell.store.get();
    const beforeMesh = shell.mesh();
    const beforeBindings = before.model.bindings;
    expect(shell.store.undoLabel()).toBe('テスト前の変更');
    expect(shell.store.redoLabel()).toBeNull();
    expect(shell.checked()).toEqual(['標準']);

    const unchanged = () => {
      expect(shell.store.get()).toBe(before);
      expect(shell.mesh()).toBe(beforeMesh);
      expect(shell.mesh().vertices).toHaveLength(5);
      expect(shell.mesh().density).toBe('standard');
      expect(shell.store.get().model.bindings).toBe(beforeBindings);
      expect(shell.store.get().model.bindings[0]!.keys.map((k) => (k.delta as Vec2[]).length)).toEqual([5, 5, 5]);
      expect(shell.store.undoLabel()).toBe('テスト前の変更');
      expect(shell.store.redoLabel()).toBeNull();
      expect(shell.checked()).toEqual(['標準']);
      expect(screen.queryByRole('dialog')).toBeNull();
    };

    // キャンセルのボタン
    fireEvent.click(shell.radio('軽い'));
    expect((await confirmDialog()).px).toEqual([15]);
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(shell.radio('軽い').disabled).toBe(false));
    unchanged();

    // Esc（もう一度選ぶと、同じずれが出る）
    fireEvent.click(shell.radio('軽い'));
    const { dialog, px } = await confirmDialog();
    expect(px).toEqual([15]);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(shell.radio('軽い').disabled).toBe(false));
    unchanged();

    // 履歴は「テスト前の変更」の1つだけのまま: 1回の Undo で開いた直後に戻り、それ以上は戻れない
    act(() => shell.store.undo());
    expect(shell.store.get()).toBe(shell.loaded);
    expect(shell.store.canUndo()).toBe(false);
  });

  it('OK で作り直すと、出たずれのとおり中心の変形が失われる（四隅の差分は保つ）。1回の Undo で戻る', async () => {
    const shell = await open(testProject(localBinding()));
    const before = shell.store.get();
    fireEvent.click(shell.radio('軽い'));
    expect((await confirmDialog()).px).toEqual([15]);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(shell.mesh().density).toBe('light'));

    expect(shell.mesh().vertices).toEqual(CORNERS);
    const keys = shell.store.get().model.bindings[0]!.keys;
    expect(keys.map((k) => k.delta)).toEqual([
      CORNERS.map(() => ({ x: -6, y: 0 })),
      CORNERS.map(() => ZERO),
      CORNERS.map(() => ({ x: 4, y: 2 })),
    ]);
    // 「軽い」の中心は四隅 0 と 2 の平均で動く。元の中心の動きとの差の最大が、確認で出た 15px
    const lost = keys.map((k, i) => {
      const d = k.delta as Vec2[];
      const now = { x: (d[0]!.x + d[2]!.x) / 2, y: (d[0]!.y + d[2]!.y) / 2 };
      const was = (before.model.bindings[0]!.keys[i]!.delta as Vec2[])[4]!;
      return Math.hypot(now.x - was.x, now.y - was.y);
    });
    expect(lost).toEqual([15, 0, 13]);

    expect(shell.store.undoLabel()).toBe('変形の細かさの変更');
    act(() => shell.store.undo());
    expect(shell.store.get()).toBe(before);
    expect(shell.store.undoLabel()).toBe('テスト前の変更');
    expect(shell.checked()).toEqual(['標準']);
  });
});
