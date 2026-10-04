import { describe, expect, it } from 'vitest';
import { createEmptyProject, createEmptyScene, type Project, type Scene } from '@app/schema';
import { createProjectStore } from '@app/core';
import { activeScene } from '../scene';
import {
  addSceneCommand,
  copyName,
  duplicateSceneCommand,
  moveSceneCommand,
  newScene,
  nextSceneName,
  removeSceneCommand,
  renameSceneCommand,
  sceneExpressionId,
  selectSceneCommand,
  setSceneExpressionCommand,
} from './commands';

function scene(id: string, name: string, patch: Partial<Scene> = {}): Scene {
  return { ...createEmptyScene(name), id, ...patch };
}

function project(scenes: Scene[], activeSceneId: string | null = scenes[0]?.id ?? null): Project {
  const p = createEmptyProject('テスト');
  return {
    ...p,
    expressions: [
      { id: 'smile', name: '笑顔', entries: [], fadeIn: 0, fadeOut: 0 },
      { id: 'angry', name: '怒り', entries: [], fadeIn: 0, fadeOut: 0 },
    ],
    studio: { ...p.studio, scenes, activeSceneId },
  };
}

const three = () => project([scene('a', '雑談'), scene('b', 'ゲーム'), scene('c', '歌')], 'b');
const ids = (p: Project) => p.studio.scenes.map((s) => s.id);

describe('名前', () => {
  it('「シーン N」は重ならない番号にする', () => {
    expect(nextSceneName([])).toBe('シーン 1');
    expect(nextSceneName([scene('a', 'シーン 1')])).toBe('シーン 2');
    expect(nextSceneName([scene('a', 'シーン 2'), scene('b', 'シーン 3')])).toBe('シーン 4');
  });

  it('複製の名前は「のコピー」、重なれば番号を付ける', () => {
    expect(copyName('雑談', [scene('a', '雑談')])).toBe('雑談 のコピー');
    expect(copyName('雑談', [scene('a', '雑談'), scene('b', '雑談 のコピー')])).toBe('雑談 のコピー 2');
  });
});

describe('切り替え', () => {
  it('activeSceneId を変える。いまのシーン・無いシーンは何もしない', () => {
    const p = three();
    expect(selectSceneCommand('c').apply(p).studio.activeSceneId).toBe('c');
    expect(selectSceneCommand('b').apply(p)).toBe(p);
    expect(selectSceneCommand('none').apply(p)).toBe(p);
  });

  it('activeSceneId が無いときは先頭が使われているので、先頭を押しても何もしない', () => {
    const p = project([scene('a', '雑談'), scene('b', 'ゲーム')], null);
    expect(selectSceneCommand('a').apply(p)).toBe(p);
    expect(selectSceneCommand('b').apply(p).studio.activeSceneId).toBe('b');
  });
});

describe('追加と複製', () => {
  it('追加は末尾に足して切り替える', () => {
    const p = three();
    const s = newScene(p);
    expect(s.name).toBe('シーン 4');
    const next = addSceneCommand(s).apply(p);
    expect(ids(next)).toEqual(['a', 'b', 'c', s.id]);
    expect(next.studio.activeSceneId).toBe(s.id);
    expect(addSceneCommand(s).apply(next)).toBe(next); // 同じ id は足さない
  });

  it('複製は背景・配置・表情を写してすぐ後ろに置き、写しに切り替える（元とは別のオブジェクト）', () => {
    const src = scene('a', '雑談', {
      background: { type: 'image', path: 'backgrounds/room.png' },
      modelTransform: { position: { x: 10, y: -20 }, scale: 1.5 },
      expressionIds: ['smile'],
    });
    const p = project([src, scene('b', 'ゲーム')], 'b');
    const next = duplicateSceneCommand('a', 'copy').apply(p);
    expect(ids(next)).toEqual(['a', 'copy', 'b']);
    expect(next.studio.activeSceneId).toBe('copy');
    const copy = next.studio.scenes[1]!;
    expect(copy).toEqual({ ...src, id: 'copy', name: '雑談 のコピー' });
    expect(copy.modelTransform.position).not.toBe(src.modelTransform.position);
    expect(copy.expressionIds).not.toBe(src.expressionIds);
    expect(next.studio.scenes[0]).toBe(src);
    expect(duplicateSceneCommand('none', 'x').apply(p)).toBe(p);
  });
});

describe('名前の変更', () => {
  it('前後の空白を除いて変える。空・同じ名前は何もしない', () => {
    const p = three();
    expect(renameSceneCommand('a', '  朝の雑談 ').apply(p).studio.scenes[0]!.name).toBe('朝の雑談');
    expect(renameSceneCommand('a', '   ').apply(p)).toBe(p);
    expect(renameSceneCommand('a', '雑談').apply(p)).toBe(p);
    expect(renameSceneCommand('none', 'x').apply(p)).toBe(p);
  });
});

describe('削除', () => {
  it('使っているシーンを消すと、すぐ後ろのシーンに切り替える。末尾ならすぐ前', () => {
    const p = three(); // b を使っている
    const next = removeSceneCommand('b').apply(p);
    expect(ids(next)).toEqual(['a', 'c']);
    expect(next.studio.activeSceneId).toBe('c');
    const last = removeSceneCommand('c').apply(selectSceneCommand('c').apply(p));
    expect(last.studio.activeSceneId).toBe('b');
  });

  it('ほかのシーンを消しても使っているシーンは変えない', () => {
    const next = removeSceneCommand('a').apply(three());
    expect(ids(next)).toEqual(['b', 'c']);
    expect(next.studio.activeSceneId).toBe('b');
  });

  it('activeSceneId が無く先頭を使っているとき、先頭を消すと次の先頭に切り替える', () => {
    const p = project([scene('a', '雑談'), scene('b', 'ゲーム')], null);
    expect(removeSceneCommand('a').apply(p).studio.activeSceneId).toBe('b');
  });

  it('最後の1つを消すと activeSceneId は null。無いシーンは何もしない', () => {
    const p = project([scene('a', '雑談')]);
    const next = removeSceneCommand('a').apply(p);
    expect(next.studio.scenes).toEqual([]);
    expect(next.studio.activeSceneId).toBeNull();
    expect(removeSceneCommand('none').apply(p)).toBe(p);
  });
});

describe('並べ替え', () => {
  it('位置を変える。範囲の外は端にし、同じ位置なら何もしない', () => {
    const p = three();
    expect(ids(moveSceneCommand('c', 0).apply(p))).toEqual(['c', 'a', 'b']);
    expect(ids(moveSceneCommand('a', 1).apply(p))).toEqual(['b', 'a', 'c']);
    expect(ids(moveSceneCommand('a', 99).apply(p))).toEqual(['b', 'c', 'a']);
    expect(moveSceneCommand('a', -5).apply(p)).toBe(p);
    expect(moveSceneCommand('none', 0).apply(p)).toBe(p);
    expect(moveSceneCommand('c', 1).apply(p).studio.activeSceneId).toBe('b');
  });
});

describe('表情', () => {
  it('使っているシーンの expressionIds を [id] か [] にする。同じなら何もしない', () => {
    const p = three();
    const next = setSceneExpressionCommand('smile').apply(p);
    expect(activeScene(next)!.expressionIds).toEqual(['smile']);
    expect(next.studio.scenes[0]).toBe(p.studio.scenes[0]);
    expect(setSceneExpressionCommand('smile').apply(next)).toBe(next);
    expect(activeScene(setSceneExpressionCommand(null).apply(next))!.expressionIds).toEqual([]);
  });

  it('適用する表情は、プロジェクトにある先頭のもの', () => {
    const p = three();
    expect(sceneExpressionId(p, scene('x', 'x', { expressionIds: ['gone', 'angry', 'smile'] }))).toBe('angry');
    expect(sceneExpressionId(p, scene('x', 'x'))).toBeNull();
    expect(sceneExpressionId(p, null)).toBeNull();
  });
});

describe('Undo', () => {
  it('追加・切り替え・削除はそれぞれ1回の Undo で戻る', () => {
    const store = createProjectStore(three());
    const s = newScene(store.get());
    store.dispatch(addSceneCommand(s));
    store.dispatch(selectSceneCommand('a'));
    store.dispatch(removeSceneCommand('a'));
    expect(ids(store.get())).toEqual(['b', 'c', s.id]);
    expect(store.get().studio.activeSceneId).toBe('b');
    store.undo();
    expect(ids(store.get())).toEqual(['a', 'b', 'c', s.id]);
    expect(store.get().studio.activeSceneId).toBe('a');
    store.undo();
    expect(store.get().studio.activeSceneId).toBe(s.id);
    store.undo();
    expect(ids(store.get())).toEqual(['a', 'b', 'c']);
    expect(store.get().studio.activeSceneId).toBe('b');
    expect(store.canUndo()).toBe(false);
  });
});
