// スタジオの設定（詳細）の「トラッキングの割り当て」（I-042）
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject, ensureStandardParameters, type Parameter, type Project } from '@app/schema';
import { FakeTrackingLayer, FakeTrackingSource, type Renderer, type Services } from '@app/contracts';
import { createParameterMixer, type ProjectStoreWithHistory } from '@app/core';
import { createFakeServices } from '../../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { register as registerStudio } from '../index';
import { register } from './index';

const TAIL: Parameter = { id: 'tail', name: 'しっぽ', groupId: 'other', min: -1, max: 1, default: 0, standard: false };

function project(): Project {
  const p = createEmptyProject('テスト');
  const model = ensureStandardParameters(p.model, 'step1');
  return { ...p, model: { ...model, parameters: [...model.parameters, TAIL] } };
}

// jsdom には 2D/WebGL のコンテキストが無いので、何も描かないレンダラーにする
const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };

async function setup() {
  const services: Services = {
    ...createFakeServices(),
    createRenderer: () => renderer,
    mixer: createParameterMixer(),
    tracking: new FakeTrackingSource(() => Date.now()),
    trackingLayer: new FakeTrackingLayer(),
  };
  const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
  render(<Shell services={services} environment={environment} />);
  await act(async () => {
    services.store.load(project());
    services.editor.set({ mode: 'studio' });
  });
  const store = services.store as ProjectStoreWithHistory;
  const section = () => screen.getByRole('heading', { name: 'トラッキングの割り当て' }).parentElement!;
  const rows = () => within(section()).queryAllByRole('listitem');
  return { services, store, section, rows };
}

beforeEach(() => {
  registry.reset();
  registerStudio();
  register();
});

describe('トラッキングの割り当て（I-042）', () => {
  it('I-088: 最初から表示する', async () => {
    await setup();
    expect(screen.getByRole('heading', { name: 'トラッキングの割り当て' })).toBeTruthy();
  });

  it('標準・カスタム・無効を選べ、カスタムにすると標準の割り当てから編集できる（1回の操作で1回の Undo）', async () => {
    const { store, section, rows } = await setup();
    const choices = within(section()).getByRole('group', { name: 'トラッキングの割り当ての使い方' });
    expect(within(choices).getByRole('button', { name: '標準' }).getAttribute('aria-pressed')).toBe('true');
    expect(rows()).toHaveLength(0);

    fireEvent.click(within(choices).getByRole('button', { name: 'カスタム' }));
    expect(store.get().trackingSetup.mode).toBe('custom');
    expect(rows().length).toBe(store.get().trackingMappings.length);
    expect(rows().length).toBeGreaterThan(5);
    expect(store.undoLabel()).toBe('トラッキングの割り当て');

    fireEvent.click(within(choices).getByRole('button', { name: '無効' }));
    expect(store.get().trackingSetup.mode).toBe('off');
    expect(within(section()).getByText(/トラッキングでパラメータを動かさない/)).toBeTruthy();
    act(() => store.undo());
    act(() => store.undo());
    expect(store.get().trackingSetup.mode).toBe('standard');
  });

  it('ユーザー定義のパラメータへの割り当てを足し、入力・範囲・反転・重みを変える', async () => {
    const { store, section, rows } = await setup();
    fireEvent.click(within(section()).getByRole('button', { name: 'カスタム' }));
    const before = rows().length;
    fireEvent.click(within(section()).getByRole('button', { name: '割り当てを追加' }));
    expect(rows()).toHaveLength(before + 1);
    const row = within(rows().at(-1)!);
    expect((row.getByRole('combobox', { name: 'パラメータ' }) as HTMLSelectElement).value).toBe('tail');

    fireEvent.change(row.getByRole('combobox', { name: '入力' }), { target: { value: 'mouthOpen' } });
    const weight = row.getByRole('spinbutton', { name: '重み' });
    fireEvent.change(weight, { target: { value: '2.5' } });
    fireEvent.blur(weight);
    const max = row.getByRole('spinbutton', { name: '出力の最大' });
    fireEvent.change(max, { target: { value: '0.5' } });
    fireEvent.keyDown(max, { key: 'Enter' });
    fireEvent.click(row.getByRole('checkbox'));
    // 受け付けない値（負の重み）は元に戻す
    fireEvent.change(weight, { target: { value: '-1' } });
    fireEvent.blur(weight);
    expect((weight as HTMLInputElement).value).toBe('2.5');

    expect(store.get().trackingMappings.at(-1)).toMatchObject({
      input: 'mouthOpen',
      parameterId: 'tail',
      inputRange: [0, 1],
      outputRange: [-1, 0.5],
      invert: true,
      weight: 2.5,
    });
  });

  it('数は小数3桁までで見せ、書き換えずに離れても値は変えない', async () => {
    const { store, section, rows } = await setup();
    fireEvent.click(within(section()).getByRole('button', { name: 'カスタム' }));
    const smoothing = within(rows()[0]!).getByRole('spinbutton', { name: 'なめらかさ' }) as HTMLInputElement;
    const exact = store.get().trackingMappings[0]!.smoothing;
    expect(smoothing.value).toBe(String(Number(exact.toFixed(3))));
    fireEvent.blur(smoothing);
    expect(store.get().trackingMappings[0]!.smoothing).toBe(exact);
    expect(store.undoLabel()).toBe('トラッキングの割り当て'); // カスタムにした1回だけ
    act(() => store.undo());
    expect(store.canUndo()).toBe(false);
  });

  it('同じパラメータへの割り当てが2つ以上あると、合わせ方を選べる', async () => {
    const { store, section } = await setup();
    fireEvent.click(within(section()).getByRole('button', { name: 'カスタム' }));
    expect(within(section()).queryByRole('combobox', { name: /合わせ方/ })).toBeNull();
    fireEvent.click(within(section()).getByRole('button', { name: '割り当てを追加' }));
    fireEvent.click(within(section()).getByRole('button', { name: '割り当てを追加' }));
    const combine = within(section()).getByRole('combobox', { name: '合わせ方: しっぽ' });
    expect((combine as HTMLSelectElement).value).toBe('add');
    fireEvent.change(combine, { target: { value: 'average' } });
    expect(store.get().trackingSetup.combine).toEqual([{ parameterId: 'tail', method: 'average' }]);
  });

  it('並べ替え・削除・標準の一覧に戻す', async () => {
    const { store, section, rows } = await setup();
    fireEvent.click(within(section()).getByRole('button', { name: 'カスタム' }));
    const [first, second] = store.get().trackingMappings;
    fireEvent.click(within(rows()[1]!).getByRole('button', { name: '上へ' }));
    expect(store.get().trackingMappings.slice(0, 2)).toEqual([second, first]);
    expect(within(rows()[0]!).getByRole('button', { name: '上へ' }).hasAttribute('disabled')).toBe(true);
    const count = rows().length;
    fireEvent.click(within(rows()[0]!).getByRole('button', { name: '削除' }));
    expect(rows()).toHaveLength(count - 1);
    fireEvent.click(within(section()).getByRole('button', { name: '標準の一覧に戻す' }));
    expect(rows()).toHaveLength(count);
    expect(store.get().trackingMappings[0]).toEqual(first);
  });
});
