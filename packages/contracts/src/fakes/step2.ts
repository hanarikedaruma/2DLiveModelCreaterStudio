import type { AnimationPlayer, FrameContext, Layer, PeriodicPlayer, PhysicsEngine, VowelEstimator } from '../index';

// 何も出さない。再生中の一覧だけを覚える（画面の表示のため）
export class FakeAnimationPlayer implements AnimationPlayer {
  readonly id = 'animation' as const;
  private ids: string[] = [];

  play(animationId: string, _now: number): void {
    if (!this.ids.includes(animationId)) this.ids = [...this.ids, animationId];
  }

  stop(animationId: string, _now: number): void {
    this.ids = this.ids.filter((id) => id !== animationId);
  }

  stopAll(_now: number): void {
    this.ids = [];
  }

  playing(): string[] {
    return [...this.ids];
  }

  produce(_ctx: FrameContext): Layer | null {
    return null;
  }
}

// 何も出さない。有効にした周期アニメーションの一覧だけを覚える
export class FakePeriodic implements PeriodicPlayer {
  readonly id = 'periodic' as const;
  active: string[] = [];

  setActive(animationIds: string[]): void {
    this.active = [...animationIds];
  }

  produce(_ctx: FrameContext): Layer | null {
    return null;
  }
}

// 何も出さない。reset を呼んだ回数だけ数える
export class FakePhysics implements PhysicsEngine {
  readonly id = 'physics' as const;
  resets = 0;

  reset(): void {
    this.resets++;
  }

  produce(_ctx: FrameContext): Layer | null {
    return null;
  }
}

// いつも口を閉じている（closed 1）
export class FakeVowels implements VowelEstimator {
  estimate(
    _samples: Float32Array,
    _sampleRate: number,
  ): { closed: number; a: number; i: number; u: number; e: number; o: number } {
    return { closed: 1, a: 0, i: 0, u: 0, e: 0, o: 0 };
  }
}
