import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, createEmptyScene, ensureStandardParameters } from '@app/schema';
import { createProjectStore, withStandardBreathAnimation } from '@app/core';
import { FakePeriodic } from '@app/contracts';
import { createFakeServices } from '../../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { register as registerStudio } from '../index';
import { register as registerScenes, sceneWatcher } from '../scenes';
import { selectSceneCommand } from '../scenes/commands';
import { studioRuntime } from '../runtime';
import { createPeriodicBinding, periodicBinding } from './binding';
import { ensureStandardBreath, setScenePeriodicCommand, setAnimationPeriodicCommand } from './commands';
import { register } from './index';

function project() {
  const p = withStandardBreathAnimation(createEmptyProject('周期'));
  return {
    ...p,
    model: ensureStandardParameters(p.model, 'step2'),
    studio: {
      ...p.studio,
      scenes: [
        { ...createEmptyScene('雑談'), id: 'chat', periodicAnimationIds: ['standard-breath'] },
        { ...createEmptyScene('歌'), id: 'song' },
      ],
      activeSceneId: 'chat',
    },
  };
}
afterEach(() => {
  cleanup();
  periodicBinding.unbind();
  sceneWatcher.unbind();
});

describe('周期アニメーションの接続', () => {
  it('シーン・Undo・periodicの変更を反映し、同じイベントでは二重に更新しない', () => {
    const store = createProjectStore(project());
    const periodic = new FakePeriodic();
    const setActive = vi.spyOn(periodic, 'setActive');
    const binding = createPeriodicBinding();
    binding.bind({ store, periodic });
    expect(binding.active()).toEqual(['standard-breath']);
    store.dispatch(selectSceneCommand('song'));
    expect(binding.active()).toEqual([]);
    const count = setActive.mock.calls.length;
    binding.sceneChanged('song');
    expect(setActive).toHaveBeenCalledTimes(count);
    store.undo();
    expect(binding.active()).toEqual(['standard-breath']);
    store.dispatch(setAnimationPeriodicCommand('standard-breath', false));
    expect(binding.active()).toEqual([]);
    store.undo();
    expect(binding.active()).toEqual(['standard-breath']);
    binding.unbind();
  });
  it('標準の呼吸は重複せず、編集中のUndo履歴を消さない', () => {
    const store = createProjectStore(createEmptyProject('空'));
    expect(ensureStandardBreath(store)).toBe(true);
    expect(ensureStandardBreath(store)).toBe(false);
    store.dispatch({ label: '呼吸を削除', apply: (p) => ({ ...p, animations: [] }) });
    expect(ensureStandardBreath(store)).toBe(false);
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.get().animations).toHaveLength(1);
  });
  it('画面のチェックがシーンに保存され、Undoで戻る', async () => {
    registry.reset();
    registerStudio();
    registerScenes();
    register();
    register();
    studioRuntime.setScheduler({ request: () => () => {} });
    const services = {
      ...createFakeServices(),
      createRenderer: () => ({ init() {}, setTextures() {}, render() {}, dispose() {} }),
    };
    services.store.load(project());
    services.editor.set({ mode: 'studio' });
    render(<Shell services={services} environment={createEnvironmentStore(memoryEnvironmentStorage(null))} />);
    const check = await screen.findByRole('checkbox', { name: '呼吸' });
    expect((check as HTMLInputElement).checked).toBe(true);
    act(() => {
      fireEvent.click(check);
    });
    expect(services.store.get().studio.scenes[0]!.periodicAnimationIds).toEqual([]);
    act(() => services.store.undo());
    expect((check as HTMLInputElement).checked).toBe(true);
    act(() => services.store.dispatch(setScenePeriodicCommand('standard-breath', false)));
    expect(periodicBinding.active()).toEqual([]);
  });
});
