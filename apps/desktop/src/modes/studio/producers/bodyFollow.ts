// 体の追従（カード36）のスタジオ側。実行部に入れる producer は、つないだ services.bodyFollow に任せる
// （カード44までは仮実装で何も出さない。本物は @app/core の createBodyFollowProducer）。
// 設定の保存は Environment が担当し、このバインディングは実行中の値を持つ。
import type { BodyFollowProducer, LayerProducer } from '@app/contracts';

export type BodyFollowStrength = Parameters<BodyFollowProducer['setStrength']>[0];

export const BODY_FOLLOW_CHOICES: readonly { id: BodyFollowStrength; label: string }[] = [
  { id: 'low', label: '控えめ' },
  { id: 'standard', label: '標準' },
  { id: 'high', label: '大きめ' },
];
export const DEFAULT_BODY_FOLLOW_STRENGTH: BodyFollowStrength = 'standard';

export interface StrengthStorage {
  read(): string | null;
  write(value: string): void;
}

export function memoryStrengthStorage(initial: string | null = null): StrengthStorage & { value: string | null } {
  const storage = {
    value: initial,
    read: () => storage.value,
    write(value: string) {
      storage.value = value;
    },
  };
  return storage;
}

function parseStrength(text: string | null): BodyFollowStrength {
  return BODY_FOLLOW_CHOICES.find((c) => c.id === text)?.id ?? DEFAULT_BODY_FOLLOW_STRENGTH;
}

export interface BodyFollowBinding {
  readonly producer: LayerProducer; // 実行部に登録する（id 'bodyFollow'）。つないでいなければ何も出さない
  bind(target: BodyFollowProducer): void; // services.bodyFollow をつなぎ、いまの強さを渡す
  bound(): BodyFollowProducer | null;
  strength(): BodyFollowStrength;
  setStrength(s: BodyFollowStrength): void; // 保存して、つないでいるものへ渡す
  subscribe(listener: () => void): () => void;
}

export function createBodyFollowBinding(storage: StrengthStorage = memoryStrengthStorage()): BodyFollowBinding {
  let target: BodyFollowProducer | null = null;
  let current: BodyFollowStrength | null = null; // 最初に使うときに保存先から読む
  const listeners = new Set<() => void>();
  const strength = () => (current ??= parseStrength(storage.read()));

  return {
    producer: { id: 'bodyFollow', produce: (ctx) => target?.produce(ctx) ?? null },
    bind(next) {
      if (next === target) return;
      target = next;
      next.setStrength(strength());
    },
    bound: () => target,
    strength,
    setStrength(s) {
      if (s === strength()) return;
      current = s;
      storage.write(s);
      target?.setStrength(s);
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// アプリで1つ。スタジオの実行部（studioRuntime）に登録し、スタジオの設定のセクションが services をつなぐ
export const bodyFollowBinding: BodyFollowBinding = createBodyFollowBinding();
