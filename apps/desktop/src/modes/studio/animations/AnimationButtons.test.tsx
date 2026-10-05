import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, ensureStandardParameters, type Animation, type Hotkey, type Project } from '@app/schema';
import { FakeAnimationPlayer, type Renderer, type Services } from '@app/contracts';
import { createAnimationPlayer, createParameterMixer } from '@app/core';
import { createFakeServices } from '../../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { emitAppEvent } from '../../../shell/api';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { ANIMATION_EVENT, createHotkeyActions } from '../../../hotkeys/actions';
import { register as registerStudio } from '../index';
import { animationFrameScheduler, studioRuntime } from '../runtime';
import { animationBinding } from './binding';
import { register } from './index';

function animation(id: string, name: string, patch: Partial<Animation> = {}): Animation {
  return {
    id,
    name,
    duration: 1,
    speed: 1,
    loop: false,
    periodic: false,
    tracks: [{ parameterId: 'FaceAngleX', keyframes: [{ time: 0, value: 20, curve: 'linear' }] }],
    affectedGroups: [],
    restart: 'restart',
    transition: {
      preset: 'custom',
      blendIn: 0.2,
      blendOut: 0.2,
      curve: 'linear',
      blendMode: 'override',
      keepLipSync: true,
      keepPhysics: true,
      returnToTracking: true,
    },
    ...patch,
  };
}

const wave = animation('wave', '手を振る');
const nod = animation('nod', 'うなずき', { loop: true });
const breath = animation('breath', '呼吸', { periodic: true, loop: true });

function step2Project(animations: Animation[] = [wave, nod, breath]): Project {
  const p = createEmptyProject('テスト');
  return { ...p, model: ensureStandardParameters(p.model, 'step2'), animations };
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
    services.store.load(options.project ?? step2Project());
    services.editor.set({ mode: 'studio' });
  });
  return { services };
}

const panel = () => within(document.querySelector<HTMLElement>('[data-panel-id="studioAnimations"]')!);
const buttons = () => within(panel().getByRole('group', { name: 'アニメーションのボタン' }));
const button = (name: string | RegExp) => buttons().getByRole('button', { name });
const pressed = (name: string | RegExp) => button(name).getAttribute('aria-pressed');
const press = (name: string | RegExp, now = 0) => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(now);
  act(() => {
    fireEvent.click(button(name));
  });
  clock.mockRestore();
};
const withClock = (now: number, run: () => void) => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(now);
  act(run);
  clock.mockRestore();
};
function tick(now: number) {
  let params: Record<string, number> = {};
  act(() => {
    params = studioRuntime.tick(now)!.params;
  });
  return params;
}
const current = () => panel().getByLabelText('再生中のアニメーション').textContent;

beforeEach(() => {
  registry.reset();
  registerStudio();
  register();
  studioRuntime.setScheduler({ request: () => () => {} }); // フレームは手で進める
});
afterEach(() => {
  cleanup();
  studioRuntime.setScheduler(animationFrameScheduler());
});

describe('スタジオの「アニメーション」パネル', () => {
  it('スタジオの bottom にアニメーションのボタンが並ぶ（周期アニメーションは出さない）', async () => {
    await setup();
    expect(document.querySelector('[data-area="bottom"] [data-panel-id="studioAnimations"]')).toBeTruthy();
    const names = buttons()
      .getAllByRole('button')
      .map((b) => b.querySelector('.sanim-button-name')!.textContent);
    expect(names).toEqual(['手を振る', 'うなずき']);
    expect(button('うなずき ループ')).toBeTruthy();
    expect(current()).toBe('再生中: なし');
  });

  it('押すと再生し、もう一度押すとやめる（仮実装でも動く）', async () => {
    const { services } = await setup({ services: { animations: new FakeAnimationPlayer() } });
    expect(animationBinding.bound()).toBe(services.animations);
    press('手を振る', 100);
    expect(services.animations.playing()).toEqual(['wave']);
    expect(pressed('手を振る')).toBe('true');
    expect(current()).toBe('再生中: 手を振る');
    press('手を振る', 200);
    expect(services.animations.playing()).toEqual([]);
    expect(pressed('手を振る')).toBe('false');
    expect(current()).toBe('再生中: なし');
  });

  it('本物の AnimationPlayer では、押した時刻から遷移し、終わるとボタンが戻る', async () => {
    await setup({ services: { animations: createAnimationPlayer() } });
    expect(tick(900).FaceAngleX).toBe(0);
    press('手を振る', 1000);
    expect(tick(1000).FaceAngleX).toBe(0);
    expect(tick(1100).FaceAngleX).toBeCloseTo(10, 9);
    expect(tick(1200).FaceAngleX).toBe(20);
    expect(pressed('手を振る')).toBe('true');
    // 1 秒で終わり、0.2 秒で戻る
    expect(tick(2100).FaceAngleX).toBeCloseTo(10, 9);
    expect(pressed('手を振る')).toBe('false');
    expect(tick(2200).FaceAngleX).toBe(0);

    // ループは終わらないので、もう一度押すまで続く。別のものを押すと切り替わる
    press(/うなずき/, 3000);
    tick(5000);
    expect(pressed(/うなずき/)).toBe('true');
    press('手を振る', 5000);
    tick(5000);
    expect([pressed(/うなずき/), pressed('手を振る')]).toEqual(['false', 'true']);
    expect(current()).toBe('再生中: 手を振る');
  });

  it('ホットキー（hotkey:animation）で再生 / やめる。toggle と hold', async () => {
    const { services } = await setup({ services: { animations: createAnimationPlayer() } });
    const play = vi.spyOn(services.animations, 'play');
    const stop = vi.spyOn(services.animations, 'stop');
    withClock(100, () => emitAppEvent(ANIMATION_EVENT, { targetId: 'wave', phase: 'down', mode: 'toggle' }));
    expect(play).toHaveBeenLastCalledWith('wave', 100);
    expect(pressed('手を振る')).toBe('true');
    withClock(200, () => emitAppEvent(ANIMATION_EVENT, { targetId: 'wave', phase: 'down', mode: 'toggle' }));
    expect(stop).toHaveBeenLastCalledWith('wave', 200);
    expect(pressed('手を振る')).toBe('false');

    withClock(300, () => emitAppEvent(ANIMATION_EVENT, { targetId: 'nod', phase: 'down', mode: 'hold' }));
    expect(play).toHaveBeenLastCalledWith('nod', 300);
    expect(pressed(/うなずき/)).toBe('true');
    withClock(400, () => emitAppEvent(ANIMATION_EVENT, { targetId: 'nod', phase: 'up', mode: 'hold' }));
    expect(stop).toHaveBeenLastCalledWith('nod', 400);
    expect(pressed(/うなずき/)).toBe('false');

    // 形の違う値は無視する
    play.mockClear();
    act(() => emitAppEvent(ANIMATION_EVENT, { targetId: 'wave' }));
    expect(play).not.toHaveBeenCalled();
  });

  it('ホットキーの動作（カード40）が出すイベントを受けて再生し、実行部の値に出る', async () => {
    const { services } = await setup({ services: { animations: createAnimationPlayer() } });
    const actions = createHotkeyActions();
    actions.setContext({
      services,
      now: () => 1000,
      emit: emitAppEvent,
      trackingSessionActive: () => false,
      cameraDeviceId: () => null,
      expressionMode: () => 'stack',
      notify: () => {},
    });
    const hotkey: Hotkey = { id: 'h1', keys: 'Ctrl+Shift+1', action: 'animation', targetId: 'wave', mode: 'hold' };
    withClock(1000, () => actions.handle(hotkey, 'down'));
    expect(pressed('手を振る')).toBe('true');
    expect(tick(1200).FaceAngleX).toBe(20);
    withClock(1500, () => actions.handle(hotkey, 'up'));
    expect(pressed('手を振る')).toBe('false');
    expect(tick(1600).FaceAngleX).toBeCloseTo(10, 9);
    expect(tick(1700).FaceAngleX).toBe(0);
  });

  it('アニメーションが無ければ、アニメーションのモードで作ることを知らせる', async () => {
    await setup({ project: step2Project([breath]) });
    expect(panel().getByText(/アニメーションがまだ無い/)).toBeTruthy();
    expect(panel().queryByRole('group', { name: 'アニメーションのボタン' })).toBeNull();
  });

  it('register を何度呼んでも、実行部の producer とホットキーの受け口は1つだけ', async () => {
    register();
    register();
    const animations = createAnimationPlayer();
    const produce = vi.spyOn(animations, 'produce');
    const play = vi.spyOn(animations, 'play');
    await setup({ services: { animations } });
    produce.mockClear();
    tick(16);
    expect(produce).toHaveBeenCalledTimes(1);
    act(() => emitAppEvent(ANIMATION_EVENT, { targetId: 'wave', phase: 'down', mode: 'hold' }));
    expect(play).toHaveBeenCalledTimes(1);
  });
});
