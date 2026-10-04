// 表情（カード38・52）のスタジオ側。実行部に入れる producer は、つないだ services.expressions に任せる
// （本物は @app/core の createExpressionController。表情ごとのレイヤーを適用した順に返す）。
// 適用中の表情は services.expressions.actives() を正とし、画面のために変わったら知らせる
// （ホットキー・シーンの切り替えは services.expressions を直接呼ぶので、毎フレーム確かめる）。
// カードの押し方（重ねる / 1つずつ切り替え）は Environment に項目が無いので、この PC の localStorage に覚える
import type { ExpressionController, LayerProducer } from '@app/contracts';

// stack: 押すたびに重ねる・外す（toggle）。single: 押した表情だけにする（STEP1 と同じ apply）
export type ExpressionCardMode = 'stack' | 'single';
export const DEFAULT_EXPRESSION_CARD_MODE: ExpressionCardMode = 'stack';
export const EXPRESSION_CARD_MODE_KEY = 'live2d-studio.expressionCardMode';

export interface CardModeStorage {
  read(): string | null;
  write(value: string): void;
}

// 保存できない環境では覚えない（動作は続ける）
export function localCardModeStorage(key = EXPRESSION_CARD_MODE_KEY): CardModeStorage {
  return {
    read() {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write(value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        // 覚えられなくても動作は続ける
      }
    },
  };
}

export function memoryCardModeStorage(initial: string | null = null): CardModeStorage & { value: string | null } {
  const storage = {
    value: initial,
    read: () => storage.value,
    write(value: string) {
      storage.value = value;
    },
  };
  return storage;
}

function parseCardMode(text: string | null): ExpressionCardMode {
  return text === 'single' || text === 'stack' ? text : DEFAULT_EXPRESSION_CARD_MODE;
}

const NONE: readonly string[] = [];

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export interface ExpressionBinding {
  readonly producer: LayerProducer; // 実行部に登録する（id 'expression'）。つないでいなければ何も出さない
  bind(target: ExpressionController): void; // services.expressions をつなぐ
  bound(): ExpressionController | null;
  // 画面に出す適用中の表情（適用した順。最後に確かめた値で、変わらなければ同じ配列を返す）
  actives(): readonly string[];
  // カードを押したとき。stack では重ねる・外す、single では押した表情だけにする（それだけを適用中なら解除）
  toggle(expressionId: string, now: number): void;
  mode(): ExpressionCardMode;
  setMode(mode: ExpressionCardMode): void; // 保存する。適用中の表情は変えない
  subscribe(listener: () => void): () => void; // 適用中の表情か押し方が変わったら呼ぶ
}

export function createExpressionBinding(storage: CardModeStorage = localCardModeStorage()): ExpressionBinding {
  let target: ExpressionController | null = null;
  let actives: readonly string[] = NONE;
  let currentMode: ExpressionCardMode | null = null; // 最初に使うときに保存先から読む
  const listeners = new Set<() => void>();
  const mode = () => (currentMode ??= parseCardMode(storage.read()));
  const notify = () => {
    for (const l of [...listeners]) l();
  };

  function sync() {
    const next = target?.actives() ?? NONE;
    if (sameIds(next, actives)) return;
    actives = next.length === 0 ? NONE : [...next];
    notify();
  }

  return {
    producer: {
      id: 'expression',
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
    actives: () => actives,
    toggle(expressionId, now) {
      if (!target) return;
      if (mode() === 'stack') {
        target.toggle(expressionId, now);
      } else {
        const current = target.actives();
        const only = current.length === 1 && current[0] === expressionId;
        target.apply(only ? null : expressionId, now);
      }
      sync();
    },
    mode,
    setMode(next) {
      if (next === mode()) return;
      currentMode = next;
      storage.write(next);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// アプリで1つ。スタジオの実行部（studioRuntime）に登録し、スタジオの「表情」パネルが services をつなぐ
export const expressionBinding: ExpressionBinding = createExpressionBinding();
