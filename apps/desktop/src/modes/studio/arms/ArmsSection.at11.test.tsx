import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { FakeArmService, type Renderer } from '@app/contracts';
import { createEmptyProject } from '@app/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeServices } from '../../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { register as registerStudio } from '../index';
import { register } from './index';

beforeEach(() => {
  registry.reset();
  registerStudio();
  register();
});
afterEach(() => vi.useRealTimers());
async function setup() {
  const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };
  const arms = new FakeArmService(),
    services = { ...createFakeServices(), arms, createRenderer: () => renderer };
  const environment = createEnvironmentStore(memoryEnvironmentStorage(JSON.stringify({ mirror: false })));
  const view = render(<Shell services={services} environment={environment} />);
  await act(async () => {
    await environment.load();
    services.store.load(createEmptyProject('CO independent UI'));
    services.editor.set({ mode: 'studio' });
  });
  const section = within(screen.getByRole('heading', { name: '腕・手' }).parentElement!);
  return { arms, services, environment, section, ...view };
}

describe('AT-11 CO画面独立確認', () => {
  it('左右の設定と固定形を独立に渡し、画面自身はProjectやEnvironmentを書き換えない', async () => {
    const { arms, services, environment, section } = await setup();
    const beforeProject = structuredClone(services.store.get()),
      beforeEnv = structuredClone(environment.get());
    fireEvent.click(section.getByRole('checkbox', { name: '右腕（あなたの右手）' }));
    fireEvent.change(section.getByRole('combobox', { name: '右腕の手形' }), {
      target: { value: 'peace' },
    });
    fireEvent.change(section.getByRole('combobox', { name: '左腕の手形' }), { target: { value: 'fist' } });
    expect(arms.settings().sides.R).toMatchObject({ enabled: true, handMode: 'peace' });
    expect(arms.settings().sides.L).toMatchObject({ enabled: false, handMode: 'fist' });
    expect(section.getByText(/右腕：モデルに腕の設定が無い/)).toBeTruthy();
    expect(services.store.get()).toEqual(beforeProject);
    expect(environment.get()).toEqual(beforeEnv);
  });

  it('古い診断を明示し、詳細を閉じた後は診断の購読を外す', async () => {
    vi.useFakeTimers();
    const { arms, section } = await setup();
    let active = 0;
    const original = arms.onDiagnostics.bind(arms);
    const subscribe = vi.spyOn(arms, 'onDiagnostics').mockImplementation((listener) => {
      active++;
      const off = original(listener);
      return () => {
        active--;
        off();
      };
    });
    const details = section.getByText('詳細（認識の状態・点・制限の理由）').parentElement as HTMLDetailsElement;
    expect(subscribe).not.toHaveBeenCalled();
    act(() => {
      details.open = true;
      fireEvent(details, new Event('toggle'));
    });
    expect(subscribe).toHaveBeenCalledOnce();
    act(() =>
      arms.setDiagnostics({
        time: performance.now() - 600,
        image: { width: 640, height: 480 },
        pose: null,
        hands: [],
        sides: {},
      }),
    );
    expect(section.getByText('点が古い（認識が止まっている）')).toBeTruthy();
    act(() => {
      details.open = false;
      fireEvent(details, new Event('toggle'));
    });
    expect(section.queryByText('点が古い（認識が止まっている）')).toBeNull();
    expect(active).toBe(0);
  });
});
