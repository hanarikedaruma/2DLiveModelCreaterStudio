import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hotkey } from '@app/schema';
import {
  createHotkeyService,
  defaultShortcutBackend,
  tauriShortcutBackend,
  windowShortcutBackend,
  type HotkeyPhase,
  type ShortcutBackend,
} from './service';

const hotkey = (keys: string, id = keys): Hotkey => ({
  id,
  keys,
  action: 'recalibrate',
  targetId: null,
  mode: 'toggle',
});

// プラグインの代わり。登録したものを覚え、押した・離したを送れる。taken のキーは「ほかのアプリが使っている」
class RecordingBackend implements ShortcutBackend {
  readonly registered = new Map<string, (phase: HotkeyPhase) => void>();
  unregisterAllCalls = 0;
  constructor(private readonly taken: string[] = []) {}
  async register(accelerator: string, onEvent: (phase: HotkeyPhase) => void) {
    if (this.taken.includes(accelerator) || this.registered.has(accelerator)) {
      throw new Error('HotKey already registered');
    }
    this.registered.set(accelerator, onEvent);
  }
  async unregisterAll() {
    this.unregisterAllCalls++;
    this.registered.clear();
  }
  send(accelerator: string, phase: HotkeyPhase) {
    this.registered.get(accelerator)?.(phase);
  }
}

describe('createHotkeyService', () => {
  it('global-shortcut の形で登録し、押した・離したを handler へ渡す', async () => {
    const backend = new RecordingBackend();
    const service = createHotkeyService(backend);
    const phases: HotkeyPhase[] = [];
    expect(await service.register(hotkey('Ctrl+Shift+1'), (p) => phases.push(p))).toBe('ok');
    expect([...backend.registered.keys()]).toEqual(['Control+Shift+Digit1']);
    backend.send('Control+Shift+Digit1', 'down');
    backend.send('Control+Shift+Digit1', 'up');
    expect(phases).toEqual(['down', 'up']);
  });

  it('押したままのあいだに down が続いても1回だけ渡し、押していない up は渡さない', async () => {
    const backend = new RecordingBackend();
    const service = createHotkeyService(backend);
    const phases: HotkeyPhase[] = [];
    await service.register(hotkey('F9'), (p) => phases.push(p));
    backend.send('F9', 'up');
    backend.send('F9', 'down');
    backend.send('F9', 'down');
    backend.send('F9', 'up');
    expect(phases).toEqual(['down', 'up']);
  });

  it('登録に失敗したら（ほかのアプリが使っている）conflict', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const backend = new RecordingBackend(['Control+Alt+KeyA']);
    const service = createHotkeyService(backend);
    expect(await service.register(hotkey('Ctrl+Alt+A'), () => {})).toBe('conflict');
    expect(await service.register(hotkey('Ctrl+Alt+B'), () => {})).toBe('ok');
    warn.mockRestore();
  });

  it('同じキーを2回登録すると2回目は conflict（書き方が違っても同じキーなら）', async () => {
    const backend = new RecordingBackend();
    const service = createHotkeyService(backend);
    expect(await service.register(hotkey('Ctrl+Shift+1', 'a'), () => {})).toBe('ok');
    expect(await service.register(hotkey('shift+control+Digit1', 'b'), () => {})).toBe('conflict');
    expect(backend.registered.size).toBe(1);
  });

  it('読めないキーは登録せずに conflict', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const backend = new RecordingBackend();
    const service = createHotkeyService(backend);
    expect(await service.register(hotkey('Ctrl+あ'), () => {})).toBe('conflict');
    expect(backend.registered.size).toBe(0);
    warn.mockRestore();
  });

  it('unregisterAll で全部消し、前の handler は呼ばない。同じキーをまた登録できる', async () => {
    const stale: Array<(phase: HotkeyPhase) => void> = [];
    const backend: ShortcutBackend = {
      async register(_a, onEvent) {
        stale.push(onEvent);
      },
      unregisterAll: vi.fn(async () => {}),
    };
    const service = createHotkeyService(backend);
    const first = vi.fn();
    await service.register(hotkey('F1'), first);
    await service.unregisterAll();
    expect(backend.unregisterAll).toHaveBeenCalledTimes(1);
    stale[0]!('down'); // 消したあとに届いた古いイベント
    expect(first).not.toHaveBeenCalled();
    const second = vi.fn();
    expect(await service.register(hotkey('F1'), second)).toBe('ok');
    stale[1]!('down');
    expect(second).toHaveBeenCalledWith('down');
  });

  it('handler の例外は外へ出さない', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const backend = new RecordingBackend();
    const service = createHotkeyService(backend);
    await service.register(hotkey('F2'), () => {
      throw new Error('壊れた');
    });
    expect(() => backend.send('F2', 'down')).not.toThrow();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('tauriShortcutBackend', () => {
  it('プラグインの register に渡し、Pressed を down、Released を up にする', async () => {
    type Handler = (e: { shortcut: string; id: number; state: 'Pressed' | 'Released' }) => void;
    const handlers: Handler[] = [];
    const plugin = {
      register: vi.fn(async (_s: string | string[], h: Handler) => {
        handlers.push(h);
      }),
      unregisterAll: vi.fn(async () => {}),
    };
    const service = createHotkeyService(tauriShortcutBackend(async () => plugin));
    const phases: HotkeyPhase[] = [];
    expect(await service.register(hotkey('Ctrl+Shift+1'), (p) => phases.push(p))).toBe('ok');
    expect(plugin.register).toHaveBeenCalledWith('Control+Shift+Digit1', expect.any(Function));
    handlers[0]!({ shortcut: 'shift+control+Digit1', id: 1, state: 'Pressed' });
    handlers[0]!({ shortcut: 'shift+control+Digit1', id: 1, state: 'Released' });
    expect(phases).toEqual(['down', 'up']);
    await service.unregisterAll();
    expect(plugin.unregisterAll).toHaveBeenCalledTimes(1);
  });

  it('プラグインが登録を断ったら conflict', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugin = {
      register: vi.fn(async () => {
        throw new Error('HotKey already registered: Control+Alt+KeyA');
      }),
      unregisterAll: vi.fn(async () => {}),
    };
    const service = createHotkeyService(tauriShortcutBackend(async () => plugin));
    expect(await service.register(hotkey('Ctrl+Alt+A'), () => {})).toBe('conflict');
    warn.mockRestore();
  });
});

describe('windowShortcutBackend（ブラウザでの代わり）', () => {
  let service: ReturnType<typeof createHotkeyService> | null = null;
  afterEach(async () => {
    await service?.unregisterAll();
    service = null;
  });

  const keydown = (init: KeyboardEventInit) => {
    const e = new KeyboardEvent('keydown', { cancelable: true, ...init });
    window.dispatchEvent(e);
    return e;
  };

  it('ウィンドウのキーで押した・離したを渡す。修飾キーが違えば反応しない', async () => {
    service = createHotkeyService(windowShortcutBackend(window));
    const phases: HotkeyPhase[] = [];
    await service.register(hotkey('Ctrl+Shift+1'), (p) => phases.push(p));
    keydown({ code: 'Digit1', ctrlKey: true });
    expect(phases).toEqual([]);
    const e = keydown({ code: 'Digit1', ctrlKey: true, shiftKey: true });
    expect(e.defaultPrevented).toBe(true);
    keydown({ code: 'Digit1', ctrlKey: true, shiftKey: true, repeat: true });
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Digit1', ctrlKey: true }));
    expect(phases).toEqual(['down', 'up']);
  });

  it('ほかが処理したキー（記録中の入力欄など）は見ない。ウィンドウから離れたら離したことにする', async () => {
    service = createHotkeyService(windowShortcutBackend(window));
    const phases: HotkeyPhase[] = [];
    await service.register(hotkey('F8'), (p) => phases.push(p));
    const handled = new KeyboardEvent('keydown', { code: 'F8', cancelable: true });
    handled.preventDefault();
    window.dispatchEvent(handled);
    expect(phases).toEqual([]);
    keydown({ code: 'F8' });
    window.dispatchEvent(new Event('blur'));
    expect(phases).toEqual(['down', 'up']);
  });

  it('unregisterAll のあとは反応しない', async () => {
    service = createHotkeyService(windowShortcutBackend(window));
    const handler = vi.fn();
    await service.register(hotkey('F7'), handler);
    await service.unregisterAll();
    keydown({ code: 'F7' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('Tauri が無ければ既定はウィンドウのキーを使う', async () => {
    expect('__TAURI_INTERNALS__' in window).toBe(false);
    service = createHotkeyService(defaultShortcutBackend());
    const handler = vi.fn();
    expect(await service.register(hotkey('F6'), handler)).toBe('ok');
    keydown({ code: 'F6' });
    expect(handler).toHaveBeenCalledWith('down');
  });
});
