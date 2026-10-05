import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type Binding, type ParameterKey, type Project } from '@app/schema';
import { FakeKeyGenerator, type KeyGenerator, type Services } from '@app/contracts';
import { createFakeServices } from '../../../services';
import { registerPanelSection } from '../../../shell/api';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { register } from './index';
import { EDITING_OVERLAY_ID } from './overlay';

const identity = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, opacity: 1 };
const key = (value: number, source: ParameterKey['source'], locked = false): ParameterKey => ({
  coords: [value],
  delta: identity,
  source,
  locked,
});

function binding(id: string, partId: string, parameterId: string, keys: ParameterKey[]): Binding {
  return {
    id,
    target: { type: 'part', id: partId },
    channel: 'transform',
    parameterIds: [parameterId],
    keyValues: [keys.map((k) => k.coords[0]!).sort((a, b) => a - b)],
    keys,
    generation: 'linear',
    divisions: null,
  };
}

// FaceAngleX は -30（ロック）・0・15（生成）・30 にキーがある
function sampleProject(): Project {
  const p = createEmptyProject('パラメータのテスト');
  return {
    ...p,
    model: {
      ...p.model,
      bindings: [
        binding('b-face', 'face', 'FaceAngleX', [
          key(-30, 'manual', true),
          key(0, 'auto'),
          key(15, 'generated'),
          key(30, 'manual'),
        ]),
        binding('b-hair', 'hair', 'FaceAngleX', [key(0, 'auto'), key(30, 'auto')]),
        binding('b-mouth', 'mouth', 'MouthOpen', [key(0, 'auto'), key(1, 'manual')]),
      ],
    },
  };
}

// 描いた文字を記録するだけの 2D コンテキスト
function recordingContext() {
  const texts: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'measureText') return (s: string) => ({ width: s.length * 7 });
        if (prop === 'fillText') return (s: string) => texts.push(s);
        return () => {};
      },
      set: () => true,
    },
  ) as CanvasRenderingContext2D;
  return { ctx, texts };
}

const originalGetContext = HTMLCanvasElement.prototype.getContext;
let drawn: ReturnType<typeof recordingContext>;

beforeEach(() => {
  registry.reset();
  register();
  drawn = recordingContext();
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return drawn.ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

function setup(overrides: Partial<Services> = {}) {
  const services: Services = {
    ...createFakeServices(),
    createRenderer: () => ({ init() {}, setTextures() {}, render() {}, dispose() {} }),
    ...overrides,
  };
  const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
  const utils = render(<Shell services={services} environment={environment} />);
  act(() => services.store.load(sampleProject()));
  return { services, ...utils };
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-parameter-id="${id}"]`)!;
const marksOf = (id: string) => [...row(id).querySelectorAll<HTMLElement>('[data-kind]')];
const slider = (name: string) => screen.getByRole('slider', { name });
const lastLabel = () => drawn.texts.at(-1);

describe('パラメータパネル', () => {
  it('モデリングの右に、グループごとに行を並べる。下にセクションを差し込める', () => {
    registerPanelSection({ id: 't.sec', panelId: 'parameters', component: () => <p>差し込んだセクション</p> });
    setup();
    const panel = document.querySelector<HTMLElement>('[data-panel-id="parameters"]')!;
    expect(panel.closest('[data-area]')!.getAttribute('data-area')).toBe('right');
    expect(within(panel).getByText('パラメータ')).toBeTruthy();
    const groups = [...panel.querySelectorAll('.parameter-group')].map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['顔', '目', '口']);
    const rows = [...panel.querySelectorAll('[data-parameter-id]')].map((r) => r.getAttribute('data-parameter-id'));
    expect(rows).toEqual([
      'FaceAngleX',
      'FaceAngleY',
      'FaceAngleZ',
      'EyeOpenL',
      'EyeOpenR',
      'EyeBallX',
      'EyeBallY',
      'MouthOpen',
    ]);
    expect(within(row('FaceAngleX')).getByText('正面（0）')).toBeTruthy();
    expect(within(row('EyeOpenL')).getByText('開く（1）')).toBeTruthy();
    expect(within(row('MouthOpen')).getByText('閉じる（0）')).toBeTruthy();
    expect(within(panel).getByText('差し込んだセクション')).toBeTruthy();
  });

  it('仮実装で、パラメータを選ぶとキーの印が出て、編集中の表示が出る', async () => {
    const { services } = setup();
    expect(registry.get().overlays.map((o) => o.id)).toContain(EDITING_OVERLAY_ID);
    act(() => services.editor.set({ editorParamValues: { EyeOpenL: 0.2 } }));
    expect(marksOf('FaceAngleX')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /^顔 左右/ }));
    // 選んだパラメータを編集中にする。プレビューの値（目 開閉 L）は残す（I-028）
    expect(services.editor.get().activeParameterIds).toEqual(['FaceAngleX']);
    expect(services.editor.get().editorParamValues).toEqual({ EyeOpenL: 0.2, FaceAngleX: 0 });
    act(() => services.editor.set({ editorParamValues: { FaceAngleX: 0 } }));
    expect(row('FaceAngleX').querySelector('button')!.getAttribute('aria-pressed')).toBe('true');
    // ● = manual・auto、○ = generated、■ = locked
    expect(marksOf('FaceAngleX').map((m) => [m.dataset.value, m.dataset.kind, m.textContent])).toEqual([
      ['-30', 'locked', '■'],
      ['0', 'key', '●'],
      ['15', 'generated', '○'],
      ['30', 'key', '●'],
    ]);
    expect(marksOf('FaceAngleY')).toHaveLength(0);
    await waitFor(() => expect(lastLabel()).toBe('編集中: 顔 左右 ＝ 正面（0）'));

    // 範囲の 2% 以内（60 × 0.02 = 1.2）でキーに吸い付く
    fireEvent.change(slider('顔 左右'), { target: { value: '29' } });
    expect(services.editor.get().editorParamValues).toEqual({ FaceAngleX: 30 });
    expect(within(row('FaceAngleX')).getByText('右（+30）')).toBeTruthy();
    await waitFor(() => expect(lastLabel()).toBe('編集中: 顔 左右 ＝ 右（+30）'));

    // キーの無い値なら「キーなし」
    fireEvent.change(slider('顔 左右'), { target: { value: '-20' } });
    expect(services.editor.get().editorParamValues).toEqual({ FaceAngleX: -20 });
    await waitFor(() => expect(lastLabel()).toBe('編集中: 顔 左右 ＝ 左（-20）　キーなし'));

    // もう一度押すと編集をやめる（基準状態）
    const count = drawn.texts.length;
    fireEvent.click(screen.getByRole('button', { name: /^顔 左右/ }));
    expect(services.editor.get().activeParameterIds).toEqual([]);
    expect(services.editor.get().editorParamValues).toEqual({});
    expect(marksOf('FaceAngleX')).toHaveLength(0);
    // 描き直しても「編集中」は描かない
    await new Promise((r) => setTimeout(r, 50));
    expect(drawn.texts.length).toBe(count);
  });

  it('編集中でない行のスライダーはプレビューだけ（編集中のパラメータもほかの値も変えない。I-028）', async () => {
    const { services } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^顔 左右/ }));
    fireEvent.change(slider('顔 左右'), { target: { value: '30' } });
    fireEvent.change(slider('口 開閉'), { target: { value: '0.6' } });
    expect(services.editor.get().activeParameterIds).toEqual(['FaceAngleX']);
    expect(services.editor.get().editorParamValues).toEqual({ FaceAngleX: 30, MouthOpen: 0.6 });
    expect(marksOf('MouthOpen')).toHaveLength(0);
    expect(within(row('MouthOpen')).getByText('開く（0.6）')).toBeTruthy();
    expect(screen.getByText(/プレビュー中: 口 開閉 開く（0.6）/)).toBeTruthy();
    await waitFor(() => expect(lastLabel()).toMatch(/プレビュー: 口 開閉 ＝ 開く（0.6）（編集できない）$/));

    // ［値をすべて戻す］で値だけを戻す（編集中のパラメータはそのまま。I-047）
    fireEvent.click(screen.getByRole('button', { name: '値をすべて戻す' }));
    expect(services.editor.get().activeParameterIds).toEqual(['FaceAngleX']);
    expect(services.editor.get().editorParamValues).toEqual({});
    expect(screen.queryByText(/プレビュー中:/)).toBeNull();
    expect(screen.getByRole('button', { name: '値をすべて戻す' }).hasAttribute('disabled')).toBe(true);
  });

  it('ほかの行を押すと編集するパラメータを替え、それまで編集していた値は戻し、プレビューの値は残す', () => {
    const { services } = setup();
    act(() => services.editor.set({ editorParamValues: { EyeOpenL: 0.2 } }));
    fireEvent.click(screen.getByRole('button', { name: /^顔 左右/ }));
    fireEvent.change(slider('顔 左右'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /^口 開閉/ }));
    expect(services.editor.get().activeParameterIds).toEqual(['MouthOpen']);
    expect(services.editor.get().editorParamValues).toEqual({ EyeOpenL: 0.2, MouthOpen: 0 });
    // 編集中の行をもう一度押すと、その編集をやめてデフォルト値に戻す
    fireEvent.change(slider('口 開閉'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /^口 開閉/ }));
    expect(services.editor.get().activeParameterIds).toEqual([]);
    expect(services.editor.get().editorParamValues).toEqual({ EyeOpenL: 0.2 });
  });

  it('Ctrl+クリックで編集中のパラメータに加える（組み合わせのキー。2つまで）', () => {
    const { services } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^顔 左右/ }));
    fireEvent.change(slider('口 開閉'), { target: { value: '0.6' } });
    fireEvent.click(screen.getByRole('button', { name: /^口 開閉/ }), { ctrlKey: true });
    expect(services.editor.get().activeParameterIds).toEqual(['FaceAngleX', 'MouthOpen']);
    // プレビューだった値のまま編集に加わる
    expect(services.editor.get().editorParamValues).toEqual({ MouthOpen: 0.6, FaceAngleX: 0 });
    expect(screen.queryByText(/プレビュー中:/)).toBeNull();
    expect(screen.getByText('キーを編集中: 顔 左右、口 開閉')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^顔 上下/ }), { ctrlKey: true });
    expect(services.editor.get().activeParameterIds).toEqual(['FaceAngleX', 'MouthOpen']);
    expect(screen.getByText('キーを一緒に編集できるパラメータは 2 つまで')).toBeTruthy();
  });
});

describe('間を生成・奥行きで作り直す', () => {
  function spyGenerator() {
    const generated = key(7.5, 'generated');
    const linear = vi.fn((b: Binding): Binding => ({ ...b, keys: [...b.keys, generated] }));
    const depthParallax = vi.fn((model: Project['model'], _id: 'FaceAngleX' | 'FaceAngleY'): Binding[] => [
      { ...model.bindings[0]!, generation: 'depth' },
      binding('b-new', 'ear', 'FaceAngleX', [key(0, 'auto'), key(30, 'auto')]),
    ]);
    const generator: KeyGenerator = Object.assign(new FakeKeyGenerator(), { linear, depthParallax });
    return { linear, depthParallax, generator };
  }

  it('[間を生成] は編集中のパラメータを使う全バインディングに linear を掛け、1回で Undo できる', () => {
    const { linear, generator } = spyGenerator();
    const { services } = setup({ keyGenerator: generator });
    const loaded = services.store.get();
    expect(screen.getByRole('button', { name: '間を生成' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /^顔 左右/ }));
    fireEvent.click(screen.getByRole('button', { name: '間を生成' }));
    expect(linear.mock.calls.map(([b]) => b.id)).toEqual(['b-face', 'b-hair']);
    const after = services.store.get().model.bindings;
    expect(after.map((b) => b.keys.length)).toEqual([5, 3, 2]);
    // 新しいキーの印が出る
    expect(marksOf('FaceAngleX').map((m) => m.dataset.value)).toContain('7.5');

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(services.store.get()).toBe(loaded);
    expect(services.store.canUndo()).toBe(false);
  });

  it('[奥行きで作り直す] は FaceAngleX・FaceAngleY のときだけ出て、1回で Undo できる', () => {
    const { depthParallax, generator } = spyGenerator();
    const { services } = setup({ keyGenerator: generator });
    const loaded = services.store.get();
    expect(screen.queryByRole('button', { name: '奥行きで作り直す' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^口 開閉/ }));
    expect(screen.queryByRole('button', { name: '奥行きで作り直す' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^顔 上下/ }));

    fireEvent.click(screen.getByRole('button', { name: '奥行きで作り直す' }));
    expect(depthParallax).toHaveBeenCalledTimes(1);
    expect(depthParallax.mock.calls[0]![1]).toBe('FaceAngleY');
    expect(services.store.get().model.bindings.map((b) => [b.id, b.generation])).toEqual([
      ['b-face', 'depth'],
      ['b-hair', 'linear'],
      ['b-mouth', 'linear'],
      ['b-new', 'linear'],
    ]);
    act(() => services.store.undo());
    expect(services.store.get()).toBe(loaded);
    expect(services.store.canUndo()).toBe(false);
  });

  it('仮実装の keyGenerator（何も変えない）でも呼べて、履歴は増えない。キーが無ければ知らせる', () => {
    const { services } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^顔 左右/ }));
    fireEvent.click(screen.getByRole('button', { name: '間を生成' }));
    fireEvent.click(screen.getByRole('button', { name: '奥行きで作り直す' }));
    expect(services.store.canUndo()).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /^目 開閉 L/ }));
    fireEvent.click(screen.getByRole('button', { name: '間を生成' }));
    expect(screen.getByText('このパラメータのキーはまだ無い')).toBeTruthy();
  });
});
