// カード31 パラメータパネルのキーの操作（印の移動・ロック・範囲・再補間・生成方式）。本物の keyGenerator で確かめる
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  type Binding,
  type ParameterKey,
  type Part,
  type Project,
  type TransformDelta,
  type Vec2,
} from '@app/schema';
import type { Services } from '@app/contracts';
import { createKeyGenerator } from '@app/core';
import { createFakeServices } from '../../../services';
import { createKeyEditor } from '../../../services/keyEditor';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { register } from './index';
import { hasKeyAtCurrentValue } from './marks';

const move = (x: number): TransformDelta => ({ position: { x, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: 1 });
const key = (value: number, x: number, source: ParameterKey['source'], locked = false): ParameterKey => ({
  coords: [value],
  delta: move(x),
  source,
  locked,
});

function part(id: string, kind: Part['kind']): Part {
  return {
    id,
    name: id,
    kind,
    standardType: null,
    assetId: null,
    meshId: null,
    parentId: null,
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    pivot: { x: 0, y: 0 },
    opacity: 1,
    blendMode: 'normal',
    depth: 0,
    mask: null,
    physicsId: null,
    visible: true,
    locked: false,
  };
}

const warpPoints: Vec2[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 200, y: 0 },
];

// FaceAngleX: 顔の transform（-30・0・30 が代表、間は古い値の generated）。MouthOpen: 口の transform（中間キーなし）
function sampleProject(withWarp = false): Project {
  const p = createEmptyProject('キー操作のテスト');
  const face: Binding = {
    id: 'b-face',
    target: { type: 'part', id: 'face' },
    channel: 'transform',
    parameterIds: ['FaceAngleX'],
    keyValues: [[-30, -20, -10, 0, 10, 20, 30]],
    keys: [
      key(-30, -30, 'manual'),
      key(-20, 0, 'generated'),
      key(-10, 0, 'generated'),
      key(0, 0, 'auto'),
      key(10, 0, 'generated'),
      key(20, 0, 'generated'),
      key(30, 90, 'manual'),
    ],
    generation: 'linear',
    divisions: null,
  };
  const mouth: Binding = {
    id: 'b-mouth',
    target: { type: 'part', id: 'mouth' },
    channel: 'transform',
    parameterIds: ['MouthOpen'],
    keyValues: [[0, 1]],
    keys: [key(0, 0, 'auto'), key(1, 8, 'manual')],
    generation: 'linear',
    divisions: null,
  };
  const warp: Binding = {
    id: 'b-warp',
    target: { type: 'warp', id: 'w' },
    channel: 'warpPoints',
    parameterIds: ['FaceAngleX'],
    keyValues: [[0]],
    keys: [{ coords: [0], delta: warpPoints.map(() => ({ x: 0, y: 0 })), source: 'auto', locked: false }],
    generation: 'linear',
    divisions: null,
  };
  return {
    ...p,
    model: {
      ...p.model,
      parts: [part('face', 'image'), part('mouth', 'image'), part('head', 'group')],
      warps: withWarp
        ? [
            {
              id: 'w',
              partId: 'head',
              columns: 2,
              rows: 0,
              bounds: { x: 0, y: 0, width: 200, height: 0 },
              points: warpPoints,
            },
          ]
        : [],
      bindings: withWarp ? [face, mouth, warp] : [face, mouth],
    },
  };
}

beforeEach(() => {
  registry.reset();
  register();
});

function setup(project = sampleProject()) {
  const fake = createFakeServices();
  const services: Services = {
    ...fake,
    createRenderer: () => ({ init() {}, setTextures() {}, render() {}, dispose() {} }),
    keyGenerator: createKeyGenerator({ parameters: () => fake.store.get().model.parameters }),
  };
  const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
  render(<Shell services={services} environment={environment} />);
  act(() => services.store.load(project));
  return { services };
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-parameter-id="${id}"]`)!;
const markAt = (id: string, value: number) => row(id).querySelector<HTMLElement>(`[data-value="${value}"]`)!;
// 印の右クリックのメニューからロック / ロック解除する（STEP3 のカード63）
function toggleLockByMenu(id: string, value: number) {
  fireEvent.contextMenu(markAt(id, value));
  const menu = screen.getByRole('group', { name: /^キー .* の操作$/ });
  fireEvent.click(within(menu).getByRole('button', { name: /^ロック/ }));
}
const kinds = (id: string) =>
  [...row(id).querySelectorAll<HTMLElement>('[data-kind]')].map((m) => [Number(m.dataset.value), m.dataset.kind]);
const faceKeys = (s: Services) => s.store.get().model.bindings.find((b) => b.id === 'b-face')!.keys;
const xs = (keys: ParameterKey[]) => keys.map((k) => [k.coords[0], (k.delta as TransformDelta).position.x]);

function editRow(id: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: id }));
}

// FaceAngleX の行の上で Shift＋ドラッグ（印の並ぶ幅 200px。x = 7 + (値 + 30) / 60 × 200）
function selectFaceRange(from: number, to: number) {
  const slider = row('FaceAngleX').querySelector<HTMLElement>('.key-slider-track')!;
  slider.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 214,
    height: 30,
    right: 214,
    bottom: 30,
    x: 0,
    y: 0,
    toJSON() {},
  });
  const x = (v: number) => 7 + ((v + 30) / 60) * 200;
  fireEvent.pointerDown(slider, { button: 0, shiftKey: true, clientX: x(from), pointerId: 5 });
  fireEvent.pointerMove(slider, { button: 0, shiftKey: true, clientX: x(to), pointerId: 5 });
  fireEvent.pointerUp(slider, { button: 0, shiftKey: true, clientX: x(to), pointerId: 5 });
}

describe('印を押して移動・編集', () => {
  it('印を押すとその値へ移動し、その値のキー（中間キーも）を直接直せる', () => {
    const { services } = setup();
    editRow(/^顔 左右/);
    fireEvent.click(markAt('FaceAngleX', 10));
    expect(services.editor.get().editorParamValues).toEqual({ FaceAngleX: 10 });
    expect((screen.getByRole('slider', { name: '顔 左右' }) as HTMLInputElement).value).toBe('10');
    expect(hasKeyAtCurrentValue(services.store.get().model, services.editor.get())).toBe(true);

    // キーの編集（キャンバスの操作と同じ KeyEditor）で中間キーを直す
    const command = createKeyEditor().transformEdit(services.store.get(), services.editor.get(), ['face'], {
      dPosition: { x: 5, y: 0 },
    });
    if (command === 'needsKey') throw new Error('キーがあるはず');
    act(() => services.store.dispatch(command));
    const edited = faceKeys(services).find((k) => k.coords[0] === 10)!;
    expect((edited.delta as TransformDelta).position.x).toBe(5);
    expect(edited.source).toBe('manual');
  });
});

describe('ロック', () => {
  it('右クリックのメニューでロック / ロック解除し、それぞれ1回で Undo できる', () => {
    const { services } = setup();
    const loaded = services.store.get();
    editRow(/^顔 左右/);
    expect(kinds('FaceAngleX').find(([v]) => v === 20)![1]).toBe('generated');

    toggleLockByMenu('FaceAngleX', 20);
    expect(kinds('FaceAngleX').find(([v]) => v === 20)![1]).toBe('locked');
    expect(faceKeys(services).find((k) => k.coords[0] === 20)!.locked).toBe(true);
    toggleLockByMenu('FaceAngleX', 20);
    expect(kinds('FaceAngleX').find(([v]) => v === 20)![1]).toBe('generated');

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(kinds('FaceAngleX').find(([v]) => v === 20)![1]).toBe('locked');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(services.store.get()).toBe(loaded);
  });
});

describe('範囲の選択', () => {
  it('Shift＋ドラッグで選んだ範囲をロック / ロック解除 / 再補間する。範囲外とロックしたキーは変わらない', () => {
    const { services } = setup();
    const loaded = services.store.get();
    editRow(/^顔 左右/);
    selectFaceRange(-25, -5);
    const group = screen.getByRole('group', { name: '選択範囲のキー' });
    expect(group.textContent).toContain('キー 2 個');

    // -20・-10 をロック
    fireEvent.click(within(group).getByRole('button', { name: '選択範囲をロック' }));
    expect(faceKeys(services).map((k) => k.locked)).toEqual([false, true, true, false, false, false, false]);
    const afterLock = services.store.get();

    // 0〜30 を選び直して再補間。-30〜-10 は変わらない
    selectFaceRange(5, 30);
    fireEvent.click(screen.getByRole('button', { name: '選択範囲だけ再補間' }));
    const keys = faceKeys(services);
    expect(xs(keys)).toEqual([
      [-30, -30],
      [-20, 0],
      [-10, 0],
      [0, 0],
      [10, 30],
      [20, 60],
      [30, 90],
    ]);
    const before = afterLock.model.bindings[0]!.keys;
    [0, 1, 2, 3, 6].forEach((i) => expect(keys[i]).toBe(before[i]));

    // ロック解除してから全体を作り直すと、-20・-10 も作り直される
    selectFaceRange(-30, 0);
    fireEvent.click(screen.getByRole('button', { name: '選択範囲をロック解除' }));
    expect(faceKeys(services).every((k) => !k.locked)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'すべて再補間' }));
    expect(xs(faceKeys(services))).toEqual([
      [-30, -30],
      [-20, -20],
      [-10, -10],
      [0, 0],
      [10, 30],
      [20, 60],
      [30, 90],
    ]);

    // 操作ごとに1回の Undo（ロック・範囲の再補間・ロック解除・すべて再補間）
    act(() => services.store.undo());
    act(() => services.store.undo());
    act(() => services.store.undo());
    expect(services.store.get()).toBe(afterLock);
    act(() => services.store.undo());
    expect(services.store.get()).toBe(loaded);
    expect(services.store.canUndo()).toBe(false);
  });

  it('[すべて再補間] はロックしたキーを残して作り直し、1回で Undo できる', () => {
    const { services } = setup();
    const loaded = services.store.get();
    expect(screen.getByRole('button', { name: 'すべて再補間' }).hasAttribute('disabled')).toBe(true);
    editRow(/^顔 左右/);
    toggleLockByMenu('FaceAngleX', -10);
    const locked = services.store.get();
    fireEvent.click(screen.getByRole('button', { name: 'すべて再補間' }));
    // -10（ロック、0）を代表状態にして -20 は -15
    expect(xs(faceKeys(services)).slice(0, 3)).toEqual([
      [-30, -30],
      [-20, -15],
      [-10, 0],
    ]);
    expect(faceKeys(services)[2]).toBe(locked.model.bindings[0]!.keys[2]);
    act(() => services.store.undo());
    expect(services.store.get()).toBe(locked);
    act(() => services.store.undo());
    expect(services.store.get()).toBe(loaded);
  });
});

describe('生成方式', () => {
  const select = () => screen.getByRole('combobox', { name: '生成方式' }) as HTMLSelectElement;

  it('最初から生成方式を選べ、なめらかで中間キーを smoothstep で作り直し、1回で Undo できる', () => {
    const { services } = setup();
    const loaded = services.store.get();
    editRow(/^顔 左右/);

    expect(select().value).toBe('linear');
    expect([...select().options].map((o) => o.textContent)).toEqual(['線形', '回転', '曲面', 'なめらか']);

    fireEvent.change(select(), { target: { value: 'ease' } });
    const b = services.store.get().model.bindings[0]!;
    expect(b.generation).toBe('ease');
    const s = (t: number) => t * t * (3 - 2 * t);
    expect((b.keys[4]!.delta as TransformDelta).position.x).toBeCloseTo(90 * s(1 / 3), 9);
    expect(select().value).toBe('ease');
    // [間を生成] も方式に従う（変わらない）
    fireEvent.click(screen.getByRole('button', { name: '間を生成' }));
    expect(services.store.get().model.bindings[0]).toBe(b);

    act(() => services.store.undo());
    expect(services.store.get()).toBe(loaded);
  });

  it('曲面は顔の向きのときだけ出て、ワープのキーを球面で作る。1回で Undo できる', () => {
    const { services } = setup(sampleProject(true));
    const loaded = services.store.get();

    editRow(/^口 開閉/);
    expect([...select().options].map((o) => o.value)).toEqual(['linear', 'rotate', 'ease']);
    editRow(/^顔 左右/);
    fireEvent.change(select(), { target: { value: 'surface' } });
    const warp = services.store.get().model.bindings.find((b) => b.id === 'b-warp')!;
    expect(warp.generation).toBe('surface');
    expect(warp.keys.map((k) => k.coords[0])).toEqual([-30, -20, -10, 0, 10, 20, 30]);
    // 真ん中の制御点がいちばん大きく右へ動く
    const plus30 = warp.keys[6]!.delta as Vec2[];
    expect(plus30[1]!.x).toBeGreaterThan(plus30[0]!.x);
    expect(plus30[1]!.x).toBeGreaterThan(plus30[2]!.x);
    // transform のバインディングは曲面にならないので「混在」
    expect(select().value).toBe('mixed');
    act(() => services.store.undo());
    expect(services.store.get()).toBe(loaded);
  });

  it('曲面にできるワープのキーが無ければ知らせ、何も変えない', () => {
    const { services } = setup();

    editRow(/^顔 左右/);
    fireEvent.change(select(), { target: { value: 'surface' } });
    expect(screen.getByText('曲面にできるのは、顔の向きのワープのキーだけ')).toBeTruthy();
    expect(services.store.canUndo()).toBe(false);
  });
});

describe('1つのキーを消す（STEP3 のカード63・I-058）', () => {
  it('印の右クリックのメニューで、その値のキーを消して知らせる。1回で Undo できる', async () => {
    const { services } = setup();
    const loaded = services.store.get();
    editRow(/^顔 左右/);
    expect(faceKeys(services).some((k) => k.coords[0] === 20)).toBe(true);
    fireEvent.contextMenu(markAt('FaceAngleX', 20));
    const menu = screen.getByRole('group', { name: /^キー .* の操作$/ });
    await act(async () => {
      fireEvent.click(within(menu).getByRole('button', { name: 'このキーを消す' }));
    });
    expect(faceKeys(services).some((k) => k.coords[0] === 20)).toBe(false);
    expect(await screen.findByText(/すべてのパーツのキーを 1 個消した/)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(services.store.get()).toBe(loaded);
  });
});
