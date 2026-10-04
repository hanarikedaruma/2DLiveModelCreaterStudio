// 本物の HotkeyService（カード40）。Tauri では global-shortcut プラグインで OS に登録し、
// アプリが裏にあっても押した・離したを handler へ渡す。登録に失敗したら 'conflict'。
// プラグインの呼び出しは ShortcutBackend に分けて、テストやブラウザでは差し替える
import type { Hotkey } from '@app/schema';
import type { HotkeyService } from '@app/contracts';
import { isTauri } from '../platform/tauri';
import { formatKeys, parseKeys, toAccelerator, type ParsedKeys } from './keys';

export type HotkeyPhase = 'down' | 'up';

// OS（またはウィンドウ）へのショートカットの登録。register は登録できなければ reject する
export interface ShortcutBackend {
  register(accelerator: string, onEvent: (phase: HotkeyPhase) => void): Promise<void>;
  unregisterAll(): Promise<void>;
}

type GlobalShortcutModule = Pick<typeof import('@tauri-apps/plugin-global-shortcut'), 'register' | 'unregisterAll'>;

// Tauri の global-shortcut プラグイン。Pressed を 'down'、Released を 'up' にする
export function tauriShortcutBackend(
  load: () => Promise<GlobalShortcutModule> = () => import('@tauri-apps/plugin-global-shortcut'),
): ShortcutBackend {
  return {
    async register(accelerator, onEvent) {
      const plugin = await load();
      await plugin.register(accelerator, (event) => onEvent(event.state === 'Pressed' ? 'down' : 'up'));
    },
    async unregisterAll() {
      const plugin = await load();
      await plugin.unregisterAll();
    },
  };
}

function matches(keys: ParsedKeys, e: KeyboardEvent): boolean {
  const has = (m: ParsedKeys['modifiers'][number]) => keys.modifiers.includes(m);
  return (
    e.code === keys.code &&
    e.ctrlKey === has('Ctrl') &&
    e.altKey === has('Alt') &&
    e.shiftKey === has('Shift') &&
    e.metaKey === has('Win')
  );
}

// ブラウザ（Tauri の無い開発中）の代わり。アプリのウィンドウが前面にある間だけ効く
export function windowShortcutBackend(target: Window = window): ShortcutBackend {
  const entries = new Map<string, { keys: ParsedKeys; onEvent: (phase: HotkeyPhase) => void; down: boolean }>();
  let listening = false;

  const onKeyDown = (e: KeyboardEvent) => {
    // キーを記録している入力欄など、ほかが処理したものは見ない
    if (e.defaultPrevented || e.repeat) return;
    for (const entry of [...entries.values()]) {
      if (entry.down || !matches(entry.keys, e)) continue;
      e.preventDefault();
      entry.down = true;
      entry.onEvent('down');
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    for (const entry of [...entries.values()]) {
      if (!entry.down || e.code !== entry.keys.code) continue;
      entry.down = false;
      entry.onEvent('up');
    }
  };
  // ウィンドウから離れると keyup が来ないので、押している扱いのものを離す
  const onBlur = () => {
    for (const entry of [...entries.values()]) {
      if (!entry.down) continue;
      entry.down = false;
      entry.onEvent('up');
    }
  };

  return {
    async register(accelerator, onEvent) {
      const keys = parseKeys(accelerator);
      if (!keys) throw new Error(`キーを読めない: ${accelerator}`);
      if (entries.has(accelerator)) throw new Error(`すでに登録している: ${accelerator}`);
      entries.set(accelerator, { keys, onEvent, down: false });
      if (!listening) {
        listening = true;
        target.addEventListener('keydown', onKeyDown);
        target.addEventListener('keyup', onKeyUp);
        target.addEventListener('blur', onBlur);
      }
    },
    async unregisterAll() {
      entries.clear();
      if (!listening) return;
      listening = false;
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
    },
  };
}

export function defaultShortcutBackend(): ShortcutBackend {
  if (isTauri()) return tauriShortcutBackend();
  if (typeof window !== 'undefined') return windowShortcutBackend(window);
  return {
    register: () => Promise.reject(new Error('ショートカットを登録できない環境')),
    unregisterAll: () => Promise.resolve(),
  };
}

export function createHotkeyService(backend: ShortcutBackend = defaultShortcutBackend()): HotkeyService {
  // unregisterAll のたびに増やす。前の登録の handler は呼ばない
  let generation = 0;
  const taken = new Set<string>(); // 登録したキー（formatKeys の形）

  return {
    async register(hotkey: Hotkey, handler: (phase: HotkeyPhase) => void) {
      const parsed = parseKeys(hotkey.keys);
      if (!parsed) {
        console.warn(`ホットキーのキーを読めない: ${hotkey.keys}`);
        return 'conflict';
      }
      const id = formatKeys(parsed);
      if (taken.has(id)) return 'conflict';
      taken.add(id);
      const gen = generation;
      let down = false;
      try {
        await backend.register(toAccelerator(parsed), (phase) => {
          if (gen !== generation) return;
          // 押したままの間に 'down' が続いても1回にする。押していないのに来た 'up' は捨てる
          if (phase === 'down' ? down : !down) return;
          down = phase === 'down';
          try {
            handler(phase);
          } catch (e) {
            console.error(`ホットキー（${hotkey.keys}）の処理で例外が出た`, e);
          }
        });
        return 'ok';
      } catch (e) {
        if (gen === generation) taken.delete(id);
        console.warn(`ホットキーを登録できない（ほかのアプリと重なっている）: ${hotkey.keys}`, e);
        return 'conflict';
      }
    },
    async unregisterAll() {
      generation++;
      taken.clear();
      await backend.unregisterAll();
    },
  };
}
