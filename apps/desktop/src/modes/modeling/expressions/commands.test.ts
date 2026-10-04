import { describe, expect, it } from 'vitest';
import { createEmptyProject, createEmptyScene, type Expression, type Project } from '@app/schema';
import { createProjectStore } from '@app/core';
import {
  addExpressionCommand,
  addExpressionsCommand,
  createExpression,
  missingStandardExpressions,
  nextExpressionName,
  removeExpressionCommand,
  STANDARD_EXPRESSION_NAMES,
  updateExpressionCommand,
} from './commands';

const smile: Expression = {
  id: 'smile',
  name: '笑顔',
  entries: [{ parameterId: 'MouthOpen', value: 0.3, blend: 'add' }],
  fadeIn: 0.2,
  fadeOut: 0.2,
};

function project(expressions: Expression[] = [smile]): Project {
  const p = createEmptyProject('テスト');
  return {
    ...p,
    expressions,
    studio: {
      ...p.studio,
      scenes: [
        { ...createEmptyScene('雑談'), id: 'chat', expressionIds: ['smile'] },
        { ...createEmptyScene('ゲーム'), id: 'game', expressionIds: ['other', 'smile'] },
        { ...createEmptyScene('歌'), id: 'song' },
      ],
      activeSceneId: 'chat',
    },
  };
}

describe('表情を作る', () => {
  it('新しい表情の fadeIn・fadeOut の初期値は 0.2 秒', () => {
    const e = createExpression('驚き', [], 'x');
    expect(e).toEqual({ id: 'x', name: '驚き', entries: [], fadeIn: 0.2, fadeOut: 0.2 });
    expect(createExpression('a').id).not.toBe(createExpression('a').id);
  });

  it('名前は使っていない「表情 N」', () => {
    expect(nextExpressionName([])).toBe('表情 1');
    expect(nextExpressionName([smile])).toBe('表情 2');
    expect(nextExpressionName([smile, { ...smile, id: 'b', name: '表情 2' }])).toBe('表情 3');
  });

  it('標準の表情のひな形は7つ（値は空）。プロジェクトに同じ名前があるものは除く', () => {
    expect(STANDARD_EXPRESSION_NAMES).toEqual(['通常', '笑顔', '怒り', '悲しみ', '驚き', '照れ', 'ウィンク']);
    const all = missingStandardExpressions(project([]));
    expect(all.map((e) => e.name)).toEqual([...STANDARD_EXPRESSION_NAMES]);
    for (const e of all) expect(e).toMatchObject({ entries: [], fadeIn: 0.2, fadeOut: 0.2 });
    expect(missingStandardExpressions(project()).map((e) => e.name)).toEqual([
      '通常',
      '怒り',
      '悲しみ',
      '驚き',
      '照れ',
      'ウィンク',
    ]);
  });
});

describe('表情のコマンド', () => {
  it('追加は末尾に足し、1回の Undo で戻る。同じ id は足さない', () => {
    const store = createProjectStore(project());
    const angry = createExpression('怒り', [], 'angry');
    store.dispatch(addExpressionCommand(angry));
    expect(store.get().expressions.map((e) => e.id)).toEqual(['smile', 'angry']);
    const before = store.get();
    store.dispatch(addExpressionCommand(angry));
    expect(store.get()).toBe(before);
    store.undo();
    expect(store.get().expressions.map((e) => e.id)).toEqual(['smile']);
    expect(store.canUndo()).toBe(false);
  });

  it('ひな形はまとめて1回の Undo。足すものが無ければ何もしない', () => {
    const store = createProjectStore(project([]));
    store.dispatch(addExpressionsCommand('ひな形', missingStandardExpressions(store.get())));
    expect(store.get().expressions).toHaveLength(7);
    const before = store.get();
    store.dispatch(addExpressionsCommand('ひな形', missingStandardExpressions(store.get())));
    expect(store.get()).toBe(before);
    store.undo();
    expect(store.get().expressions).toEqual([]);
  });

  it('変更: 名前（空白を除く）・項目・フェードの秒数を変える。変わらなければ何もしない', () => {
    const store = createProjectStore(project());
    const entries: Expression['entries'] = [{ parameterId: 'EyeOpenL', value: 0, blend: 'multiply' }];
    store.dispatch(updateExpressionCommand('変える', 'smile', { name: '  にっこり ', entries, fadeIn: 0.5 }));
    expect(store.get().expressions[0]).toEqual({ ...smile, name: 'にっこり', entries, fadeIn: 0.5 });
    const before = store.get();
    store.dispatch(updateExpressionCommand('変える', 'smile', { name: 'にっこり', entries: [...entries] }));
    store.dispatch(updateExpressionCommand('変える', 'smile', { name: '   ', fadeOut: -1 }));
    store.dispatch(updateExpressionCommand('変える', 'smile', { fadeIn: Number.NaN }));
    store.dispatch(updateExpressionCommand('変える', 'gone', { name: 'x' }));
    expect(store.get()).toBe(before);
    store.dispatch(updateExpressionCommand('変える', 'smile', { fadeOut: 0 }));
    expect(store.get().expressions[0]!.fadeOut).toBe(0);
    store.undo();
    store.undo();
    expect(store.get().expressions[0]).toEqual(smile);
  });

  it('削除はシーンの表情の指定からも外し、1回の Undo で戻る', () => {
    const initial = project();
    const store = createProjectStore(initial);
    store.dispatch(removeExpressionCommand('smile'));
    expect(store.get().expressions).toEqual([]);
    expect(store.get().studio.scenes.map((s) => s.expressionIds)).toEqual([[], ['other'], []]);
    store.undo();
    expect(store.get()).toBe(initial);
    const before = store.get();
    store.dispatch(removeExpressionCommand('gone'));
    expect(store.get()).toBe(before);
  });

  it('入力を書き換えない', () => {
    const p = project();
    const copy = structuredClone(p);
    removeExpressionCommand('smile').apply(p);
    updateExpressionCommand('変える', 'smile', { name: 'x' }).apply(p);
    addExpressionCommand(createExpression('x')).apply(p);
    expect(p).toEqual(copy);
  });
});
