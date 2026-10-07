// カード69（Spout2 の復帰と GPU の選択・I-032）のテスト。テストの担当は CL（実装の担当は CO）
// 「出力の方式」の GPU の選択: アダプターの一覧・選んだ GPU の保存（environment.json）と開き直したときの復元、
// 無い GPU は既定の GPU に戻して知らせる。送り手は本物の createSpoutSink に、Rust の側の代わり（fakeRust）をつなぐ
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { createDefaultEnvironment, createEmptyProject, type Environment } from '@app/schema';
import type { Renderer, Services } from '@app/contracts';
import { createFakeServices } from '../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../shell/environment';
import { registry } from '../../shell/registry';
import { Shell } from '../../shell/Shell';
import { register as registerStudio } from '../../modes/studio';
import { animationFrameScheduler, studioRuntime } from '../../modes/studio/runtime';
import { spoutOutput } from './controller';
import { register } from './index';
import { listSpoutAdapters, type SpoutAdapter } from './adapters';
import { COMMAND_START, createSpoutSink, type Invoke, type SpoutTelemetry } from './sink';

vi.mock('./adapters', () => ({ listSpoutAdapters: vi.fn() }));
vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
  invoke: vi.fn(),
}));

// jsdom には 2D/WebGL のコンテキストが無いので、何も描かないレンダラーにする
const renderer: Renderer = { init() {}, setTextures() {}, render() {}, dispose() {} };

const ADAPTERS: SpoutAdapter[] = [
  { id: 'gpu-a', name: '内蔵GPU（Intel）' },
  { id: 'gpu-b', name: '外付けGPU（NVIDIA）' },
];
const DEFAULT_GPU = 'gpu-a'; // Rust が既定で使う GPU
const NOTICE = '選んだGPUが見つからないため、既定のGPUに戻した';

// Rust の側（spout_start・spout_status など）の代わり。gpus は Rust から見えている GPU。
// 無い GPU を頼まれたら既定の GPU で始め、adapterFallback を返す（d3d11.rs の create_device_with_adapter と同じ）
function fakeRust(gpus: string[]) {
  const starts: (string | null)[] = []; // spout_start に渡った adapterId
  const using = { adapterId: DEFAULT_GPU, fallback: false };
  const invoke: Invoke = (command, args) => {
    if (command === COMMAND_START) {
      const requested = (args as { adapterId: string | null }).adapterId;
      starts.push(requested);
      using.fallback = requested !== null && !gpus.includes(requested);
      using.adapterId = requested !== null && !using.fallback ? requested : DEFAULT_GPU;
      return Promise.resolve({
        senderName: '2D Liver',
        msaaSamples: 4,
        adapterId: using.adapterId,
        adapterFallback: using.fallback,
      });
    }
    if (command === 'spout_status') {
      const telemetry: SpoutTelemetry = {
        state: 'running',
        message: null,
        sentFrames: 60,
        failures: 0,
        recoveries: 0,
        elapsedSeconds: 1,
        sendFps: 60,
        senderName: '2D Liver',
        adapterId: using.adapterId,
        adapterFallback: using.fallback,
      };
      return Promise.resolve(telemetry);
    }
    if (command === 'spout_set_textures') return Promise.resolve([]);
    return Promise.resolve(null);
  };
  return { invoke, starts, using };
}

// 保存してある environment.json（output だけ変える）
function saved(output: Partial<Environment['output']>): string {
  const env = createDefaultEnvironment();
  env.output = { ...env.output, ...output };
  return JSON.stringify(env);
}

type Storage = ReturnType<typeof memoryEnvironmentStorage>;

// アプリを開く（同じ storage で開き直すと、保存した設定から始まる）
async function open(storage: Storage, rust: ReturnType<typeof fakeRust>) {
  const services: Services = {
    ...createFakeServices(),
    createRenderer: () => renderer,
    spout: createSpoutSink({ invoke: rust.invoke }),
  };
  const environment = createEnvironmentStore(storage);
  const view = render(<Shell services={services} environment={environment} />);
  await act(async () => {
    await environment.load();
    services.store.load(createEmptyProject('テスト'));
    services.editor.set({ mode: 'studio' });
  });
  await act(() => spoutOutput.whenIdle());
  return { environment, view };
}

const section = () => within(screen.getByRole('heading', { name: '出力の方式' }).parentElement!);
const gpuSelect = () => section().getByRole('combobox', { name: 'Spout2 の GPU' }) as HTMLSelectElement;
const savedAdapterId = (storage: Storage) =>
  (JSON.parse(storage.text ?? 'null') as Environment | null)?.output.adapterId;

// 一覧を読み終える（読み終えるまでは選べない）
async function adaptersLoaded() {
  await waitFor(() => expect(gpuSelect().disabled).toBe(false));
  await act(() => spoutOutput.whenIdle());
}

async function chooseGpu(value: string) {
  await act(async () => {
    fireEvent.change(gpuSelect(), { target: { value } });
  });
  await act(() => spoutOutput.whenIdle());
}

beforeEach(() => {
  vi.mocked(listSpoutAdapters).mockReset();
  vi.mocked(listSpoutAdapters).mockResolvedValue(ADAPTERS);
  registry.reset();
  registerStudio();
  register();
  studioRuntime.setScheduler({ request: () => () => {} }); // フレームは自動では進めない
});
afterEach(async () => {
  await spoutOutput.stop();
  studioRuntime.setScheduler(animationFrameScheduler());
});

describe('カード69 Spout2 の GPU の選択', () => {
  it('アダプターの一覧を「既定のGPU」の後に並べ、OBS と同じ GPU を選ぶ案内を出す', async () => {
    const rust = fakeRust(['gpu-a', 'gpu-b']);
    await open(memoryEnvironmentStorage(saved({ method: 'spout2' })), rust);
    await adaptersLoaded();
    const options = within(gpuSelect())
      .getAllByRole('option')
      .map((o) => [(o as HTMLOptionElement).value, o.textContent]);
    expect(options).toEqual([
      ['', '既定のGPU'],
      ['gpu-a', '内蔵GPU（Intel）'],
      ['gpu-b', '外付けGPU（NVIDIA）'],
    ]);
    expect(gpuSelect().value).toBe('');
    expect(section().getByText('OBSと同じGPUを選ぶ（GPUが異なると受け取れないことがある）')).toBeTruthy();
    expect(section().queryByRole('status')).toBeNull();
    expect(listSpoutAdapters).toHaveBeenCalledTimes(1);
    expect(rust.starts).toEqual([null]); // 既定（自動）で始める
  });

  it('選んだ GPU を environment.json に保存し、開き直すと同じ GPU を選んだ状態で送り始める', async () => {
    const storage = memoryEnvironmentStorage(saved({ method: 'spout2', adapterId: null }));
    const first = fakeRust(['gpu-a', 'gpu-b']);
    const app = await open(storage, first);
    await adaptersLoaded();
    await chooseGpu('gpu-b');
    expect(app.environment.get().output.adapterId).toBe('gpu-b');
    expect(gpuSelect().value).toBe('gpu-b');
    // 選んだ GPU で送り直す
    expect(first.starts).toEqual([null, 'gpu-b']);
    expect(first.using).toEqual({ adapterId: 'gpu-b', fallback: false });
    await app.environment.flush();
    expect(savedAdapterId(storage)).toBe('gpu-b');

    // アプリを閉じて開き直す（同じ environment.json）
    app.view.unmount();
    await spoutOutput.stop();
    const second = fakeRust(['gpu-a', 'gpu-b']);
    const storageAfterRestart = memoryEnvironmentStorage(storage.text);
    const reopened = await open(storageAfterRestart, second);
    await adaptersLoaded();
    expect(gpuSelect().value).toBe('gpu-b');
    expect(reopened.environment.get().output.adapterId).toBe('gpu-b');
    expect(second.starts).toEqual(['gpu-b']);
    expect(section().queryByRole('status')).toBeNull();

    // 「既定のGPU」に戻すと null（自動）を保存する
    await chooseGpu('');
    expect(reopened.environment.get().output.adapterId).toBeNull();
    expect(second.starts).toEqual(['gpu-b', null]);
    await reopened.environment.flush();
    expect(savedAdapterId(storageAfterRestart)).toBeNull();
  });

  it('前の版が LUID で保存した GPU は、同じ GPU の新しい識別子へ移して保存する。再起動で LUID が変わっても、新しい識別子の GPU はそのまま選ばれる', async () => {
    // 新しい識別子（再起動で変わらない）と、今の起動中の LUID（legacyId）
    const LEGACY_B = '00000000:0000b001';
    vi.mocked(listSpoutAdapters).mockResolvedValue([
      { id: 'gpu-a', name: '内蔵GPU（Intel）', legacyId: '00000000:0000a001' },
      { id: 'gpu-b', name: '外付けGPU（NVIDIA）', legacyId: LEGACY_B },
    ]);
    const storage = memoryEnvironmentStorage(saved({ method: 'spout2', adapterId: LEGACY_B }));
    const rust = fakeRust(['gpu-a', 'gpu-b', LEGACY_B]); // Rust は前の版の LUID も受け付ける
    const app = await open(storage, rust);
    await adaptersLoaded();
    await waitFor(() => expect(app.environment.get().output.adapterId).toBe('gpu-b'));
    await act(() => spoutOutput.whenIdle());
    expect(gpuSelect().value).toBe('gpu-b');
    expect(section().queryByRole('status')).toBeNull(); // 既定に戻した知らせは出ない
    expect(rust.starts.at(-1)).toBe('gpu-b');
    expect(rust.using).toEqual({ adapterId: 'gpu-b', fallback: false });
    await app.environment.flush();
    expect(savedAdapterId(storage)).toBe('gpu-b');

    // PC を再起動した: 同じ GPU の LUID が変わる。保存してあるのは新しい識別子なので、そのまま選ばれる
    app.view.unmount();
    await spoutOutput.stop();
    vi.mocked(listSpoutAdapters).mockResolvedValue([
      { id: 'gpu-a', name: '内蔵GPU（Intel）', legacyId: '00000000:0000a777' },
      { id: 'gpu-b', name: '外付けGPU（NVIDIA）', legacyId: '00000000:0000b777' },
    ]);
    const afterReboot = fakeRust(['gpu-a', 'gpu-b']);
    const rebootedStorage = memoryEnvironmentStorage(storage.text);
    const rebooted = await open(rebootedStorage, afterReboot);
    await adaptersLoaded();
    expect(gpuSelect().value).toBe('gpu-b');
    expect(rebooted.environment.get().output.adapterId).toBe('gpu-b');
    expect(afterReboot.starts).toEqual(['gpu-b']);
    expect(section().queryByRole('status')).toBeNull();
  });

  it('保存した GPU が一覧に無ければ既定の GPU に戻して保存し、画面で知らせる', async () => {
    const storage = memoryEnvironmentStorage(saved({ method: 'spout2', adapterId: 'gpu-gone' }));
    const rust = fakeRust(['gpu-a', 'gpu-b']);
    const app = await open(storage, rust);
    await waitFor(() => expect(app.environment.get().output.adapterId).toBeNull());
    await act(() => spoutOutput.whenIdle());
    expect(section().getByRole('status').textContent).toBe(NOTICE);
    await adaptersLoaded();
    expect(gpuSelect().value).toBe('');
    // 既定の GPU で送っている
    expect(rust.starts.at(-1)).toBeNull();
    expect(rust.using).toEqual({ adapterId: DEFAULT_GPU, fallback: false });
    expect(section().getByLabelText('Spout2 の状態').textContent).toBe('送信中');
    await app.environment.flush();
    expect(savedAdapterId(storage)).toBeNull();
  });

  it('送信中に Rust が選んだ GPU を見つけられず既定で始めたときも、既定に戻して知らせる', async () => {
    // 一覧には gpu-b があるが、送り始めるときには外れていた（外付けの GPU を抜いたなど）
    const storage = memoryEnvironmentStorage(saved({ method: 'spout2', adapterId: 'gpu-b' }));
    const rust = fakeRust(['gpu-a']);
    const app = await open(storage, rust);
    await adaptersLoaded();
    expect(rust.starts).toEqual(['gpu-b']);
    expect(rust.using).toEqual({ adapterId: DEFAULT_GPU, fallback: true });
    // 送信の状態（毎秒読む）で既定に戻ったことが分かる
    await waitFor(() => expect(app.environment.get().output.adapterId).toBeNull(), { timeout: 3000 });
    await act(() => spoutOutput.whenIdle());
    expect(section().getByRole('status').textContent).toBe(NOTICE);
    expect(gpuSelect().value).toBe('');
    expect(rust.starts).toEqual(['gpu-b', null]);
    expect(rust.using).toEqual({ adapterId: DEFAULT_GPU, fallback: false });
    await app.environment.flush();
    expect(savedAdapterId(storage)).toBeNull();
  });

  it('GPU の一覧を読めないときは保存した GPU を消さず、読めない理由を知らせる', async () => {
    vi.mocked(listSpoutAdapters).mockRejectedValue(new Error('DXGI を使えない'));
    const storage = memoryEnvironmentStorage(saved({ method: 'spout2', adapterId: 'gpu-b' }));
    const rust = fakeRust(['gpu-a', 'gpu-b']);
    const app = await open(storage, rust);
    expect((await section().findByRole('status')).textContent).toBe('GPU の一覧を読めない: DXGI を使えない');
    await act(() => spoutOutput.whenIdle());
    expect(gpuSelect().disabled).toBe(true);
    expect(app.environment.get().output.adapterId).toBe('gpu-b');
    expect(rust.starts).toEqual(['gpu-b']);
    await app.environment.flush();
    expect(savedAdapterId(storage)).toBe('gpu-b');
  });

  it('アダプターの一覧は Tauri の spout_adapters から読み、Tauri の外では null を返す', async () => {
    const actual = await vi.importActual<typeof import('./adapters')>('./adapters');
    const list = [{ id: '00000000:0000abcd', name: 'NVIDIA GeForce RTX 4060' }];
    vi.mocked(tauriInvoke).mockResolvedValue(list);
    const w = window as unknown as Record<string, unknown>;
    w.__TAURI_INTERNALS__ = {};
    try {
      expect(await actual.listSpoutAdapters()).toEqual(list);
      expect(tauriInvoke).toHaveBeenCalledTimes(1);
      expect(tauriInvoke).toHaveBeenCalledWith('spout_adapters');
    } finally {
      delete w.__TAURI_INTERNALS__;
    }
    expect(await actual.listSpoutAdapters()).toBeNull();
    expect(tauriInvoke).toHaveBeenCalledTimes(1);
  });
});
