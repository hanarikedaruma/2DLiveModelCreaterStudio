import type { BlendOp } from '@app/schema';
import type { AutoBlink, BodyFollowProducer, ExpressionController, FrameContext, Layer, ParamValues } from '../index';

const BLINK_INTERVAL = 4000; // 4秒ごとに
const BLINK_DURATION = 150; // 目を閉じている時間（ミリ秒）

// 4秒ごとに 150ms だけ両目を閉じる（周期の終わりに閉じる）
export class FakeAutoBlink implements AutoBlink {
  tick(now: number): { EyeOpenL: number; EyeOpenR: number } {
    const phase = ((now % BLINK_INTERVAL) + BLINK_INTERVAL) % BLINK_INTERVAL;
    const open = phase >= BLINK_INTERVAL - BLINK_DURATION ? 0 : 1;
    return { EyeOpenL: open, EyeOpenR: open };
  }
}

// 何も出さない。強さは覚えるだけ
export class FakeBodyFollow implements BodyFollowProducer {
  readonly id = 'bodyFollow' as const;
  strength: 'low' | 'standard' | 'high' = 'standard';

  setStrength(s: 'low' | 'standard' | 'high'): void {
    this.strength = s;
  }

  produce(_ctx: FrameContext): Layer | null {
    return null;
  }
}

// 適用した表情の値をそのまま出す（フェードなし、weight 1）。STEP2 の同時適用（toggle）では、
// 適用した順に重ね、同じパラメータはあとの表情の値にする
export class FakeExpressions implements ExpressionController {
  readonly id = 'expression' as const;
  private activeIds: string[] = [];

  apply(expressionId: string | null, _now: number): void {
    this.activeIds = expressionId === null ? [] : [expressionId];
  }

  active(): string | null {
    return this.activeIds.at(-1) ?? null;
  }

  toggle(expressionId: string, _now: number): void {
    this.activeIds = this.activeIds.includes(expressionId)
      ? this.activeIds.filter((id) => id !== expressionId)
      : [...this.activeIds, expressionId];
  }

  actives(): string[] {
    return [...this.activeIds];
  }

  produce(ctx: FrameContext): Layer | null {
    const values: ParamValues = {};
    const blend: Record<string, BlendOp> = {};
    for (const id of this.activeIds) {
      const expression = ctx.project.expressions.find((e) => e.id === id);
      for (const entry of expression?.entries ?? []) {
        values[entry.parameterId] = entry.value;
        blend[entry.parameterId] = entry.blend;
      }
    }
    if (Object.keys(values).length === 0) return null;
    return { id: 'expression', weight: 1, values, blend };
  }
}
