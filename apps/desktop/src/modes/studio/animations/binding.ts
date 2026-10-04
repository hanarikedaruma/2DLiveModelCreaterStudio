// アニメーションの再生（カード47）のスタジオ側。実行部に入れる producer は、つないだ services.animations に任せる
// （カード54までは仮実装で何も出さない。本物は @app/core の createAnimationPlayer）。
// 再生中の一覧は services.animations.playing() を正とし、画面のために変わったら知らせる
// （ループでないものは終わると外れるので、毎フレーム確かめる）
import type { AnimationPlayer, LayerProducer } from '@app/contracts';
import type { HotkeyAnimationEvent } from '../../../hotkeys/actions';

export interface AnimationBinding {
  readonly producer: LayerProducer; // 実行部に登録する（id 'animation'）。つないでいなければ何も出さない
  bind(target: AnimationPlayer): void; // services.animations をつなぐ
  bound(): AnimationPlayer | null;
  playing(): readonly string[]; // 画面に出す再生中のアニメーション（最後に確かめた値。変わらなければ同じ配列）
  // 押したアニメーションを再生する。再生中ならやめる
  toggle(animationId: string, now: number): void;
  // ホットキー（'hotkey:animation'）。toggle は押すたびに再生 / やめる、hold は押したら再生・離したらやめる
  hotkey(event: HotkeyAnimationEvent, now: number): void;
  subscribe(listener: () => void): () => void;
}

const EMPTY: readonly string[] = [];

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

// アプリイベントの値が 'hotkey:animation' の形か
export function isHotkeyAnimationEvent(payload: unknown): payload is HotkeyAnimationEvent {
  if (typeof payload !== 'object' || payload === null) return false;
  const e = payload as Partial<Record<keyof HotkeyAnimationEvent, unknown>>;
  return (
    (typeof e.targetId === 'string' || e.targetId === null) &&
    (e.phase === 'down' || e.phase === 'up') &&
    (e.mode === 'toggle' || e.mode === 'hold')
  );
}

export function createAnimationBinding(): AnimationBinding {
  let target: AnimationPlayer | null = null;
  let playing: readonly string[] = EMPTY;
  const listeners = new Set<() => void>();

  function sync() {
    const next = target?.playing() ?? EMPTY;
    if (same(next, playing)) return;
    playing = next.length === 0 ? EMPTY : [...next];
    for (const l of [...listeners]) l();
  }

  function toggle(animationId: string, now: number) {
    if (!target) return;
    if (target.playing().includes(animationId)) target.stop(animationId, now);
    else target.play(animationId, now);
    sync();
  }

  return {
    producer: {
      id: 'animation',
      produce(ctx) {
        if (!target) return null;
        try {
          return target.produce(ctx);
        } finally {
          sync();
        }
      },
    },
    bind(next) {
      if (next === target) return;
      target = next;
      sync();
    },
    bound: () => target,
    playing: () => playing,
    toggle,
    hotkey(event, now) {
      if (!target || event.targetId === null) return;
      if (event.mode === 'toggle') {
        if (event.phase === 'down') toggle(event.targetId, now);
        return;
      }
      if (event.phase === 'down') target.play(event.targetId, now);
      else target.stop(event.targetId, now);
      sync();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// アプリで1つ。スタジオの実行部（studioRuntime）に登録し、スタジオの「アニメーション」パネルが services をつなぐ
export const animationBinding: AnimationBinding = createAnimationBinding();
