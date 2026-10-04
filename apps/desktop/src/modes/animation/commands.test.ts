import { describe, expect, it } from 'vitest';
import { createEmptyProject, validateProject, type Animation, type Project } from '@app/schema';
import { createProjectStore } from '@app/core';
import {
  addAnimationCommand,
  cloneAnimation,
  copyAnimationName,
  createAnimation,
  duplicateAnimationCommand,
  nextAnimationName,
  removeAnimationCommand,
  renameAnimationCommand,
  updateAnimationCommand,
} from './commands';
import { setKeyframe } from './keyframes';
import { applyTransitionPreset, setLoop } from './settings';

function projectWith(animations: Animation[]): Project {
  return { ...createEmptyProject('テスト'), animations };
}

const walk = (): Animation => ({
  ...createAnimation('歩く', 'walk'),
  tracks: [{ parameterId: 'FaceAngleX', keyframes: [{ time: 0, value: 10, curve: 'linear' }] }],
});

describe('アニメーションの一覧のコマンド', () => {
  it('新しいアニメーションは検証を通る（長さ 2 秒・等速・ループなし・最初から）', () => {
    const a = createAnimation('アニメーション 1', 'a1');
    expect(a).toMatchObject({ duration: 2, speed: 1, loop: false, periodic: false, tracks: [], restart: 'restart' });
    expect(() => validateProject(projectWith([a]))).not.toThrow();
  });

  it('名前: 使っていない「アニメーション N」、写しは「… のコピー」', () => {
    expect(nextAnimationName([])).toBe('アニメーション 1');
    expect(nextAnimationName([createAnimation('アニメーション 2', 'x')])).toBe('アニメーション 3');
    const list = [createAnimation('歩く', 'a'), createAnimation('歩く のコピー', 'b')];
    expect(copyAnimationName('歩く', list)).toBe('歩く のコピー 2');
    expect(copyAnimationName('走る', list)).toBe('走る のコピー');
  });

  it('追加・名前の変更・複製・削除と Undo', () => {
    const store = createProjectStore(projectWith([]));
    store.dispatch(addAnimationCommand(walk()));
    store.dispatch(renameAnimationCommand('walk', '  歩き  '));
    store.dispatch(duplicateAnimationCommand('walk', 'copy'));
    store.dispatch(addAnimationCommand(createAnimation('うなずき', 'nod')));
    expect(store.get().animations.map((a) => [a.id, a.name])).toEqual([
      ['walk', '歩き'],
      ['copy', '歩き のコピー'],
      ['nod', 'うなずき'],
    ]);
    store.dispatch(removeAnimationCommand('walk'));
    expect(store.get().animations.map((a) => a.id)).toEqual(['copy', 'nod']);
    store.undo();
    store.undo();
    store.undo();
    expect(store.get().animations.map((a) => a.name)).toEqual(['歩き']);
    store.undo();
    expect(store.get().animations.map((a) => a.name)).toEqual(['歩く']);
    store.undo();
    expect(store.get().animations).toEqual([]);
  });

  it('複製は中身を写す（元を変えても写しは変わらない）', () => {
    const source = walk();
    const copy = cloneAnimation(source, 'copy', '写し');
    expect(copy).toEqual({ ...source, id: 'copy', name: '写し' });
    expect(copy.tracks[0]).not.toBe(source.tracks[0]);
    expect(copy.tracks[0]!.keyframes[0]).not.toBe(source.tracks[0]!.keyframes[0]);
    expect(copy.transition).not.toBe(source.transition);
  });

  it('何も変わらないときは何もしない（Undo に積まない）', () => {
    const store = createProjectStore(projectWith([walk()]));
    store.dispatch(addAnimationCommand(walk()));
    store.dispatch(renameAnimationCommand('walk', '歩く'));
    store.dispatch(renameAnimationCommand('walk', '   '));
    store.dispatch(renameAnimationCommand('none', '名前'));
    store.dispatch(duplicateAnimationCommand('none', 'x'));
    store.dispatch(duplicateAnimationCommand('walk', 'walk'));
    store.dispatch(removeAnimationCommand('none'));
    store.dispatch(updateAnimationCommand('ループを変える', 'walk', (a) => setLoop(a, false)));
    store.dispatch(updateAnimationCommand('ループを変える', 'none', (a) => setLoop(a, true)));
    expect(store.canUndo()).toBe(false);
  });

  it('削除するとシーンの周期アニメーションからも外す（Undo で戻る）。ホットキーは残す', () => {
    const p = projectWith([walk()]);
    const scene = { ...p.studio.scenes[0]!, periodicAnimationIds: ['walk', 'other'] };
    const hotkey = {
      id: 'h1',
      keys: 'Ctrl+1',
      action: 'animation' as const,
      targetId: 'walk',
      mode: 'toggle' as const,
    };
    const store = createProjectStore({ ...p, studio: { ...p.studio, scenes: [scene], hotkeys: [hotkey] } });
    store.dispatch(removeAnimationCommand('walk'));
    expect(store.get().studio.scenes[0]!.periodicAnimationIds).toEqual(['other']);
    expect(store.get().studio.hotkeys).toEqual([hotkey]);
    store.undo();
    expect(store.get().studio.scenes[0]!.periodicAnimationIds).toEqual(['walk', 'other']);
  });

  it('updateAnimationCommand: キーフレームと設定の変更は1回ずつ Undo で戻り、検証を通る', () => {
    const store = createProjectStore(projectWith([walk()]));
    store.dispatch(updateAnimationCommand('キーフレームを追加', 'walk', (a) => setKeyframe(a, 'MouthOpen', 1, 0.8)));
    store.dispatch(updateAnimationCommand('遷移を変える', 'walk', (a) => applyTransitionPreset(a, 'quick')));
    expect(store.get().animations[0]!.tracks.map((t) => t.parameterId)).toEqual(['FaceAngleX', 'MouthOpen']);
    expect(store.get().animations[0]!.transition.preset).toBe('quick');
    expect(() => validateProject(store.get())).not.toThrow();
    store.undo();
    expect(store.get().animations[0]!.transition.preset).toBe('auto');
    store.undo();
    expect(store.get().animations[0]).toEqual(walk());
  });
});
