import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@app/schema';
import type { FrameContext } from '../index';
import { FakeExpressions } from './motion';
import { FakeAnimationPlayer, FakePeriodic, FakePhysics, FakeVowels } from './step2';

function context(patch: Partial<FrameContext> = {}): FrameContext {
  return {
    now: 0,
    dt: 16,
    project: createEmptyProject('テスト'),
    mixedSoFar: {},
    flags: { lipSyncWeight: 1, physicsActive: true },
    ...patch,
  };
}

describe('STEP2 の仮実装', () => {
  it('FakeAnimationPlayer は何も出さず、再生中の一覧だけを覚える', () => {
    const player = new FakeAnimationPlayer();
    expect(player.id).toBe('animation');
    player.play('wave', 0);
    player.play('nod', 0);
    player.play('wave', 10); // 同じものは1つ
    expect(player.playing()).toEqual(['wave', 'nod']);
    player.stop('wave', 20);
    expect(player.playing()).toEqual(['nod']);
    player.stopAll(30);
    expect(player.playing()).toEqual([]);
    expect(player.produce(context())).toBeNull();
  });

  it('FakePeriodic・FakePhysics は何も出さない', () => {
    const periodic = new FakePeriodic();
    periodic.setActive(['breath']);
    expect(periodic.active).toEqual(['breath']);
    expect(periodic.produce(context())).toBeNull();
    const physics = new FakePhysics();
    physics.reset();
    expect(physics.resets).toBe(1);
    expect(physics.produce(context())).toBeNull();
  });

  it('FakeVowels はいつも閉じた口（合計 1）', () => {
    const v = new FakeVowels().estimate(new Float32Array(480), 48000);
    expect(v).toEqual({ closed: 1, a: 0, i: 0, u: 0, e: 0, o: 0 });
  });

  it('FakeExpressions の toggle は同時に適用し、actives は適用した順、apply は1つにする', () => {
    const project = {
      ...createEmptyProject('テスト'),
      expressions: [
        {
          id: 'smile',
          name: '笑顔',
          entries: [{ parameterId: 'MouthForm', value: 1, blend: 'override' as const }],
          fadeIn: 0,
          fadeOut: 0,
        },
        {
          id: 'blush',
          name: '照れ',
          entries: [
            { parameterId: 'Cheek', value: 1, blend: 'override' as const },
            { parameterId: 'MouthForm', value: 0.5, blend: 'override' as const },
          ],
          fadeIn: 0,
          fadeOut: 0,
        },
      ],
    };
    const expressions = new FakeExpressions();
    expressions.toggle('smile', 0);
    expressions.toggle('blush', 0);
    expect(expressions.actives()).toEqual(['smile', 'blush']);
    expect(expressions.active()).toBe('blush');
    expect(expressions.produce(context({ project }))?.values).toEqual({ MouthForm: 0.5, Cheek: 1 });
    expressions.toggle('smile', 0);
    expect(expressions.actives()).toEqual(['blush']);
    expressions.apply('smile', 0);
    expect(expressions.actives()).toEqual(['smile']);
    // eslint-disable-next-line prefer-spread -- ExpressionController.apply は Function.prototype.apply ではない
    expressions.apply(null, 0);
    expect(expressions.actives()).toEqual([]);
    expect(expressions.produce(context({ project }))).toBeNull();
  });
});
