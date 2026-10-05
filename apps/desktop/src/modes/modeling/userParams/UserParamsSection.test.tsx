// パラメータパネルの「ユーザー定義パラメータ」（カード34）: 一覧・追加・編集・削除と Undo
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject, type Binding, type Parameter, type Project } from '@app/schema';
import type { Services } from '@app/contracts';
import { createFakeServices } from '../../../services';
import { createKeyEditor } from '../../../services/keyEditor';
import { delta } from '../../../services/keyEditor/testing';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { register as registerParameters } from '../parameters';
import { register } from './index';

beforeEach(() => {
  registry.reset();
  registerParameters();
  register();
});

const tail: Parameter = { id: 'tail', name: 'しっぽ', groupId: 'other', min: -1, max: 1, default: 0, standard: false };

// しっぽ（キーと表情・トラッキングで使う）入りのプロジェクト
function projectWithTail(): Project {
  const p = createEmptyProject('ユーザー定義のテスト');
  const b: Binding = {
    id: 'b-tail',
    target: { type: 'part', id: 'p1' },
    channel: 'transform',
    parameterIds: ['tail'],
    keyValues: [[0, 1]],
    keys: [
      { coords: [0], delta: delta(), source: 'auto', locked: false },
      { coords: [1], delta: delta({ rotation: 20 }), source: 'manual', locked: false },
    ],
    generation: 'linear',
    divisions: null,
  };
  return {
    ...p,
    model: { ...p.model, parameters: [...p.model.parameters, tail], bindings: [b] },
    expressions: [
      {
        id: 'e1',
        name: '喜び',
        entries: [{ parameterId: 'tail', value: 1, blend: 'override' }],
        fadeIn: 0,
        fadeOut: 0,
      },
    ],
    trackingMappings: [
      {
        input: 'faceRoll',
        parameterId: 'tail',
        inputRange: [-30, 30],
        outputRange: [-1, 1],
        invert: false,
        curve: 'linear',
        smoothing: 0.5,
        deadZone: 0,
        weight: 1,
      },
    ],
  };
}

function setup(project?: Project) {
  const services: Services = {
    ...createFakeServices(),
    createRenderer: () => ({ init() {}, setTextures() {}, render() {}, dispose() {} }),
    keyEditor: createKeyEditor(),
  };
  const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
  render(<Shell services={services} environment={environment} />);
  if (project) act(() => services.store.load(project));
  const section = () => within(document.querySelector<HTMLElement>('[data-section-id="modeling.userParams"]')!);
  const list = () => section().queryByRole('list', { name: 'ユーザー定義パラメータの一覧' });
  const field = (name: string) => section().getByLabelText(name) as HTMLInputElement;
  const fill = (values: Record<string, string>) => {
    for (const [name, value] of Object.entries(values)) fireEvent.change(field(name), { target: { value } });
  };
  const row = (id: string) => document.querySelector<HTMLElement>(`.parameter-row[data-parameter-id="${id}"]`);
  const userParams = () => services.store.get().model.parameters.filter((p) => !p.standard);
  return { services, section, list, field, fill, row, userParams };
}

describe('ユーザー定義パラメータのセクション', () => {
  it('追加すると一覧とパネルの行に並び、ほかと同じように編集中にできる。Undo で消える', () => {
    const { services, section, list, fill, row, userParams } = setup();
    expect(section().getByText(/まだ無い/)).toBeTruthy();
    expect(list()).toBeNull();

    fireEvent.click(section().getByRole('button', { name: '追加' }));
    fill({ 名前: 'しっぽ', 最小: '-1', 最大: '1', デフォルト値: '0' });
    fireEvent.change(section().getByLabelText('グループ'), { target: { value: 'sway' } });
    fireEvent.click(
      within(section().getByRole('form', { name: 'パラメータの追加' })).getByRole('button', { name: '追加' }),
    );

    const [added] = userParams();
    expect(added).toMatchObject({ name: 'しっぽ', groupId: 'sway', min: -1, max: 1, default: 0, standard: false });
    expect(added!.id).toMatch(/^[0-9A-Z]{26}$/); // newId()
    expect(section().queryByRole('form')).toBeNull();
    expect(within(list()!).getByText('しっぽ')).toBeTruthy();
    expect(within(list()!).getByText('揺れもの・-1〜1（デフォルト 0）')).toBeTruthy();

    // パネルの「揺れもの」のグループに行が出る
    const group = screen.getByRole('region', { name: '揺れもの' });
    expect(within(group).getByText('しっぽ')).toBeTruthy();
    fireEvent.click(row(added!.id)!.querySelector('.parameter-row-head')!);
    expect(services.editor.get().activeParameterIds).toEqual([added!.id]);

    act(() => services.store.undo());
    expect(userParams()).toEqual([]);
    expect(row(added!.id)).toBeNull();
  });

  it('入力がおかしければ理由を出し、何も足さない。キャンセルで閉じる', () => {
    const { section, fill, userParams } = setup();
    fireEvent.click(section().getByRole('button', { name: '追加' }));
    fireEvent.click(within(section().getByRole('form')).getByRole('button', { name: '追加' }));
    expect(section().getByRole('alert').textContent).toBe('名前を入れる');
    fill({ 名前: '耳', 最小: '1', 最大: '0' });
    fireEvent.submit(section().getByRole('form'));
    expect(section().getByRole('alert').textContent).toBe('最大は最小より大きくする');
    expect(userParams()).toEqual([]);
    fireEvent.click(section().getByRole('button', { name: 'キャンセル' }));
    expect(section().queryByRole('form')).toBeNull();
  });

  it('編集で名前・範囲を変える（1回の Undo）。キーがあるとデフォルト値は変えられない', () => {
    const { services, section, list, field, fill, userParams } = setup(projectWithTail());
    fireEvent.click(within(list()!).getByRole('button', { name: 'しっぽ を編集' }));
    const form = section().getByRole('form', { name: 'パラメータの編集' });
    expect(field('名前').value).toBe('しっぽ');
    expect(field('デフォルト値').readOnly).toBe(true);
    expect(within(form).getByText('キーがあるので、デフォルト値は変えられない')).toBeTruthy();

    fill({ 名前: '尾', 最小: '0.5' });
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    expect(section().getByRole('alert').textContent).toBe('デフォルト値は最小〜最大の間にする');
    fill({ 最小: '-2', 最大: '2' });
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    expect(userParams()).toEqual([{ ...tail, name: '尾', min: -2, max: 2 }]);
    expect(within(list()!).getByText('尾')).toBeTruthy();

    act(() => services.store.undo());
    expect(userParams()).toEqual([tail]);
  });

  it('削除は使っているものを示して確かめ、断れば何もしない', async () => {
    const { services, list, userParams } = setup(projectWithTail());
    const before = services.store.get();
    fireEvent.click(within(list()!).getByRole('button', { name: 'しっぽ を削除' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/バインディング（キー） 1 個・トラッキングのマッピング 1 個・表情の項目 1 個/),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(services.store.get()).toBe(before);
    expect(userParams()).toEqual([tail]);
  });

  it('削除するとバインディング・マッピング・表情の項目も消え、編集中からも外す。1回の Undo で戻る', async () => {
    const { services, section, list, row, userParams } = setup(projectWithTail());
    act(() => services.editor.set({ activeParameterIds: ['tail'], editorParamValues: { tail: 1 } }));
    const before = services.store.get();
    fireEvent.click(within(list()!).getByRole('button', { name: 'しっぽ を削除' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(userParams()).toEqual([]));

    const after = services.store.get();
    expect(after.model.bindings).toEqual([]);
    expect(after.trackingMappings).toEqual([]);
    expect(after.expressions[0]!.entries).toEqual([]);
    expect(services.editor.get()).toMatchObject({ activeParameterIds: [], editorParamValues: {} });
    expect(row('tail')).toBeNull();
    expect(section().getByText(/まだ無い/)).toBeTruthy();

    act(() => services.store.undo());
    expect(services.store.get()).toBe(before);
  });
});
