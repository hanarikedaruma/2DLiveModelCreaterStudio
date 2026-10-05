import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type Hotkey, type Project } from '@app/schema';
import { FakeHotkeys, type HotkeyService, type Services } from '@app/contracts';
import { createFakeServices } from '../services';
import { createHotkeyActions } from './actions';
import { createHotkeyRuntime, type HotkeyBinding, type HotkeyRuntime } from './runtime';

const hk = (id: string, keys: string, extra: Partial<Hotkey> = {}): Hotkey => ({
  id,
  keys,
  action: 'expression',
  targetId: 'smile',
  mode: 'toggle',
  ...extra,
});

function projectWith(hotkeys: Hotkey[]): Project {
  const p = createEmptyProject('テスト');
  return {
    ...p,
    expressions: [{ id: 'smile', name: '笑顔', entries: [], fadeIn: 0, fadeOut: 0 }],
    studio: { ...p.studio, hotkeys },
  };
}

const setHotkeys = (services: Services, hotkeys: Hotkey[]) =>
  services.store.dispatch({ label: 'テスト', apply: (p) => ({ ...p, studio: { ...p.studio, hotkeys } }) });

function binding(services: Services): HotkeyBinding {
  return {
    services,
    now: () => 0,
    emit: () => {},
    trackingSessionActive: () => false,
    cameraDeviceId: () => null,
    expressionMode: () => 'stack',
    notify: () => {},
  };
}

// 登録・解除の呼び出しを順に記録する。conflictKeys は「ほかのアプリが使っている」キー
class LoggingHotkeys implements HotkeyService {
  readonly log: string[] = [];
  private readonly inner = new FakeHotkeys();
  constructor(
    private readonly conflictKeys: string[] = [],
    private readonly delay = 0,
  ) {}
  private wait() {
    return new Promise<void>((resolve) => setTimeout(resolve, this.delay));
  }
  async register(hotkey: Hotkey, handler: (phase: 'down' | 'up') => void) {
    if (this.delay) await this.wait();
    this.log.push(`register ${hotkey.keys}`);
    if (this.conflictKeys.includes(hotkey.keys)) return 'conflict' as const;
    return this.inner.register(hotkey, handler);
  }
  async unregisterAll() {
    if (this.delay) await this.wait();
    this.log.push('unregisterAll');
    await this.inner.unregisterAll();
  }
  press(keys: string, phase: 'down' | 'up' = 'down') {
    return this.inner.press(keys, phase);
  }
  registered() {
    return this.inner.registered().map((h) => h.keys);
  }
}

let services: Services;
let hotkeys: LoggingHotkeys;
let runtime: HotkeyRuntime;

beforeEach(() => {
  hotkeys = new LoggingHotkeys(['Ctrl+Alt+Delete']);
  services = { ...createFakeServices(), hotkeys };
  services.store.load(projectWith([hk('a', 'Ctrl+Shift+1'), hk('b', 'Ctrl+Alt+Delete')]));
  runtime = createHotkeyRuntime(createHotkeyActions());
});

describe('ホットキーの登録の実行部', () => {
  it('つなぐとプロジェクトのホットキーを services.hotkeys に登録し、結果を覚える', async () => {
    runtime.attach(binding(services));
    expect(runtime.getState().syncing).toBe(true);
    await runtime.whenIdle();
    // 最初も先に消す（画面を読み込み直す前の登録が OS に残っていることがある）
    expect(hotkeys.log).toEqual(['unregisterAll', 'register Ctrl+Shift+1', 'register Ctrl+Alt+Delete']);
    expect(hotkeys.registered()).toEqual(['Ctrl+Shift+1']);
    expect(runtime.getState().statuses).toEqual(
      new Map([
        ['a', 'ok'],
        ['b', 'conflict'],
      ]),
    );
    expect(runtime.getState().syncing).toBe(false);
  });

  it('押したら動作を呼ぶ（表情の toggle）', async () => {
    runtime.attach(binding(services));
    await runtime.whenIdle();
    hotkeys.press('Ctrl+Shift+1', 'down');
    hotkeys.press('Ctrl+Shift+1', 'up');
    expect(services.expressions.active()).toBe('smile');
  });

  it('project.studio.hotkeys が変わったら登録し直す。ほかの変更では登録し直さない', async () => {
    runtime.attach(binding(services));
    await runtime.whenIdle();
    hotkeys.log.length = 0;
    services.store.dispatch({ label: '名前', apply: (p) => ({ ...p, name: '別の名前' }) });
    await runtime.whenIdle();
    expect(hotkeys.log).toEqual([]);

    setHotkeys(services, [hk('c', 'F9')]);
    await runtime.whenIdle();
    expect(hotkeys.log).toEqual(['unregisterAll', 'register F9']);
    expect(hotkeys.registered()).toEqual(['F9']);
    expect(runtime.getState().statuses).toEqual(new Map([['c', 'ok']]));
  });

  it('Undo でホットキーが戻っても登録し直す', async () => {
    runtime.attach(binding(services));
    await runtime.whenIdle();
    setHotkeys(services, []);
    await runtime.whenIdle();
    expect(hotkeys.registered()).toEqual([]);
    services.store.undo();
    await runtime.whenIdle();
    expect(hotkeys.registered()).toEqual(['Ctrl+Shift+1']);
  });

  it('外すと登録をすべて消す', async () => {
    const detach = runtime.attach(binding(services));
    await runtime.whenIdle();
    detach();
    await runtime.whenIdle();
    expect(hotkeys.registered()).toEqual([]);
    expect(runtime.getState().statuses.size).toBe(0);
    // 外したあとはプロジェクトが変わっても登録しない
    setHotkeys(services, [hk('c', 'F9')]);
    await runtime.whenIdle();
    expect(hotkeys.registered()).toEqual([]);
  });

  it('押したまま登録し直す・外すと、離したことにする（hold が戻る）', async () => {
    setHotkeys(services, [hk('h', 'F5', { mode: 'hold' })]);
    const detach = runtime.attach(binding(services));
    await runtime.whenIdle();
    hotkeys.press('F5', 'down');
    expect(services.expressions.active()).toBe('smile');
    setHotkeys(services, [hk('h', 'F5', { mode: 'hold' }), hk('x', 'F6')]);
    await runtime.whenIdle();
    expect(services.expressions.active()).toBeNull();

    hotkeys.press('F5', 'down');
    expect(services.expressions.active()).toBe('smile');
    detach();
    expect(services.expressions.active()).toBeNull();
  });

  it('同時holdとカード変更を保ったまま、keyup取りこぼし分をresyncで解除する', async () => {
    setHotkeys(services, [hk('a', 'F5', { mode: 'hold' }), hk('b', 'F6', { mode: 'hold' })]);
    services.expressions.toggle('base', 0);
    const detach = runtime.attach(binding(services));
    await runtime.whenIdle();
    hotkeys.press('F5', 'down');
    hotkeys.press('F6', 'down');
    services.expressions.toggle('card', 0);
    runtime.resync();
    await runtime.whenIdle();
    expect(services.expressions.actives()).toEqual(['base', 'card']);
    hotkeys.press('F5', 'up');
    expect(services.expressions.actives()).toEqual(['base', 'card']);
    detach();
    await runtime.whenIdle();
  });

  it('つなぐ・外す・つなぐが続いても（StrictMode）、登録と解除は順に行い、最後の状態になる', async () => {
    vi.useFakeTimers();
    try {
      const slow = new LoggingHotkeys([], 10);
      const s: Services = { ...services, hotkeys: slow };
      const detach = runtime.attach(binding(s));
      detach();
      runtime.attach(binding(s));
      await vi.runAllTimersAsync();
      await runtime.whenIdle();
      expect(slow.registered()).toEqual(['Ctrl+Shift+1', 'Ctrl+Alt+Delete']);
      // 最後の登録のあとに解除が来ていない
      expect(slow.log.at(-1)).toBe('register Ctrl+Alt+Delete');
      expect(slow.log.filter((l) => l === 'unregisterAll').length).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('登録し直す（resync）で、重なっていたものをもう一度試す', async () => {
    runtime.attach(binding(services));
    await runtime.whenIdle();
    expect(runtime.getState().statuses.get('b')).toBe('conflict');
    hotkeys.log.length = 0;
    runtime.resync();
    await runtime.whenIdle();
    expect(hotkeys.log).toEqual(['unregisterAll', 'register Ctrl+Shift+1', 'register Ctrl+Alt+Delete']);
  });

  it('古い登録の handler は、登録し直したあとは呼ばない', async () => {
    const handlers: Array<(phase: 'down' | 'up') => void> = [];
    const keep: HotkeyService = {
      async register(_h, handler) {
        handlers.push(handler);
        return 'ok';
      },
      async unregisterAll() {},
    };
    const s: Services = { ...services, hotkeys: keep };
    s.store.load(projectWith([hk('a', 'F1')]));
    runtime.attach(binding(s));
    await runtime.whenIdle();
    setHotkeys(s, [hk('a', 'F1', { targetId: 'other' })]);
    await runtime.whenIdle();
    handlers[0]!('down'); // 古い登録（smile を適用する）
    expect(s.expressions.active()).toBeNull();
    handlers[1]!('down');
    expect(s.expressions.active()).toBe('other');
  });
});
