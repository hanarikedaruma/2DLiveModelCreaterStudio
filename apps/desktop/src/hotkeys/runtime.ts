// ホットキーの登録の実行部。つないでいる間、project.studio.hotkeys を services.hotkeys に登録し、
// 割り当てが変わったら登録し直す。OS への登録・解除は1本の列で順に行う（つなぎ直しが重なっても順番が崩れない）
import type { Hotkey } from '@app/schema';
import type { HotkeyService, Services } from '@app/contracts';
import { createHotkeyActions, type HotkeyActionContext, type HotkeyActions } from './actions';
import type { HotkeyPhase } from './service';

export type HotkeyStatus = 'ok' | 'conflict';

export interface HotkeyRuntimeState {
  statuses: ReadonlyMap<string, HotkeyStatus>; // ホットキーの id ごとの登録の結果
  syncing: boolean; // 登録し直している途中
  trackingPaused: boolean; // ホットキーでトラッキングを一時停止している
}

export interface HotkeyBinding extends HotkeyActionContext {
  services: Services; // store・hotkeys・expressions・tracking を使う
}

export interface HotkeyRuntime {
  readonly actions: HotkeyActions;
  attach(binding: HotkeyBinding): () => void; // 戻り値で外す（外すと登録をすべて消す）
  resync(): void; // 登録し直す（ほかのアプリを閉じたあとなど）
  getState(): HotkeyRuntimeState;
  subscribe(listener: () => void): () => void;
  whenIdle(): Promise<void>; // 登録が終わるまで待つ（テスト用）
}

function sameHotkeys(a: Hotkey[], b: Hotkey[]): boolean {
  return (
    a.length === b.length &&
    a.every((h, i) => {
      const o = b[i]!;
      return (
        h.id === o.id && h.keys === o.keys && h.action === o.action && h.targetId === o.targetId && h.mode === o.mode
      );
    })
  );
}

export function createHotkeyRuntime(actions: HotkeyActions = createHotkeyActions()): HotkeyRuntime {
  let current: { token: object; binding: HotkeyBinding } | null = null;
  let registeredWith: HotkeyService | null = null;
  let requested: Hotkey[] = [];
  let generation = 0;
  let dirty = false;
  let pumping: Promise<void> | null = null;
  const held = new Map<string, Hotkey>(); // 押している（'down' のあと 'up' が来ていない）ホットキー
  let state: HotkeyRuntimeState = { statuses: new Map(), syncing: false, trackingPaused: false };
  const listeners = new Set<() => void>();

  function setState(patch: Partial<HotkeyRuntimeState>) {
    const next = { ...state, ...patch };
    if (
      next.statuses === state.statuses &&
      next.syncing === state.syncing &&
      next.trackingPaused === state.trackingPaused
    )
      return;
    state = next;
    for (const l of [...listeners]) l();
  }

  actions.subscribe(() => setState({ trackingPaused: actions.trackingPaused() }));

  // 押したままのものを離したことにする（登録し直す・外すと 'up' が届かなくなるため）
  function releaseHeld() {
    for (const hotkey of [...held.values()]) {
      held.delete(hotkey.id);
      actions.handle(hotkey, 'up');
    }
  }

  function onPhase(gen: number, hotkey: Hotkey, phase: HotkeyPhase) {
    if (gen !== generation) return;
    if (phase === 'down') {
      if (held.has(hotkey.id)) return;
      held.set(hotkey.id, hotkey);
    } else if (!held.delete(hotkey.id)) {
      return;
    }
    actions.handle(hotkey, phase);
  }

  async function pump() {
    while (dirty) {
      dirty = false;
      const gen = ++generation;
      releaseHeld();
      const target = current;
      const list = target ? target.binding.services.store.get().studio.hotkeys : [];
      requested = list;
      if (target) actions.retain(list);
      const service = target ? target.binding.services.hotkeys : null;
      // 登録する先も先に消す（画面を読み込み直す前の登録が OS に残っていると、同じキーを登録できない）
      const stale = [registeredWith, service].filter((s, i, all): s is HotkeyService => !!s && all.indexOf(s) === i);
      registeredWith = null;
      for (const s of stale) {
        try {
          await s.unregisterAll();
        } catch (e) {
          console.warn('ホットキーの登録を消せない', e);
        }
      }
      if (!service) {
        if (!dirty) setState({ statuses: new Map() });
        continue;
      }
      registeredWith = service;
      const results = new Map<string, HotkeyStatus>();
      for (const hotkey of list) {
        if (dirty) break;
        let result: HotkeyStatus;
        try {
          result = await service.register(hotkey, (phase) => onPhase(gen, hotkey, phase));
        } catch (e) {
          console.warn(`ホットキーを登録できない: ${hotkey.keys}`, e);
          result = 'conflict';
        }
        results.set(hotkey.id, result);
      }
      if (!dirty) setState({ statuses: results });
    }
  }

  function request() {
    dirty = true;
    if (pumping) return;
    setState({ syncing: true });
    pumping = pump()
      .catch((e: unknown) => console.error('ホットキーの登録で例外が出た', e))
      .finally(() => {
        pumping = null;
        setState({ syncing: false });
      });
  }

  return {
    actions,
    attach(binding) {
      const token = {};
      current = { token, binding };
      actions.setContext(binding);
      const off = binding.services.store.subscribe((project) => {
        if (current?.token !== token) return;
        if (!sameHotkeys(project.studio.hotkeys, requested)) request();
      });
      request();
      return () => {
        off();
        if (current?.token !== token) return;
        releaseHeld();
        current = null;
        actions.setContext(null);
        request();
      };
    },
    resync() {
      if (current) request();
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async whenIdle() {
      while (pumping) await pumping;
    },
  };
}

// アプリで1つの実行部
export const hotkeyRuntime: HotkeyRuntime = createHotkeyRuntime();
