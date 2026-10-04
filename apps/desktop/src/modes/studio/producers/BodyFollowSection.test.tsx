import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, ensureStandardParameters, type Project } from '@app/schema';
import { FakeBodyFollow, FakeTrackingLayer, FakeTrackingSource, type Renderer, type Services } from '@app/contracts';
import { createBodyFollowProducer, createParameterMixer } from '@app/core';
import { createFakeServices } from '../../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { register as registerStudio } from '../index';
import { animationFrameScheduler, studioRuntime } from '../runtime';
import { bodyFollowBinding } from './bodyFollow';
import { register } from './index';

function step1Project(): Project {
  const p = createEmptyProject('テスト');
  return { ...p, model: ensureStandardParameters(p.model, 'step1') };
}

// jsdom には 2D/WebGL のコンテキストが無いので、何も描かないレンダラーにする
const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };

async function setup(options: { services?: Partial<Services>; project?: Project } = {}) {
  const services: Services = {
    ...createFakeServices(),
    createRenderer: () => renderer,
    mixer: createParameterMixer(),
    tracking: new FakeTrackingSource(() => Date.now()),
    trackingLayer: new FakeTrackingLayer(),
    ...options.services,
  };
  const environment = createEnvironmentStore(memoryEnvironmentStorage(null));
  const utils = render(<Shell services={services} environment={environment} />);
  await act(async () => {
    services.store.load(options.project ?? step1Project());
    services.editor.set({ mode: 'studio' });
  });
  return { services, ...utils };
}

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

beforeEach(() => {
  vi.useFakeTimers();
  registry.reset();
  registerStudio();
  register();
  bodyFollowBinding.setStrength('standard');
  studioRuntime.setScheduler({
    request(cb) {
      const id = setTimeout(() => cb(Date.now()), 16);
      return () => clearTimeout(id);
    },
  });
});
afterEach(() => {
  studioRuntime.stopTracking();
  vi.useRealTimers();
  studioRuntime.setScheduler(animationFrameScheduler());
});

describe('スタジオの設定の「体の動き」', () => {
  it('控えめ / 標準 / 大きめ を選べ、services.bodyFollow へ渡す（仮実装でも動く）', async () => {
    const body = new FakeBodyFollow();
    await setup({ services: { bodyFollow: body } });
    expect(screen.getByRole('group', { name: '体の動き' })).toBeTruthy();
    expect(pressed('標準')).toBe('true');
    expect(pressed('控えめ')).toBe('false');
    expect(bodyFollowBinding.bound()).toBe(body);
    expect(body.strength).toBe('standard');

    fireEvent.click(screen.getByRole('button', { name: '大きめ' }));
    expect(pressed('大きめ')).toBe('true');
    expect(pressed('標準')).toBe('false');
    expect(body.strength).toBe('high');
    fireEvent.click(screen.getByRole('button', { name: '控えめ' }));
    expect(body.strength).toBe('low');
    expect(pressed('控えめ')).toBe('true');
  });

  it('スタジオで BodyAngleX・BodyAngleZ が顔に合わせて出る（本物の体の追従をつないだとき）', async () => {
    await setup({ services: { bodyFollow: createBodyFollowProducer() } });
    await advance(50);
    expect(studioRuntime.lastFrame()!.params).toMatchObject({ BodyAngleX: 0, BodyAngleZ: 0 });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '開始' }));
    });
    // 仮のトラッキングは 4 秒で左右に 20 度ずつ振る。どのフレームでも 体 = 顔 × 0.3
    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      await advance(100);
      const { params } = studioRuntime.lastFrame()!;
      expect(params.BodyAngleX).toBeCloseTo(params.FaceAngleX! * 0.3, 10);
      expect(params.BodyAngleZ).toBeCloseTo(params.FaceAngleZ! * 0.3, 10);
      samples.push(params.BodyAngleX!);
    }
    expect(Math.max(...samples)).toBeGreaterThan(5); // 顔が右を向くと体も右へ（20 × 0.3 = 6 に近い）
    expect(Math.min(...samples)).toBeLessThan(-5);

    fireEvent.click(screen.getByRole('button', { name: '大きめ' }));
    await advance(100);
    const { params } = studioRuntime.lastFrame()!;
    expect(params.BodyAngleX).toBeCloseTo(params.FaceAngleX! * 0.45, 10);
  });

  it('モデルに体のパラメータが無ければ、動かないことを知らせる', async () => {
    await setup({ project: createEmptyProject('MVP') });
    expect(screen.getByText(/体のパラメータ（BodyAngleX・BodyAngleZ）が無い/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '開始' }));
    });
    await advance(500);
    expect('BodyAngleX' in studioRuntime.lastFrame()!.params).toBe(false);
  });

  it('体のパラメータがあれば知らせは出さない', async () => {
    await setup();
    expect(screen.queryByText(/体のパラメータ（BodyAngleX・BodyAngleZ）が無い/)).toBeNull();
  });

  it('register を何度呼んでも、実行部には1つだけ入る', async () => {
    register();
    register();
    const body = createBodyFollowProducer();
    const produce = vi.spyOn(body, 'produce');
    await setup({ services: { bodyFollow: body } });
    produce.mockClear();
    studioRuntime.tick(Date.now());
    expect(produce).toHaveBeenCalledTimes(1);
  });
});
