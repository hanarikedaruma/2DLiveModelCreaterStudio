import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@app/schema';
import {
  FakeArmService,
  FakeTrackingLayer,
  type ArmMotionStatus,
  type Renderer,
  type Services,
  type TrackingFrame,
  type TrackingSource,
} from '@app/contracts';
import { createParameterMixer } from '@app/core';
import { createCalibrationService } from '@app/tracking';
import { createFakeServices } from '../../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { register as registerStudio } from '../index';
import { animationFrameScheduler, studioRuntime } from '../runtime';
import { ARM_COUNT_INTERVAL_MS, ARM_COUNTDOWN_FROM } from './flow';
import { register } from './index';
import { sampleDiagnostics, SAMPLE_CALIBRATION, TestArmService } from './testService';

const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };

class QuietTrackingSource implements TrackingSource {
  started = false;
  configureCapture() {}
  captureStats() {
    return null;
  }
  onCaptureStats() {
    return () => {};
  }
  async listDevices() {
    return [{ id: 'cam', label: 'テストのカメラ' }];
  }
  async start() {
    this.started = true;
  }
  stop() {
    this.started = false;
  }
  onFrame(_listener: (f: TrackingFrame) => void) {
    return () => {};
  }
}

async function setup(options: { arms?: Services['arms'] | null; mirror?: boolean } = {}) {
  const arms = options.arms === undefined ? new TestArmService() : (options.arms ?? undefined);
  const tracking = new QuietTrackingSource();
  const services: Services = {
    ...createFakeServices(),
    createRenderer: () => renderer,
    mixer: createParameterMixer(),
    tracking,
    trackingLayer: new FakeTrackingLayer(),
    calibration: createCalibrationService(),
    arms,
  };
  const environment = createEnvironmentStore(
    memoryEnvironmentStorage(JSON.stringify({ mirror: options.mirror ?? true, cameraDeviceId: 'cam' })),
  );
  const utils = render(<Shell services={services} environment={environment} />);
  await act(async () => {
    await environment.load();
    services.store.load(createEmptyProject('テスト'));
    services.editor.set({ mode: 'studio' });
  });
  return { services, environment, tracking, arms: arms as TestArmService, ...utils };
}

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const section = () => within(screen.getByRole('heading', { name: '腕・手' }).parentElement!);
const dialog = () => within(screen.getByRole('dialog', { name: '腕の校正' }));
const settled = async (arms: TestArmService) =>
  act(async () => {
    await arms.finish();
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
const motion = (patch: Partial<ArmMotionStatus>): ArmMotionStatus => ({
  state: 'tracking',
  handState: 'tracking',
  pose: null,
  hand: null,
  reasons: [],
  ...patch,
});

beforeEach(() => {
  vi.useFakeTimers();
  registry.reset();
  registerStudio();
  register();
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

describe('スタジオの設定の「腕・手」', () => {
  it('サービスが無い・画面に要る操作が無いときは、使えない理由だけ出す', async () => {
    const none = await setup({ arms: null });
    expect(section().getByText('腕・手の追従は使えない（腕のサービスが無い）')).toBeTruthy();
    none.unmount();
    registry.reset();
    registerStudio();
    register();
    const incomplete = new FakeArmService();
    // AT-03で仮サービスも診断対応になったため、この異常系だけ能力を欠かせる。
    Object.defineProperty(incomplete, 'diagnostics', { value: undefined });
    await setup({ arms: incomplete });
    expect(section().getByText(/設定の読み出し・診断に対応していない/)).toBeTruthy();
  });

  it('左右の有効はモデルの左右で、どちらの手で動くかをミラーに合わせて書き、サービスへ渡す', async () => {
    const { arms } = await setup();
    const set = vi.spyOn(arms, 'setSettings');
    const left = section().getByRole('checkbox', { name: '左腕（あなたの右手）' });
    expect(section().getByRole('checkbox', { name: '右腕（あなたの左手）' })).toBeTruthy();
    expect(section().getByText('左腕・右腕のどちらかを入れると、カメラで腕が動く')).toBeTruthy();
    fireEvent.click(left);
    expect(set).toHaveBeenLastCalledWith(
      expect.objectContaining({ sides: expect.objectContaining({ L: expect.objectContaining({ enabled: true }) }) }),
    );
    expect(arms.settings().sides.R.enabled).toBe(false);
    expect((section().getByRole('checkbox', { name: '左腕（あなたの右手）' }) as HTMLInputElement).checked).toBe(true);
  });

  it('ミラーOFFでは同じ側の手で動く', async () => {
    await setup({ mirror: false });
    expect(section().getByRole('checkbox', { name: '左腕（あなたの左手）' })).toBeTruthy();
  });

  it('入れた腕の準備の不足を具体的に出し、［校正する］で校正を始められる', async () => {
    const { arms } = await setup();
    act(() =>
      arms.setSettings({
        ...arms.settings(),
        sides: { ...arms.settings().sides, R: { ...arms.settings().sides.R, enabled: true } },
      }),
    );
    const list = within(section().getByRole('list', { name: '腕の準備' }));
    expect(list.getByText('⚠ 右腕：モデルに腕の設定が無い（モデリングの「腕の設定」で作る）')).toBeTruthy();
    expect(list.getByText(/腕を校正していない/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(list.getByRole('button', { name: '校正する' }));
    });
    expect(screen.getByRole('dialog', { name: '腕の校正' })).toBeTruthy();
  });

  it('手形の固定・動きの大きさはサービスへ渡し、固定しても腕の有効は変えない。スライダーは離したときに渡す', async () => {
    const { arms } = await setup();
    act(() =>
      arms.setSettings({
        ...arms.settings(),
        sides: { ...arms.settings().sides, L: { ...arms.settings().sides.L, enabled: true } },
      }),
    );
    const set = vi.spyOn(arms, 'setSettings');
    fireEvent.change(section().getByRole('combobox', { name: '左腕の手形' }), { target: { value: 'fist' } });
    expect(arms.settings().sides.L).toMatchObject({ handMode: 'fist', enabled: true });
    expect(section().getByText('手形を固定しても、腕はカメラに合わせて動く')).toBeTruthy();
    const gain = section().getByRole('slider', { name: '左腕の動きの大きさ' });
    set.mockClear();
    fireEvent.change(gain, { target: { value: '1.5' } });
    expect(set).not.toHaveBeenCalled();
    fireEvent.pointerUp(gain);
    expect(arms.settings().sides.L.gain).toBe(1.5);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('左右の状態を出す', async () => {
    const { arms } = await setup();
    act(() => {
      const s = arms.settings();
      arms.setSettings({ ...s, sides: { L: { ...s.sides.L, enabled: true }, R: { ...s.sides.R, enabled: true } } });
      arms.setStatus({
        ...arms.status(),
        motion: { L: motion({ hand: 'peace' }), R: motion({ state: 'holding', handState: 'holding', hand: 'open' }) },
      });
    });
    const status = within(section().getByLabelText('腕の状態'));
    expect(status.getByText('追従中・ピース（手形を追従）')).toBeTruthy();
    expect(status.getByText('手を見失っている（保持）・パー（手形を保持）')).toBeTruthy();
  });

  it('校正：点が写るのを待ち、数えて4手順を集め、手形を試して閉じる。保存はサービスに任せる', async () => {
    const { arms, tracking, environment, services } = await setup();
    await act(async () => {
      fireEvent.click(section().getByRole('button', { name: '腕の校正' }));
    });
    expect(tracking.started).toBe(true); // 止まっていれば顔の校正と同じ道で開始する
    expect(dialog().getByLabelText('待っている理由').textContent).toMatch(/体の点が来ていない/);
    act(() => arms.emitDiagnostics(sampleDiagnostics(['leftShoulder'])));
    expect(dialog().getByLabelText('待っている理由').textContent).toBe('あなたの右肩が写っていない。写ると数え始める');
    act(() => arms.emitDiagnostics(sampleDiagnostics()));
    expect(dialog().getByLabelText('カウント').textContent).toBe(String(ARM_COUNTDOWN_FROM));
    for (let step = 0; step < 4; step++) {
      await advance(ARM_COUNTDOWN_FROM * ARM_COUNT_INTERVAL_MS);
      expect(dialog().getByLabelText('カウント').textContent).toBe('そのまま');
      await settled(arms);
    }
    expect(arms.captures).toEqual(['neutral', 'bend', 'left', 'right']);
    const shapes = within(dialog().getByRole('table', { name: '認識できた手形' }));
    act(() =>
      arms.setStatus({ ...arms.status(), motion: { L: motion({ hand: 'point' }), R: motion({ state: 'off' }) } }),
    );
    expect(shapes.getByLabelText('指さし：認識できた')).toBeTruthy();
    fireEvent.click(dialog().getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog', { name: '腕の校正' })).toBeNull();
    expect(arms.calibration()).toEqual(SAMPLE_CALIBRATION);
    expect(section().getByRole('button', { name: '未校正に戻す' })).toBeTruthy();
    // 画面は Environment・Project に書かない（保存はサービス。AT-12）
    expect(environment.get().armCalibration ?? null).toBeNull();
    expect(services.store.get().armTracking).toBeUndefined();
  });

  it('校正の失敗は理由を出してその手順をやり直せ、キャンセルで前の校正が残る', async () => {
    const { arms } = await setup();
    act(() => arms.setCalibrationResult(SAMPLE_CALIBRATION));
    act(() => arms.emitDiagnostics(sampleDiagnostics()));
    await act(async () => {
      fireEvent.click(section().getByRole('button', { name: '腕の校正' }));
    });
    await advance(ARM_COUNTDOWN_FROM * ARM_COUNT_INTERVAL_MS);
    await act(async () => {
      await arms.finish({ invalid: '両肩が写っていないフレームが多い' });
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(dialog().getByRole('alert').textContent).toBe('両肩が写っていないフレームが多い');
    fireEvent.click(dialog().getByRole('button', { name: 'もう一度' }));
    expect(dialog().getByLabelText('カウント').textContent).toBe(String(ARM_COUNTDOWN_FROM));
    fireEvent.keyDown(screen.getByRole('dialog', { name: '腕の校正' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '腕の校正' })).toBeNull();
    expect(arms.cancels).toBe(1);
    expect(arms.calibration()).toEqual(SAMPLE_CALIBRATION);
    fireEvent.click(section().getByRole('button', { name: '未校正に戻す' }));
    expect(arms.calibration()).toBeNull();
  });

  it('骨格はミラーに合わせて1回だけ反転する（ONは演者の右肩が枠の右）', async () => {
    for (const mirror of [true, false]) {
      registry.reset();
      registerStudio();
      register();
      const { arms, unmount } = await setup({ mirror });
      act(() => arms.emitDiagnostics(sampleDiagnostics(['leftShoulder'])));
      await act(async () => {
        fireEvent.click(section().getByRole('button', { name: '腕の校正' }));
      });
      const svg = dialog().getByRole('img', { name: '肩・肘・手首の位置' });
      const x = (part: string) => Number(svg.querySelector(`[data-part="${part}"]`)!.getAttribute('data-x'));
      const middle = Number(svg.getAttribute('width')) / 2;
      expect(x('rightShoulder') > middle).toBe(mirror);
      expect(x('leftShoulder') > middle).toBe(!mirror);
      expect(svg.querySelector('[data-part="rightShoulder"]')!.getAttribute('data-visible')).toBe('false');
      expect(dialog().getByText(mirror ? /ミラーON：鏡のように表示/ : /ミラーOFF：カメラから見たまま/)).toBeTruthy();
      unmount();
    }
  });

  it('詳細は開いている間だけ診断を購読し、古い診断を示す', async () => {
    const { arms } = await setup();
    expect(arms.diagnosticListenerCount()).toBe(0);
    const details = section().getByText('詳細（認識の状態・点・制限の理由）').parentElement as HTMLDetailsElement;
    act(() => {
      details.open = true;
      fireEvent(details, new Event('toggle'));
    });
    expect(arms.diagnosticListenerCount()).toBe(1);
    act(() => arms.emitDiagnostics(sampleDiagnostics(undefined, performance.now() - 5000)));
    await advance(300);
    const points = within(section().getByLabelText('左右の点'));
    expect(points.getByText('点が古い（認識が止まっている）')).toBeTruthy();
    expect(points.getByText('14.00, 128.00 ／ 14.00, 125.00')).toBeTruthy();
    expect(points.getByText('肘の範囲')).toBeTruthy();
    act(() => {
      details.open = false;
      fireEvent(details, new Event('toggle'));
    });
    expect(arms.diagnosticListenerCount()).toBe(0);
  });
});
