import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultEnvironment, createEmptyProject } from '@app/schema';
import type { Background, DeformedModel, OutputSink, Renderer, Services, ViewTransform } from '@app/contracts';
import { createFakeServices } from '../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../shell/environment';
import { registry } from '../../shell/registry';
import { Shell } from '../../shell/Shell';
import { register as registerStudio } from '../../modes/studio';
import { animationFrameScheduler, studioRuntime } from '../../modes/studio/runtime';
import { spoutOutput } from './controller';
import { register } from './index';
import { listSpoutAdapters } from './adapters';
vi.mock('./adapters', () => ({ listSpoutAdapters: vi.fn(async () => null) }));

// jsdom には 2D/WebGL のコンテキストが無いので、何も描かないレンダラーにする
const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };

class RecordingSink implements OutputSink {
  log: string[] = [];
  submitted = 0;
  failStart: string | null = null;
  async start(o: { width: number; height: number; fps: number }) {
    this.log.push(`start ${o.width}x${o.height}@${o.fps}`);
    if (this.failStart) throw new Error(this.failStart);
  }
  async setTextures(_pngs: Record<string, Uint8Array>) {}
  submit(_model: DeformedModel, _view: ViewTransform, _background: Background) {
    this.submitted++;
  }
  async stop() {
    this.log.push('stop');
  }
}

async function setup(environmentText: string | null = null) {
  const sink = new RecordingSink();
  const services: Services = { ...createFakeServices(), createRenderer: () => renderer, spout: sink };
  const environment = createEnvironmentStore(memoryEnvironmentStorage(environmentText));
  render(<Shell services={services} environment={environment} />);
  await act(async () => {
    await environment.load();
    services.store.load(createEmptyProject('テスト'));
    services.editor.set({ mode: 'studio' });
  });
  await act(() => spoutOutput.whenIdle());
  return { services, environment, sink };
}

const section = () => within(screen.getByRole('heading', { name: '出力の方式' }).parentElement!);
const pressed = (name: string) =>
  within(screen.getByRole('group', { name: '出力の方式' }))
    .getByRole('button', { name })
    .getAttribute('aria-pressed');
const choose = async (name: string) => {
  await act(async () => {
    fireEvent.click(within(screen.getByRole('group', { name: '出力の方式' })).getByRole('button', { name }));
  });
  await act(() => spoutOutput.whenIdle());
};

beforeEach(() => {
  vi.mocked(listSpoutAdapters).mockResolvedValue(null);
  registry.reset();
  registerStudio();
  register();
  studioRuntime.setScheduler({ request: () => () => {} }); // フレームは tick で進める
});
afterEach(async () => {
  await spoutOutput.stop();
  studioRuntime.setScheduler(animationFrameScheduler());
});

describe('出力の方式', () => {
  it('従来のLUIDで保存したGPUが見つかれば、既定に戻さず保存用の識別子へ移す', async () => {
    const id = 'pci:10de:28a1:12345678:00000001:NVIDIA GeForce RTX 4050';
    const legacyId = '00000000:00013a29';
    vi.mocked(listSpoutAdapters).mockResolvedValue([{ id, name: 'NVIDIA GeForce RTX 4050', legacyId }]);
    const env = createDefaultEnvironment();
    env.output = { ...env.output, method: 'spout2', adapterId: legacyId };
    const { environment } = await setup(JSON.stringify(env));
    await waitFor(() => expect(environment.get().output.adapterId).toBe(id));
    expect((section().getByRole('combobox', { name: 'Spout2 の GPU' }) as HTMLSelectElement).value).toBe(id);
    expect(section().queryByText('選んだGPUが見つからないため、既定のGPUに戻した')).toBeNull();
    await environment.flush();
  });

  it('GPUの一覧から選び、保存したGPUを復元し、GPU変更で送信を作り直す', async () => {
    vi.mocked(listSpoutAdapters).mockResolvedValue([
      { id: 'gpu-1', name: '内蔵GPU' },
      { id: 'gpu-2', name: '外付けGPU' },
    ]);
    const env = createDefaultEnvironment();
    env.output = { ...env.output, method: 'spout2', adapterId: 'gpu-1' };
    const { environment, sink } = await setup(JSON.stringify(env));
    const select = (await section().findByRole('combobox', { name: 'Spout2 の GPU' })) as HTMLSelectElement;
    await waitFor(() => expect(select.disabled).toBe(false));
    expect(select.value).toBe('gpu-1');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'gpu-2' } });
    });
    await act(() => spoutOutput.whenIdle());
    expect(environment.get().output.adapterId).toBe('gpu-2');
    expect(sink.log).toEqual(['start 1920x1080@60', 'stop', 'start 1920x1080@60']);
    await environment.flush();
  });
  it('保存したGPUが見つからなければ既定へ戻して知らせる', async () => {
    vi.mocked(listSpoutAdapters).mockResolvedValue([{ id: 'gpu-1', name: '内蔵GPU' }]);
    const env = createDefaultEnvironment();
    env.output = { ...env.output, method: 'spout2', adapterId: 'removed' };
    const { environment } = await setup(JSON.stringify(env));
    await waitFor(() => expect(environment.get().output.adapterId).toBeNull());
    expect(section().getByText(/見つからないため、既定のGPUに戻した/)).toBeTruthy();
  });
  it('はじめはウィンドウで、Spout2 は動かさない', async () => {
    const { sink } = await setup();
    expect(pressed('ウィンドウ')).toBe('true');
    expect(pressed('Spout2')).toBe('false');
    expect(section().queryByRole('combobox', { name: 'fps' })).toBeNull();
    expect(sink.log).toEqual([]);
  });

  it('Spout2 を選ぶと Environment に保存し、出力の解像度と fps で送り始める', async () => {
    const { environment, sink } = await setup();
    await choose('Spout2');
    expect(environment.get().output.method).toBe('spout2');
    expect(sink.log).toEqual(['start 1920x1080@60']);
    expect(section().getByLabelText('Spout2 の状態').textContent).toBe('送信中');
    expect(section().getByText(/送り手「2D Liver」/)).toBeTruthy();
    // 毎フレーム送る
    act(() => {
      studioRuntime.tick(1000);
      studioRuntime.tick(1016);
    });
    expect(sink.submitted).toBe(2);
    // OBS での受け取り方
    expect(section().getByText('OBS での受け取り方')).toBeTruthy();
    expect(section().getByText(/Spout2 Capture/)).toBeTruthy();
  });

  it('fps と解像度を変えると作り直し、ウィンドウに戻すと止める', async () => {
    const { environment, sink } = await setup();
    await choose('Spout2');
    await act(async () => {
      fireEvent.change(section().getByRole('combobox', { name: 'fps' }), { target: { value: '30' } });
    });
    await act(() => spoutOutput.whenIdle());
    expect(environment.get().output.fps).toBe(30);
    await act(async () => {
      fireEvent.change(screen.getByRole('combobox', { name: '解像度' }), { target: { value: '1280x720' } });
    });
    await act(() => spoutOutput.whenIdle());
    expect(sink.log).toEqual(['start 1920x1080@60', 'stop', 'start 1920x1080@30', 'stop', 'start 1280x720@30']);
    await choose('ウィンドウ');
    expect(sink.log.at(-1)).toBe('stop');
    expect(environment.get().output.method).toBe('window');
  });

  it('スタジオの画面を離れても送り続ける', async () => {
    const { services, sink } = await setup();
    await choose('Spout2');
    await act(async () => {
      services.editor.set({ mode: 'modeling' });
    });
    act(() => {
      studioRuntime.tick(2000);
    });
    expect(sink.submitted).toBe(1);
    expect(sink.log).toEqual(['start 1920x1080@60']);
  });

  it('始められなければ理由を出し、やり直せる', async () => {
    const { sink } = await setup();
    sink.failStart = 'Spout2 の出力は Windows のアプリでだけ使える';
    await choose('Spout2');
    expect(section().getByLabelText('Spout2 の状態').textContent).toBe('送れない');
    expect(section().getByText('Spout2 の出力は Windows のアプリでだけ使える')).toBeTruthy();
    sink.failStart = null;
    await act(async () => {
      fireEvent.click(section().getByRole('button', { name: 'やり直す' }));
    });
    await act(() => spoutOutput.whenIdle());
    expect(section().getByLabelText('Spout2 の状態').textContent).toBe('送信中');
  });

  it('保存してある Spout2 の設定で開くと、そのまま送り始める', async () => {
    const { sink } = await setup(JSON.stringify({ output: { method: 'spout2', width: 1280, height: 720, fps: 30 } }));
    expect(pressed('Spout2')).toBe('true');
    expect(sink.log).toEqual(['start 1280x720@30']);
  });
});
