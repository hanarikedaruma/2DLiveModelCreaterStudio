// ホットキーの動作。押した・離した（phase）を受けて、表情・シーン・背景・パラメータ・トラッキングなどを動かす
import type { BlendOp, Hotkey } from '@app/schema';
import type { LayerProducer, ParamValues, Services } from '@app/contracts';
import {
  activeScene,
  sameBackground,
  sceneBackground,
  setBackgroundCommand,
  type SceneBackground,
} from '../modes/studio/scene';
import type { HotkeyPhase } from './service';
import { backgroundFromTargetId, setActiveSceneCommand } from './targets';

// アプリイベントの名前。'sceneChanged' はシーンの一覧（modes/studio/scenes、カード39）がストアの変化を見て出す
export const RECALIBRATE_EVENT = 'recalibrate';
export const ANIMATION_EVENT = 'hotkey:animation';

// 'hotkey:animation' の値。toggle は押したときだけ、hold は押した・離したの両方を出す
export interface HotkeyAnimationEvent {
  targetId: string | null;
  phase: HotkeyPhase;
  mode: Hotkey['mode'];
}

export interface HotkeyActionContext {
  services: Pick<Services, 'store' | 'expressions' | 'tracking'>;
  now(): number; // ExpressionController.apply に渡す時刻（ミリ秒）
  emit(name: string, payload?: unknown): void;
  trackingSessionActive(): boolean; // スタジオでトラッキングを開始しているか
  cameraDeviceId(): string | null; // 再開するときのカメラ
  notify(message: string): void;
}

export interface HotkeyActions {
  setContext(context: HotkeyActionContext | null): void;
  handle(hotkey: Hotkey, phase: HotkeyPhase): void;
  // 割り当てが変わったとき。無くなった・中身が変わったホットキーの状態（max にしているパラメータなど）を捨てる
  retain(hotkeys: Hotkey[]): void;
  // トラッキングが停止された（一時停止の印を消す）
  trackingSessionEnded(): void;
  trackingPaused(): boolean;
  activeParameterIds(): string[];
  subscribe(listener: () => void): () => void;
  readonly producer: LayerProducer; // id 'expression'。パラメータのホットキーの値を override で出す
}

interface Switcher<T> {
  current(): T;
  set(value: T): void;
  same(a: T, b: T): boolean;
}

function sameAssignment(a: Hotkey, b: Hotkey): boolean {
  return a.action === b.action && a.targetId === b.targetId && a.mode === b.mode;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createHotkeyActions(): HotkeyActions {
  let ctx: HotkeyActionContext | null = null;
  const known = new Map<string, Hotkey>(); // 状態を持っているホットキー（押したときの割り当て）
  const memory = new Map<string, { prev: unknown }>(); // 切り替える前の値（戻すときに使う）
  const parameters = new Map<string, string>(); // ホットキーの id → max にしているパラメータの id
  let paused = false; // ホットキーでトラッキングを止めている
  const pausedByHold = new Set<string>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const l of [...listeners]) l();
  };

  // toggle: 対象へ切り替える。すでに対象なら、切り替える前に戻す
  function toggleSwitch<T>(id: string, target: T, s: Switcher<T>) {
    const current = s.current();
    if (s.same(current, target)) {
      const memo = memory.get(id);
      memory.delete(id);
      if (memo) s.set(memo.prev as T);
      return;
    }
    memory.set(id, { prev: current });
    s.set(target);
  }

  // hold: 押したら対象へ切り替え、離したら（対象のままなら）戻す
  function holdSwitch<T>(id: string, target: T, phase: HotkeyPhase, s: Switcher<T>) {
    if (phase === 'down') {
      const current = s.current();
      memory.delete(id);
      if (s.same(current, target)) return;
      memory.set(id, { prev: current });
      s.set(target);
      return;
    }
    const memo = memory.get(id);
    memory.delete(id);
    if (memo && s.same(s.current(), target)) s.set(memo.prev as T);
  }

  function expression(c: HotkeyActionContext, hotkey: Hotkey, phase: HotkeyPhase) {
    const { expressions } = c.services;
    const s: Switcher<string | null> = {
      current: () => expressions.active(),
      set: (id) => expressions.apply(id, c.now()),
      same: (a, b) => a === b,
    };
    if (hotkey.mode === 'hold') return holdSwitch(hotkey.id, hotkey.targetId, phase, s);
    if (phase !== 'down') return;
    // toggle は適用 / 解除
    s.set(s.current() === hotkey.targetId ? null : hotkey.targetId);
  }

  function scene(c: HotkeyActionContext, hotkey: Hotkey, phase: HotkeyPhase) {
    const { store } = c.services;
    const target = hotkey.targetId;
    if (target === null || !store.get().studio.scenes.some((sc) => sc.id === target)) {
      if (phase === 'down') console.warn(`ホットキーのシーンが見つからない: ${target}`);
      return;
    }
    const s: Switcher<string | null> = {
      current: () => activeScene(store.get())?.id ?? null,
      set(id) {
        if (id !== null) store.dispatch(setActiveSceneCommand(id));
      },
      same: (a, b) => a === b,
    };
    if (hotkey.mode === 'hold') holdSwitch(hotkey.id, target, phase, s);
    else if (phase === 'down') toggleSwitch(hotkey.id, target, s);
  }

  function background(c: HotkeyActionContext, hotkey: Hotkey, phase: HotkeyPhase) {
    const { store } = c.services;
    const target = hotkey.targetId === null ? null : backgroundFromTargetId(hotkey.targetId);
    if (!target) {
      if (phase === 'down') console.warn(`ホットキーの背景を読めない: ${hotkey.targetId}`);
      return;
    }
    const s: Switcher<SceneBackground> = {
      current: () => sceneBackground(store.get()),
      set: (bg) => store.dispatch(setBackgroundCommand(bg)),
      same: sameBackground,
    };
    if (hotkey.mode === 'hold') holdSwitch(hotkey.id, target, phase, s);
    else if (phase === 'down') toggleSwitch(hotkey.id, target, s);
  }

  function parameter(hotkey: Hotkey, phase: HotkeyPhase) {
    const target = hotkey.targetId;
    if (target === null) return;
    let on: boolean;
    if (hotkey.mode === 'hold') on = phase === 'down';
    else if (phase === 'down') on = !parameters.has(hotkey.id);
    else return;
    if (on) parameters.set(hotkey.id, target);
    else parameters.delete(hotkey.id);
    changed();
  }

  function pause(c: HotkeyActionContext): boolean {
    if (paused || !c.trackingSessionActive()) return false;
    c.services.tracking.stop();
    paused = true;
    changed();
    return true;
  }

  function resume(c: HotkeyActionContext | null) {
    if (!paused) return;
    paused = false;
    pausedByHold.clear();
    changed();
    if (!c || !c.trackingSessionActive()) return;
    c.services.tracking
      .start(c.cameraDeviceId() ?? undefined)
      .catch((e: unknown) => c.notify(`トラッキングを再開できない: ${errorText(e)}`));
  }

  function pauseTracking(c: HotkeyActionContext, hotkey: Hotkey, phase: HotkeyPhase) {
    if (hotkey.mode === 'hold') {
      if (phase === 'down') {
        if (pause(c)) pausedByHold.add(hotkey.id);
      } else if (pausedByHold.delete(hotkey.id)) {
        resume(c);
      }
      return;
    }
    if (phase !== 'down') return;
    if (paused) resume(c);
    else pause(c);
  }

  const producer: LayerProducer = {
    id: 'expression',
    produce(frame) {
      if (parameters.size === 0) return null;
      const values: ParamValues = {};
      const blend: Record<string, BlendOp> = {};
      for (const id of new Set(parameters.values())) {
        const p = frame.project.model.parameters.find((x) => x.id === id);
        if (!p) continue;
        values[id] = p.max;
        blend[id] = 'override';
      }
      if (Object.keys(values).length === 0) return null;
      return { id: 'expression', weight: 1, values, blend };
    },
  };

  return {
    setContext(next) {
      ctx = next;
    },
    handle(hotkey, phase) {
      const c = ctx;
      if (!c) return;
      if (phase === 'down') known.set(hotkey.id, hotkey);
      try {
        switch (hotkey.action) {
          case 'expression':
            return expression(c, hotkey, phase);
          case 'scene':
            return scene(c, hotkey, phase);
          case 'background':
            return background(c, hotkey, phase);
          case 'parameter':
            return parameter(hotkey, phase);
          case 'pauseTracking':
            return pauseTracking(c, hotkey, phase);
          case 'recalibrate':
            if (phase === 'down') c.emit(RECALIBRATE_EVENT);
            return;
          case 'animation':
            if (hotkey.mode === 'hold' || phase === 'down') {
              const payload: HotkeyAnimationEvent = { targetId: hotkey.targetId, phase, mode: hotkey.mode };
              c.emit(ANIMATION_EVENT, payload);
            }
            return;
        }
      } catch (e) {
        console.error(`ホットキー（${hotkey.keys}）の動作で例外が出た`, e);
      }
    },
    retain(hotkeys) {
      const byId = new Map(hotkeys.map((h) => [h.id, h]));
      let dirty = false;
      for (const [id, old] of [...known]) {
        const now = byId.get(id);
        if (now && sameAssignment(old, now)) continue;
        known.delete(id);
        memory.delete(id);
        pausedByHold.delete(id);
        if (parameters.delete(id)) dirty = true;
      }
      // 一時停止を戻すホットキーが無くなったら再開する
      if (paused && !hotkeys.some((h) => h.action === 'pauseTracking')) resume(ctx);
      if (dirty) changed();
    },
    trackingSessionEnded() {
      if (!paused) return;
      paused = false;
      pausedByHold.clear();
      changed();
    },
    trackingPaused: () => paused,
    activeParameterIds: () => [...new Set(parameters.values())],
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    producer,
  };
}
