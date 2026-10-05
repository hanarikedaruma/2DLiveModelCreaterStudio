import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, createEmptyScene, type Hotkey, type Project } from '@app/schema';
import { FakeExpressions, type ProjectStore, type Services } from '@app/contracts';
import { createProjectStore } from '@app/core';
import { createFakeServices } from '../../../services';
import { createHotkeyActions } from '../../../hotkeys/actions';
import { setBackgroundCommand } from '../scene';
import {
  addSceneCommand,
  removeSceneCommand,
  renameSceneCommand,
  selectSceneCommand,
  setSceneExpressionCommand,
} from './commands';
import { createSceneWatcher, SCENE_CHANGED_EVENT, type SceneWatcher } from './watcher';

function project(): Project {
  const p = createEmptyProject('テスト');
  return {
    ...p,
    expressions: [
      { id: 'smile', name: '笑顔', entries: [], fadeIn: 0, fadeOut: 0 },
      { id: 'angry', name: '怒り', entries: [], fadeIn: 0, fadeOut: 0 },
    ],
    studio: {
      ...p.studio,
      scenes: [
        { ...createEmptyScene('雑談'), id: 'chat', expressionIds: ['smile'] },
        { ...createEmptyScene('ゲーム'), id: 'game' },
        { ...createEmptyScene('歌'), id: 'song', expressionIds: ['angry'] },
      ],
      activeSceneId: 'chat',
    },
  };
}

let store: ProjectStore;
let expressions: FakeExpressions;
let events: { name: string; payload: unknown }[];
let watcher: SceneWatcher;

function bind(s: ProjectStore = store) {
  watcher.bind({ store: s, expressions, now: () => 500, emit: (name, payload) => events.push({ name, payload }) });
}

const changed = () => events.filter((e) => e.name === SCENE_CHANGED_EVENT).map((e) => e.payload);

beforeEach(() => {
  store = createProjectStore(project());
  expressions = new FakeExpressions();
  events = [];
  watcher = createSceneWatcher();
});
afterEach(() => watcher.unbind());

describe('sceneChanged', () => {
  it('つないだときは表情を合わせるだけで、sceneChanged は出さない', () => {
    const apply = vi.spyOn(expressions, 'apply');
    bind();
    expect(apply).toHaveBeenCalledWith('smile', 500);
    expect(events).toEqual([]);
  });

  it('切り替えるたびに1回だけ、シーンの id を値にして出す。Undo・Redo でも出す', () => {
    bind();
    store.dispatch(selectSceneCommand('game'));
    store.dispatch(selectSceneCommand('game')); // 同じシーンは何も変わらない
    store.dispatch(selectSceneCommand('song'));
    expect(changed()).toEqual(['game', 'song']);
    store.undo();
    store.redo();
    expect(changed()).toEqual(['game', 'song', 'game', 'song']);
  });

  it('シーンの中身（背景・名前）を変えただけでは出さない', () => {
    bind();
    store.dispatch(setBackgroundCommand({ type: 'color', color: '#00ff00' }));
    store.dispatch(renameSceneCommand('chat', '朝の雑談'));
    expect(events).toEqual([]);
  });

  it('使っているシーンを消して切り替わったとき、追加して切り替わったときも出す。全部消えたら出さない', () => {
    bind();
    store.dispatch(removeSceneCommand('chat'));
    expect(changed()).toEqual(['game']);
    store.dispatch(removeSceneCommand('game'));
    store.dispatch(removeSceneCommand('song'));
    expect(changed()).toEqual(['game', 'song']);
    const s = { ...createEmptyScene('新しい'), id: 'new' };
    store.dispatch(addSceneCommand(s));
    expect(changed()).toEqual(['game', 'song', 'new']);
  });

  it('外したあとは出さない。別の store につなぎ直すと前の store は見ない', () => {
    bind();
    watcher.unbind();
    store.dispatch(selectSceneCommand('game'));
    expect(events).toEqual([]);
    const other = createProjectStore(project());
    bind();
    bind(other);
    store.dispatch(selectSceneCommand('song'));
    other.dispatch(selectSceneCommand('song'));
    expect(changed()).toEqual(['song']);
  });

  it('同じ store・expressions でつなぎ直しても、二重には出さない', () => {
    bind();
    bind();
    store.dispatch(selectSceneCommand('game'));
    expect(changed()).toEqual(['game']);
  });

  it('ホットキー（カード40）でシーンを切り替えても1回だけ出る', () => {
    const services: Services = { ...createFakeServices(), store, expressions };
    bind();
    const actions = createHotkeyActions();
    actions.setContext({
      services,
      now: () => 0,
      emit: (name, payload) => events.push({ name, payload }),
      trackingSessionActive: () => false,
      cameraDeviceId: () => null,
      expressionMode: () => 'stack',
      notify: () => {},
    });
    const hotkey: Hotkey = { id: 'h', keys: 'F1', action: 'scene', targetId: 'song', mode: 'toggle' };
    actions.handle(hotkey, 'down');
    actions.handle(hotkey, 'up');
    expect(changed()).toEqual(['song']);
    actions.handle(hotkey, 'down'); // もう一度で前のシーンに戻す
    expect(changed()).toEqual(['song', 'chat']);
  });
});

describe('表情の適用', () => {
  it('切り替えたシーンの表情を、sceneChanged より先に適用する。表情が無いシーンなら外す', () => {
    bind();
    const order: string[] = [];
    vi.spyOn(expressions, 'apply').mockImplementation((id) => order.push(`apply:${id}`));
    const emitBefore = events.length;
    store.dispatch(selectSceneCommand('song'));
    order.push(...events.slice(emitBefore).map((e) => `emit:${String(e.payload)}`));
    expect(order).toEqual(['apply:angry', 'emit:song']);
    vi.restoreAllMocks();
    store.dispatch(selectSceneCommand('game'));
    expect(expressions.active()).toBeNull();
    store.undo();
    expect(expressions.active()).toBe('angry');
  });

  it('同じシーンのまま表情の指定を変えたら、表情だけを適用する（sceneChanged は出さない）', () => {
    bind();
    store.dispatch(setSceneExpressionCommand('angry'));
    expect(expressions.active()).toBe('angry');
    store.dispatch(setSceneExpressionCommand(null));
    expect(expressions.active()).toBeNull();
    store.undo();
    expect(expressions.active()).toBe('angry');
    expect(events).toEqual([]);
  });

  it('プロジェクトに無い表情は飛ばす。apply が例外を出しても sceneChanged は出す', () => {
    const p = project();
    store.load({
      ...p,
      studio: {
        ...p.studio,
        scenes: p.studio.scenes.map((s) => (s.id === 'game' ? { ...s, expressionIds: ['gone', 'smile'] } : s)),
      },
    });
    bind();
    store.dispatch(selectSceneCommand('game'));
    expect(expressions.active()).toBe('smile');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(expressions, 'apply').mockImplementation(() => {
      throw new Error('壊れた');
    });
    store.dispatch(selectSceneCommand('song'));
    expect(changed()).toEqual(['game', 'song']);
    expect(error).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
