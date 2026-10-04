import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject, ensureStandardParameters, type Expression, type Project } from '@app/schema';
import type { Renderer, Services } from '@app/contracts';
import { createFakeServices } from '../../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { register } from './index';

const smile: Expression = {
  id: 'smile',
  name: '笑顔',
  entries: [
    { parameterId: 'FaceAngleX', value: 12, blend: 'add' },
    { parameterId: 'EyeOpenL', value: 0.6, blend: 'multiply' },
  ],
  fadeIn: 0.5,
  fadeOut: 0.3,
};

function step1Project(expressions: Expression[] = []): Project {
  const p = createEmptyProject('テスト');
  return { ...p, model: ensureStandardParameters(p.model, 'step1'), expressions };
}

function setup(project: Project = step1Project()) {
  // jsdom には 2D/WebGL のコンテキストが無いので、何も描かないレンダラーにする
  const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };
  const services: Services = { ...createFakeServices(), createRenderer: () => renderer };
  const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
  render(<Shell services={services} environment={environment} />);
  act(() => services.store.load(project));
  return { services, store: services.store, editor: services.editor };
}

const panel = () => within(document.querySelector<HTMLElement>('[data-panel-id="expressions"]')!);
const click = (name: string) =>
  act(() => {
    fireEvent.click(panel().getByRole('button', { name }));
  });
const slide = (name: string, value: number) =>
  act(() => {
    fireEvent.change(panel().getByRole('slider', { name }), { target: { value: String(value) } });
  });
const rename = (name: string) =>
  act(() => {
    fireEvent.change(panel().getByRole('textbox', { name: '表情の名前' }), { target: { value: name } });
  });
const names = () =>
  within(panel().getByRole('list', { name: '表情の一覧' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.expr-name')!.textContent);

beforeEach(() => {
  registry.reset();
  register();
});
afterEach(() => cleanup());

describe('モデリングの「表情」パネル', () => {
  it('モデリングの右に出る。表情が無ければそう出す', () => {
    setup();
    expect(document.querySelector('[data-area="right"] [data-panel-id="expressions"]')).toBeTruthy();
    expect(panel().getByText(/表情がまだ無い/)).toBeTruthy();
  });

  it('作成: パラメータを動かして状態を作り（editorParamValues）、名前を付けて登録する。Undo・Redo', () => {
    const { store, editor } = setup();
    act(() => editor.set({ activeParameterIds: ['MouthOpen'], editorParamValues: { MouthOpen: 1 } }));
    click('新しい表情');
    // キーの編集はやめ、基準状態から作る
    expect(editor.get().activeParameterIds).toEqual([]);
    expect(editor.get().editorParamValues).toEqual({});
    expect((panel().getByRole('textbox', { name: '表情の名前' }) as HTMLInputElement).value).toBe('表情 1');

    slide('顔 左右', 12);
    slide('目 開閉 L', 0.6);
    // キャンバスが描く値（editorParamValues）が変わる
    expect(editor.get().editorParamValues.FaceAngleX).toBeCloseTo(12, 6);
    expect(editor.get().editorParamValues.EyeOpenL).toBeCloseTo(0.6, 6);
    expect(panel().getByText(/動かしたパラメータ（2 個）/)).toBeTruthy();
    rename('笑顔');
    click('登録');

    const [created] = store.get().expressions;
    expect(created).toMatchObject({ name: '笑顔', fadeIn: 0.2, fadeOut: 0.2 });
    expect(created!.entries.map((e) => [e.parameterId, e.blend])).toEqual([
      ['FaceAngleX', 'add'],
      ['EyeOpenL', 'multiply'],
    ]);
    expect(created!.entries[0]!.value).toBeCloseTo(12, 6);
    expect(created!.entries[1]!.value).toBeCloseTo(0.6, 6);
    // 登録したらキャンバスは基準状態に戻り、一覧に出る
    expect(editor.get().editorParamValues).toEqual({});
    expect(names()).toEqual(['笑顔']);
    expect(panel().getByText('2 項目')).toBeTruthy();

    act(() => store.undo());
    expect(store.get().expressions).toEqual([]);
    expect(panel().getByText(/表情がまだ無い/)).toBeTruthy();
    act(() => store.redo());
    expect(names()).toEqual(['笑顔']);
  });

  it('やめると登録せず、キャンバスを基準状態に戻す', () => {
    const { store, editor } = setup();
    click('新しい表情');
    slide('口 開閉', 0.5);
    expect(editor.get().editorParamValues).toEqual({ MouthOpen: 0.5 });
    click('やめる');
    expect(store.get().expressions).toEqual([]);
    expect(editor.get().editorParamValues).toEqual({});
    expect(store.canUndo()).toBe(false);
  });

  it('編集: 表情の状態をキャンバスに出して変え、保存する（1回の Undo）', () => {
    const { store, editor } = setup(step1Project([smile]));
    click('「笑顔」を編集');
    expect(panel().getByText('表情を編集中')).toBeTruthy();
    expect(editor.get().editorParamValues).toEqual({ FaceAngleX: 12, EyeOpenL: 0.6 });
    expect((panel().getByRole('slider', { name: '顔 左右' }) as HTMLInputElement).value).toBe('12');

    click('目 開閉 Lを戻す');
    expect(editor.get().editorParamValues).toEqual({ FaceAngleX: 12 });
    slide('口 形', 0.5);
    rename('にっこり');
    click('保存');
    expect(store.get().expressions).toEqual([
      {
        ...smile,
        name: 'にっこり',
        entries: [
          { parameterId: 'FaceAngleX', value: 12, blend: 'add' },
          { parameterId: 'MouthForm', value: 0.5, blend: 'override' },
        ],
      },
    ]);
    expect(editor.get().editorParamValues).toEqual({});
    act(() => store.undo());
    expect(store.get().expressions).toEqual([smile]);
  });

  it('削除と Undo', () => {
    const { store } = setup(step1Project([smile, { ...smile, id: 'angry', name: '怒り' }]));
    click('「笑顔」を削除');
    expect(names()).toEqual(['怒り']);
    act(() => store.undo());
    expect(names()).toEqual(['笑顔', '怒り']);
    expect(store.get().expressions[0]).toEqual(smile);
  });

  it('標準の表情のひな形（値は空）をまとめて足す。全部あれば押せない', () => {
    const { store } = setup();
    click('標準のひな形を追加');
    expect(names()).toEqual(['通常', '笑顔', '怒り', '悲しみ', '驚き', '照れ', 'ウィンク']);
    expect(panel().getAllByText('値なし')).toHaveLength(7);
    expect(store.get().expressions.every((e) => e.entries.length === 0 && e.fadeIn === 0.2)).toBe(true);
    expect((panel().getByRole('button', { name: '標準のひな形を追加' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => store.undo());
    expect(store.get().expressions).toEqual([]);
  });

  it('詳細モード: グループごとに「トラッキングに重ねる / 固定する」を選ぶと、その blend で登録する', () => {
    const { store, editor } = setup();
    act(() => editor.set({ uiLevel: { ...editor.get().uiLevel, modeling: 'detail' } }));
    click('新しい表情');
    slide('顔 左右', 12);
    slide('目 開閉 L', 0.6);
    slide('眉 上下 L', 0.5);
    slide('口 形', 0.5);
    const eye = within(panel().getByRole('group', { name: '目の合成方法' }));
    expect(eye.getByRole('button', { name: 'トラッキングに重ねる' }).getAttribute('aria-pressed')).toBe('true');
    expect(panel().getByText('目 開閉 L: 掛ける')).toBeTruthy();
    act(() => {
      fireEvent.click(eye.getByRole('button', { name: '固定する' }));
    });
    expect(eye.getByRole('button', { name: '固定する' }).getAttribute('aria-pressed')).toBe('true');
    expect(panel().getByText('目 開閉 L: 置き換える')).toBeTruthy();
    click('登録');
    expect(store.get().expressions[0]!.entries.map((e) => [e.parameterId, e.blend])).toEqual([
      ['FaceAngleX', 'add'],
      ['EyeOpenL', 'override'],
      ['BrowYL', 'add'],
      ['MouthForm', 'override'],
    ]);
    // 編集し直すと、選んだ2択が戻る
    click(`「${store.get().expressions[0]!.name}」を編集`);
    const eyeAgain = within(panel().getByRole('group', { name: '目の合成方法' }));
    expect(eyeAgain.getByRole('button', { name: '固定する' }).getAttribute('aria-pressed')).toBe('true');
    const brow = within(panel().getByRole('group', { name: '眉の合成方法' }));
    expect(brow.getByRole('button', { name: 'トラッキングに重ねる' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('かんたんモードでは2択を出さない（詳細を開けば選べる）', () => {
    setup();
    click('新しい表情');
    expect(panel().queryByRole('group', { name: '目の合成方法' })).toBeNull();
    click('合成方法');
    expect(panel().getByRole('group', { name: '目の合成方法' })).toBeTruthy();
  });

  it('作っている途中でモードを替えたら、キャンバスを基準状態に戻す', () => {
    const { editor } = setup();
    click('新しい表情');
    slide('口 開閉', 0.5);
    act(() => editor.set({ mode: 'studio' }));
    expect(editor.get().editorParamValues).toEqual({});
  });
});
