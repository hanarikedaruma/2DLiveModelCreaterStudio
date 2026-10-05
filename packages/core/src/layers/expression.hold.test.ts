import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@app/schema';
import { FakeExpressions, type ExpressionController, type FrameContext } from '@app/contracts';
import { createExpressionController } from './expression';

describe.each([
  ['本物', createExpressionController],
  ['仮実装', () => new FakeExpressions()],
] as const)('%sの表情hold（I-043）', (_name, create) => {
  function base() {
    const c = create();
    c.toggle('a', 0);
    c.toggle('b', 0);
    return c;
  }
  it('stackは追加分だけ外し、元の一覧と順序を保つ', () => {
    const c = base();
    c.hold('h', 'c', 'stack', 1);
    expect(c.actives()).toEqual(['a', 'b', 'c']);
    c.release('h', 2);
    expect(c.actives()).toEqual(['a', 'b']);
    c.hold('h', 'a', 'stack', 3);
    c.release('h', 4);
    expect(c.actives()).toEqual(['a', 'b']);
  });
  it.each([
    ['first', 'second'],
    ['second', 'first'],
  ])('同じ表情の所有者を別々に解除する: %s→%s', (a, b) => {
    const c = base();
    c.hold('first', 'c', 'stack', 1);
    c.hold('second', 'c', 'stack', 2);
    c.release(a, 3);
    expect(c.actives()).toEqual(['a', 'b', 'c']);
    c.release(b, 4);
    expect(c.actives()).toEqual(['a', 'b']);
  });
  it('後から押したカードの順序を保ち、holdの表情をカードで外せる', () => {
    const c = base();
    c.hold('h', 'c', 'stack', 1);
    c.toggle('d', 2);
    expect(c.actives()).toEqual(['a', 'b', 'c', 'd']);
    c.toggle('c', 3);
    expect(c.actives()).toEqual(['a', 'b', 'd']);
    c.release('h', 4);
    expect(c.actives()).toEqual(['a', 'b', 'd']);
  });
  it('singleは一時的な一覧を持ち、解除順にかかわらず古いholdを復活させない', () => {
    const c = base();
    c.hold('first', 'c', 'single', 1);
    c.hold('second', 'd', 'single', 2);
    expect(c.actives()).toEqual(['d']);
    c.release('first', 3);
    expect(c.actives()).toEqual(['d']);
    c.release('second', 4);
    expect(c.actives()).toEqual(['a', 'b']);
  });
  it('single中の明示的なapplyはholdを無効にし、キーを離しても戻らない', () => {
    const c = base();
    c.hold('h', 'c', 'single', 1);
    c.apply('d', 2);
    c.release('h', 3);
    expect(c.actives()).toEqual(['d']);
  });
  it('全解除holdは複数の所有者を扱い、途中のtoggleも解除後に保持する', () => {
    const c = base();
    c.hold('clear1', null, 'stack', 1);
    c.hold('clear2', null, 'stack', 2);
    c.toggle('c', 3);
    c.release('clear1', 4);
    expect(c.actives()).toEqual([]);
    c.release('clear2', 5);
    expect(c.actives()).toEqual(['a', 'b', 'c']);
    c.hold('clear3', null, 'stack', 6);
    // eslint-disable-next-line prefer-spread -- ExpressionController.apply は Function.prototype.apply ではない
    c.apply(null, 7);
    c.release('clear3', 8);
    expect(c.actives()).toEqual([]);
  });
});

it('single holdの解除は、一覧の順序だけでなく出力レイヤーの順序とフェードも復元する', () => {
  const c: ExpressionController = createExpressionController();
  const project = createEmptyProject('holdの確認');
  project.expressions = ['a', 'b', 'c'].map((id, value) => ({
    id,
    name: id,
    entries: [{ parameterId: 'MouthOpen', value, blend: 'override' }],
    fadeIn: 0.2,
    fadeOut: 0.2,
  }));
  const frame = (now: number): FrameContext => ({
    project,
    now,
    dt: 16,
    mixedSoFar: {},
    flags: { lipSyncWeight: 1, physicsActive: true },
  });
  c.toggle('a', 0);
  c.toggle('b', 0);
  c.produce(frame(200));
  c.hold('h', 'b', 'single', 200);
  c.produce(frame(400));
  c.release('h', 400);
  const layers = c.produce(frame(600));
  expect(Array.isArray(layers)).toBe(true);
  expect(
    (layers as { values: Record<string, number>; weight: number }[]).map((l) => [l.values.MouthOpen, l.weight]),
  ).toEqual([
    [0, 1],
    [1, 1],
  ]);
});
