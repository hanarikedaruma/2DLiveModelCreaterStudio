import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyProject,
  createEmptyScene,
  ensureStandardParameters,
  type Expression,
  type Project,
} from '@app/schema';
import { FakeExpressions, type Renderer, type Services } from '@app/contracts';
import { createExpressionController, createParameterMixer } from '@app/core';
import { createFakeServices } from '../../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { register as registerStudio } from '../index';
import { animationFrameScheduler, studioRuntime } from '../runtime';
import { register as registerScenes, sceneWatcher } from '../scenes';
import { selectSceneCommand } from '../scenes/commands';
import { expressionBinding } from './binding';
import { register } from './index';

const smile: Expression = {
  id: 'smile',
  name: '笑顔',
  entries: [{ parameterId: 'MouthForm', value: 0.8, blend: 'override' }],
  fadeIn: 0.2,
  fadeOut: 0.2,
};
const angry: Expression = {
  id: 'angry',
  name: '怒り',
  entries: [{ parameterId: 'BrowFormL', value: 1, blend: 'add' }],
  fadeIn: 0,
  fadeOut: 0,
};
const empty: Expression = { id: 'plain', name: '通常', entries: [], fadeIn: 0.2, fadeOut: 0.2 };

function step1Project(expressions: Expression[] = [smile, angry, empty]): Project {
  const p = createEmptyProject('テスト');
  return {
    ...p,
    model: ensureStandardParameters(p.model, 'step1'),
    expressions,
    studio: {
      ...p.studio,
      scenes: [
        { ...createEmptyScene('雑談'), id: 'chat' },
        { ...createEmptyScene('歌'), id: 'song', expressionIds: ['angry'] },
      ],
      activeSceneId: 'chat',
    },
  };
}

// jsdom には 2D/WebGL のコンテキストが無いので、何も描かないレンダラーにする
const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };

async function setup(options: { services?: Partial<Services>; project?: Project } = {}) {
  const services: Services = {
    ...createFakeServices(),
    createRenderer: () => renderer,
    mixer: createParameterMixer(),
    ...options.services,
  };
  const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
  render(<Shell services={services} environment={environment} />);
  await act(async () => {
    services.store.load(options.project ?? step1Project());
    services.editor.set({ mode: 'studio' });
  });
  return { services, store: services.store };
}

const panel = () => within(document.querySelector<HTMLElement>('[data-panel-id="studioExpressions"]')!);
const card = (name: string) =>
  within(panel().getByRole('group', { name: '表情のカード' })).getByRole('button', { name });
const pressed = (name: string) => card(name).getAttribute('aria-pressed');
// カードの右上の順番の印（無ければ null）
const order = (name: string) => card(name).querySelector('.sexpr-card-order')?.textContent ?? null;
const toDetail = (services: Services) =>
  act(() => services.editor.set({ uiLevel: { ...services.editor.get().uiLevel, studio: 'detail' } }));
const press = (name: string, now = 0) => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(now);
  act(() => {
    fireEvent.click(card(name));
  });
  clock.mockRestore();
};
function tick(now: number) {
  let params: Record<string, number> = {};
  act(() => {
    params = studioRuntime.tick(now)!.params;
  });
  return params;
}
const current = () => panel().getByLabelText('いまの表情').textContent;

beforeEach(() => {
  registry.reset();
  registerStudio();
  registerScenes();
  register();
  expressionBinding.setMode('stack'); // カードの押し方は localStorage に残るので、通常（重ねる）から始める
  studioRuntime.setScheduler({ request: () => () => {} }); // フレームは手で進める
});
afterEach(() => {
  cleanup();
  sceneWatcher.unbind();
  expressionBinding.setMode('stack');
  studioRuntime.setScheduler(animationFrameScheduler());
});

describe('スタジオの「表情」パネル', () => {
  it('スタジオの bottom に表情のカードが出る（値の無い表情はそう出す）', async () => {
    await setup();
    expect(document.querySelector('[data-area="bottom"] [data-panel-id="studioExpressions"]')).toBeTruthy();
    const names = within(panel().getByRole('group', { name: '表情のカード' }))
      .getAllByRole('button')
      .map((b) => b.querySelector('.sexpr-card-name')!.textContent);
    expect(names).toEqual(['笑顔', '怒り', '通常']);
    expect(card('通常 値なし')).toBeTruthy();
    expect(current()).toBe('いまの表情: なし');
  });

  it('カードを押すたびに表情を重ね、もう一度押すと外す。適用中のカードに順番の印を出す（仮実装でも動く）', async () => {
    const { services } = await setup({ services: { expressions: new FakeExpressions() } });
    expect(expressionBinding.bound()).toBe(services.expressions);
    press('笑顔');
    expect(services.expressions.actives()).toEqual(['smile']);
    expect(pressed('笑顔')).toBe('true');
    expect(order('笑顔')).toBe('1');
    expect(card('笑顔').title).toBe('もう一度押すと外す');
    expect(card('怒り').title).toBe('押すとこの表情を重ねる');
    expect(current()).toBe('いまの表情: 笑顔');
    expect(tick(16).MouthForm).toBe(0.8);

    press('怒り');
    expect(services.expressions.actives()).toEqual(['smile', 'angry']);
    expect([pressed('笑顔'), pressed('怒り'), pressed('通常 値なし')]).toEqual(['true', 'true', 'false']);
    expect([order('笑顔'), order('怒り'), order('通常 値なし')]).toEqual(['1', '2', null]);
    expect(current()).toBe('いまの表情: 笑顔＋怒り');
    expect(tick(32)).toMatchObject({ MouthForm: 0.8, BrowFormL: 1 });

    // 先に押した笑顔を外すと、怒りが1番目になる
    press('笑顔');
    expect(services.expressions.actives()).toEqual(['angry']);
    expect([pressed('笑顔'), pressed('怒り')]).toEqual(['false', 'true']);
    expect([order('笑顔'), order('怒り')]).toEqual([null, '1']);
    expect(tick(48)).toMatchObject({ MouthForm: 0, BrowFormL: 1 });

    press('怒り');
    expect(services.expressions.actives()).toEqual([]);
    expect(pressed('怒り')).toBe('false');
    expect(order('怒り')).toBeNull();
    expect(current()).toBe('いまの表情: なし');
    expect(tick(64)).toMatchObject({ MouthForm: 0, BrowFormL: 0 });
  });

  it('詳細モードの「1つずつ切り替え」で、押した表情だけにする（STEP1 の動き）。設定はこの PC に覚える', async () => {
    const { services } = await setup({ services: { expressions: new FakeExpressions() } });
    // かんたんでは「カードの押し方」を開いたときだけ出す
    expect(panel().queryByRole('checkbox', { name: '1つずつ切り替え' })).toBeNull();
    expect(panel().getByRole('button', { name: /カードの押し方/ })).toBeTruthy();
    toDetail(services);
    const single = panel().getByRole('checkbox', { name: '1つずつ切り替え' }) as HTMLInputElement;
    expect(single.checked).toBe(false);
    press('笑顔');
    press('怒り');
    expect(services.expressions.actives()).toEqual(['smile', 'angry']);

    act(() => {
      fireEvent.click(single);
    });
    expect(single.checked).toBe(true);
    expect(expressionBinding.mode()).toBe('single');
    expect(localStorage.getItem('live2d-studio.expressionCardMode')).toBe('single');
    // 切り替えただけでは、適用中の表情は変えない
    expect(services.expressions.actives()).toEqual(['smile', 'angry']);
    expect(card('笑顔').title).toBe('押すとこの表情だけにする');
    press('笑顔');
    expect(services.expressions.actives()).toEqual(['smile']);
    expect([pressed('笑顔'), pressed('怒り')]).toEqual(['true', 'false']);
    expect(card('笑顔').title).toBe('もう一度押すと解除する');
    press('怒り');
    expect(services.expressions.actives()).toEqual(['angry']);
    expect(tick(16)).toMatchObject({ MouthForm: 0, BrowFormL: 1 });
    press('怒り');
    expect(services.expressions.actives()).toEqual([]);

    // かんたんに戻しても設定は残る（表示を隠すだけ）
    act(() => services.editor.set({ uiLevel: { ...services.editor.get().uiLevel, studio: 'easy' } }));
    expect(panel().queryByRole('checkbox', { name: '1つずつ切り替え' })).toBeNull();
    press('笑顔');
    press('怒り');
    expect(services.expressions.actives()).toEqual(['angry']);

    // 戻すと重ねる
    toDetail(services);
    act(() => {
      fireEvent.click(panel().getByRole('checkbox', { name: '1つずつ切り替え' }));
    });
    expect(expressionBinding.mode()).toBe('stack');
    press('笑顔');
    expect(services.expressions.actives()).toEqual(['angry', 'smile']);
  });

  it('本物の ExpressionController では、押した時刻からフェードする', async () => {
    await setup({ services: { expressions: createExpressionController() } });
    tick(900);
    press('笑顔', 1000);
    expect(tick(1000).MouthForm).toBe(0);
    expect(tick(1100).MouthForm).toBeCloseTo(0.4, 10);
    expect(tick(1200).MouthForm).toBe(0.8);
    press('笑顔', 2000);
    expect(tick(2100).MouthForm).toBeCloseTo(0.4, 10);
    expect(tick(2200).MouthForm).toBe(0);
  });

  it('本物の ExpressionController で重ねると、片方だけ外したときはその表情だけがフェードで消える', async () => {
    await setup({ services: { expressions: createExpressionController() } });
    tick(900);
    press('笑顔', 1000);
    press('怒り', 1000);
    tick(1000);
    expect(tick(1200)).toMatchObject({ MouthForm: 0.8, BrowFormL: 1 });
    expect([order('笑顔'), order('怒り')]).toEqual(['1', '2']);
    press('笑顔', 2000); // 笑顔の fadeOut は 0.2 秒
    expect(order('怒り')).toBe('1');
    const half = tick(2100);
    expect(half.MouthForm).toBeCloseTo(0.4, 10);
    expect(half.BrowFormL).toBe(1);
    expect(tick(2200)).toMatchObject({ MouthForm: 0, BrowFormL: 1 });
  });

  it('シーンを切り替えたら、そのシーンの表情に切り替わる（適用はシーンの見張りの1回だけ）', async () => {
    const expressions = new FakeExpressions();
    const { store } = await setup({ services: { expressions } });
    const apply = vi.spyOn(expressions, 'apply');
    act(() => store.dispatch(selectSceneCommand('song')));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith('angry', expect.any(Number));
    tick(16);
    expect(pressed('怒り')).toBe('true');
    // 表情の指定が無いシーンでは外す
    act(() => store.dispatch(selectSceneCommand('chat')));
    expect(apply).toHaveBeenCalledTimes(2);
    tick(32);
    expect(pressed('怒り')).toBe('false');
  });

  it('カードで重ねていても、シーンを切り替えるとそのシーンの表情だけになる（apply はほかを外す）', async () => {
    const expressions = new FakeExpressions();
    const { store } = await setup({ services: { expressions } });
    press('笑顔');
    press('通常 値なし');
    expect(expressions.actives()).toEqual(['smile', 'plain']);
    act(() => store.dispatch(selectSceneCommand('song')));
    tick(16);
    expect(expressions.actives()).toEqual(['angry']);
    expect([pressed('笑顔'), pressed('通常 値なし'), pressed('怒り')]).toEqual(['false', 'false', 'true']);
    expect(order('怒り')).toBe('1');
  });

  it('ホットキーなどで services.expressions を直接切り替えても、次のフレームでカードに出る', async () => {
    const expressions = new FakeExpressions();
    await setup({ services: { expressions } });
    expressions.apply('smile', 0);
    tick(16);
    expect(pressed('笑顔')).toBe('true');
    // その表情のカードを押すと解除になる
    press('笑顔');
    expect(expressions.active()).toBeNull();
  });

  it('詳細モードで、表情ごとのフェードの秒数を変えられる（0〜10 秒。Undo）', async () => {
    const { services, store } = await setup();
    expect(panel().queryByRole('group', { name: '「笑顔」のフェード' })).toBeNull(); // かんたんでは隠す
    act(() => services.editor.set({ uiLevel: { ...services.editor.get().uiLevel, studio: 'detail' } }));
    const fade = within(panel().getByRole('group', { name: '「笑顔」のフェード' }));
    const fadeIn = fade.getByRole('spinbutton', { name: 'フェードイン' }) as HTMLInputElement;
    const fadeOut = fade.getByRole('spinbutton', { name: 'フェードアウト' }) as HTMLInputElement;
    expect([fadeIn.value, fadeOut.value]).toEqual(['0.2', '0.2']);

    act(() => {
      fireEvent.change(fadeIn, { target: { value: '0.5' } });
      fireEvent.blur(fadeIn);
    });
    expect(store.get().expressions[0]).toMatchObject({ fadeIn: 0.5, fadeOut: 0.2 });
    act(() => {
      fireEvent.change(fadeOut, { target: { value: '20' } });
      fireEvent.keyDown(fadeOut, { key: 'Enter' });
    });
    expect(store.get().expressions[0]).toMatchObject({ fadeIn: 0.5, fadeOut: 10 });
    expect(fadeOut.value).toBe('10');
    // 数でない入力は元に戻す
    act(() => {
      fireEvent.change(fadeIn, { target: { value: '' } });
      fireEvent.blur(fadeIn);
    });
    expect(fadeIn.value).toBe('0.5');

    act(() => store.undo());
    expect(store.get().expressions[0]).toMatchObject({ fadeIn: 0.5, fadeOut: 0.2 });
    act(() => store.undo());
    expect(store.get().expressions[0]).toEqual(smile);
  });

  it('表情が無ければ、モデリングで作ることを知らせる', async () => {
    await setup({ project: step1Project([]) });
    expect(panel().getByText(/表情がまだ無い/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: '表情のカード' })).toBeNull();
  });

  it('register を何度呼んでも、実行部には1つだけ入る', async () => {
    register();
    register();
    const expressions = createExpressionController();
    const produce = vi.spyOn(expressions, 'produce');
    await setup({ services: { expressions } });
    produce.mockClear();
    tick(16);
    expect(produce).toHaveBeenCalledTimes(1);
  });
});
