// アニメーション画面のテスト用。枠を描き、アニメーションのモードにして、このカードの部品だけを登録する
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { createEmptyProject, ensureStandardParameters, type Animation, type Project } from '@app/schema';
import { emptyDeltas, type ParamValues, type Renderer, type Services } from '@app/contracts';
import { createFakeServices } from '../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../shell/environment';
import { registry } from '../../shell/registry';
import { Shell } from '../../shell/Shell';
import { createAnimation } from './commands';
import { register } from './index';
import { animationEditor } from './state';

export function step1Project(animations: Animation[] = []): Project {
  const p = createEmptyProject('テスト');
  return { ...p, model: ensureStandardParameters(p.model, 'step1'), animations };
}

// FaceAngleX は線形 0 → 20、MouthOpen はなめらか 0 → 1、EyeOpenL は一定 1 → 0（どれも 0 秒 → 1 秒）
export function sampleAnimationData(id = 'nod', name = 'うなずき'): Animation {
  return {
    ...createAnimation(name, id),
    tracks: [
      {
        parameterId: 'FaceAngleX',
        keyframes: [
          { time: 0, value: 0, curve: 'linear' },
          { time: 1, value: 20, curve: 'linear' },
        ],
      },
      {
        parameterId: 'MouthOpen',
        keyframes: [
          { time: 0, value: 0, curve: 'smooth' },
          { time: 1, value: 1, curve: 'smooth' },
        ],
      },
      {
        parameterId: 'EyeOpenL',
        keyframes: [
          { time: 0, value: 1, curve: 'step' },
          { time: 1, value: 0, curve: 'step' },
        ],
      },
    ],
  };
}

export function setupAnimationScreen(project: Project = step1Project(), overrides: Partial<Services> = {}) {
  registry.reset();
  register();
  animationEditor.reset();
  // jsdom には 2D/WebGL のコンテキストが無いので、何も描かないレンダラーにする
  const renderer: Renderer = { init() {}, setTextures() {}, render: vi.fn(), dispose() {} };
  const evaluate = vi.fn((_model: Project['model'], _params: ParamValues) => emptyDeltas());
  const services: Services = {
    ...createFakeServices(),
    createRenderer: () => renderer,
    evaluator: { evaluate },
    ...overrides,
  };
  const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
  render(<Shell services={services} environment={environment} />);
  act(() => {
    services.store.load(project);
    services.editor.set({ mode: 'animation' });
  });
  const { store, editor } = services;

  const panel = (id: string) => within(document.querySelector<HTMLElement>(`[data-panel-id="${id}"]`)!);
  const list = () => panel('animation.list');
  const settings = () => panel('animation.settings');
  const center = () => within(document.querySelector<HTMLElement>('.anim-center')!);
  const sliders = () => within(screen.getByRole('complementary', { name: 'パラメータの値' }));
  const row = (name: string) => within(center().getByRole('group', { name }));
  const keybar = () => within(center().getByRole('group', { name: '選んだキーフレーム' }));

  const click = (el: HTMLElement) =>
    act(() => {
      fireEvent.click(el);
    });
  const setTime = (t: number) =>
    act(() => {
      fireEvent.change(center().getByRole('slider', { name: '時刻' }), { target: { value: String(t) } });
    });
  const slide = (name: string, value: number) =>
    act(() => {
      fireEvent.change(sliders().getByRole('slider', { name }), { target: { value: String(value) } });
    });
  const release = (name: string) =>
    act(() => {
      fireEvent.blur(sliders().getByRole('slider', { name }));
    });
  // 数値の欄に入れて確定する
  const enter = (scope: ReturnType<typeof within>, name: string, value: number) =>
    act(() => {
      const input = scope.getByRole('spinbutton', { name });
      fireEvent.change(input, { target: { value: String(value) } });
      fireEvent.blur(input);
    });
  const setLevel = (level: 'easy' | 'detail') =>
    act(() => editor.set({ uiLevel: { ...editor.get().uiLevel, animation: level } }));
  const animation = (i = 0) => store.get().animations[i]!;
  const lastParams = () => evaluate.mock.calls.at(-1)![1];

  return {
    services,
    store,
    editor,
    renderer,
    evaluate,
    list,
    settings,
    center,
    sliders,
    row,
    keybar,
    click,
    setTime,
    slide,
    release,
    enter,
    setLevel,
    animation,
    lastParams,
  };
}
