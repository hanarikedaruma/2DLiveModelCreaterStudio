import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, createEmptyScene, type Hotkey, type Project } from '@app/schema';
import type { FrameContext, Services } from '@app/contracts';
import { createFakeServices } from '../services';
import { sceneBackground } from '../modes/studio/scene';
import { createHotkeyActions, type HotkeyActionContext, type HotkeyActions } from './actions';

function project(): Project {
  const p = createEmptyProject('テスト');
  const s1 = { ...p.studio.scenes[0]!, id: 'scene-1', name: '雑談' };
  const s2 = { ...createEmptyScene('ゲーム'), id: 'scene-2' };
  return {
    ...p,
    model: {
      ...p.model,
      parameters: [
        ...p.model.parameters,
        { id: 'Tears', name: '涙', groupId: 'other', min: 0, max: 1, default: 0, standard: false },
      ],
    },
    expressions: [
      {
        id: 'smile',
        name: '笑顔',
        entries: [{ parameterId: 'MouthOpen', value: 1, blend: 'override' }],
        fadeIn: 0,
        fadeOut: 0,
      },
      { id: 'angry', name: '怒り', entries: [], fadeIn: 0, fadeOut: 0 },
    ],
    studio: { scenes: [s1, s2], activeSceneId: 'scene-1', hotkeys: [] },
  };
}

const hk = (
  action: Hotkey['action'],
  targetId: string | null,
  mode: Hotkey['mode'] = 'toggle',
  id = `${action}-${mode}`,
): Hotkey => ({
  id,
  keys: 'F1',
  action,
  targetId,
  mode,
});

let services: Services;
let actions: HotkeyActions;
let events: { name: string; payload: unknown }[];
let sessionActive: boolean;
let notices: string[];
let expressionMode: 'stack' | 'single';

function context(): HotkeyActionContext {
  return {
    services,
    now: () => 1000,
    emit: (name, payload) => events.push({ name, payload }),
    trackingSessionActive: () => sessionActive,
    cameraDeviceId: () => 'cam-2',
    expressionMode: () => expressionMode,
    notify: (m) => notices.push(m),
  };
}

const press = (hotkey: Hotkey) => {
  actions.handle(hotkey, 'down');
  actions.handle(hotkey, 'up');
};

const frame = (p: Project): FrameContext => ({
  now: 0,
  dt: 16,
  project: p,
  mixedSoFar: {},
  flags: { lipSyncWeight: 1, physicsActive: true },
});

beforeEach(() => {
  services = createFakeServices();
  services.store.load(project());
  actions = createHotkeyActions();
  actions.setContext(context());
  events = [];
  sessionActive = true;
  notices = [];
  expressionMode = 'stack';
});

describe('表情', () => {
  it('toggle は押すたびに適用と解除', () => {
    const smile = hk('expression', 'smile');
    press(smile);
    expect(services.expressions.active()).toBe('smile');
    press(smile);
    expect(services.expressions.active()).toBeNull();
  });

  it('stack の toggle はカードと同じく重ね、対象だけ解除する', () => {
    services.expressions.apply('angry', 0);
    press(hk('expression', 'smile'));
    expect(services.expressions.active()).toBe('smile');
    expect(services.expressions.actives()).toEqual(['angry', 'smile']);
    press(hk('expression', 'smile'));
    expect(services.expressions.actives()).toEqual(['angry']);
  });

  it('hold は押している間だけ適用し、離すと前の表情に戻す', () => {
    services.expressions.apply('angry', 0);
    const smile = hk('expression', 'smile', 'hold');
    actions.handle(smile, 'down');
    expect(services.expressions.active()).toBe('smile');
    actions.handle(smile, 'up');
    expect(services.expressions.active()).toBe('angry');
  });

  it('対象が null（解除）の hold は押している間だけ表情を外す', () => {
    services.expressions.apply('smile', 0);
    const clear = hk('expression', null, 'hold');
    actions.handle(clear, 'down');
    expect(services.expressions.active()).toBeNull();
    actions.handle(clear, 'up');
    expect(services.expressions.active()).toBe('smile');
  });

  it('toggle には now の時刻を渡す', () => {
    const apply = vi.spyOn(services.expressions, 'toggle');
    press(hk('expression', 'smile'));
    expect(apply).toHaveBeenCalledWith('smile', 1000);
  });

  it('single は対象だけに切り替え、同じ表情なら解除する', () => {
    expressionMode = 'single';
    services.expressions.toggle('angry', 0);
    press(hk('expression', 'smile'));
    expect(services.expressions.actives()).toEqual(['smile']);
    press(hk('expression', 'smile'));
    expect(services.expressions.actives()).toEqual([]);
  });

  it('同じ表情を2つのholdで持つ。どちらから離しても残る持ち主を保つ', () => {
    services.expressions.toggle('angry', 0);
    const a = hk('expression', 'smile', 'hold', 'a');
    const b = hk('expression', 'smile', 'hold', 'b');
    actions.handle(a, 'down');
    actions.handle(b, 'down');
    actions.handle(a, 'up');
    expect(services.expressions.actives()).toEqual(['angry', 'smile']);
    actions.handle(b, 'up');
    expect(services.expressions.actives()).toEqual(['angry']);
  });

  it('hold中のカードの変更を残す。全解除・シーンのapplyから古い表情を復元しない', () => {
    services.expressions.toggle('angry', 0);
    const held = hk('expression', 'smile', 'hold');
    actions.handle(held, 'down');
    services.expressions.toggle('custom', 0);
    actions.handle(held, 'up');
    expect(services.expressions.actives()).toEqual(['angry', 'custom']);
    actions.handle(held, 'down');
    press(hk('expression', null));
    actions.handle(held, 'up');
    expect(services.expressions.actives()).toEqual([]);
    actions.handle(held, 'down');
    services.expressions.apply('angry', 0);
    actions.handle(held, 'up');
    expect(services.expressions.actives()).toEqual(['angry']);
  });

  it('割り当て削除とコンテキスト解除は、自分のholdだけを解除する', () => {
    const held = hk('expression', 'smile', 'hold');
    services.expressions.toggle('angry', 0);
    actions.handle(held, 'down');
    actions.retain([]);
    expect(services.expressions.actives()).toEqual(['angry']);
    actions.handle(held, 'down');
    actions.setContext(null);
    expect(services.expressions.actives()).toEqual(['angry']);
  });
});

describe('シーン', () => {
  const active = () => services.store.get().studio.activeSceneId;

  it('toggle は対象のシーンへ切り替え（コマンド）、もう一度で前のシーンに戻す', () => {
    const game = hk('scene', 'scene-2');
    press(game);
    expect(active()).toBe('scene-2');
    expect(services.store.canUndo()).toBe(true);
    press(game);
    expect(active()).toBe('scene-1');
  });

  it('hold は押している間だけ切り替える', () => {
    const game = hk('scene', 'scene-2', 'hold');
    actions.handle(game, 'down');
    expect(active()).toBe('scene-2');
    actions.handle(game, 'up');
    expect(active()).toBe('scene-1');
  });

  it('無いシーンは何もしない', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    press(hk('scene', 'nothing'));
    expect(active()).toBe('scene-1');
    expect(services.store.canUndo()).toBe(false);
    warn.mockRestore();
  });
});

describe('背景', () => {
  const bg = () => sceneBackground(services.store.get());

  it('toggle は背景を変え（コマンド）、もう一度で前の背景に戻す', () => {
    const green = hk('background', 'color:#00ff00');
    press(green);
    expect(bg()).toEqual({ type: 'color', color: '#00ff00' });
    press(green);
    expect(bg()).toEqual({ type: 'transparent' });
  });

  it('hold は押している間だけ背景を変える。画像も選べる', () => {
    const image = hk('background', 'image:backgrounds/room.png', 'hold');
    actions.handle(image, 'down');
    expect(bg()).toEqual({ type: 'image', path: 'backgrounds/room.png' });
    actions.handle(image, 'up');
    expect(bg()).toEqual({ type: 'transparent' });
  });
});

describe('パラメータ', () => {
  it('toggle で max にする値を producer（id expression・override）が出し、もう一度で消す', () => {
    const tears = hk('parameter', 'Tears');
    expect(actions.producer.id).toBe('expression');
    expect(actions.producer.produce(frame(services.store.get()))).toBeNull();
    press(tears);
    expect(actions.producer.produce(frame(services.store.get()))).toEqual({
      id: 'expression',
      weight: 1,
      values: { Tears: 1 },
      blend: { Tears: 'override' },
    });
    expect(actions.activeParameterIds()).toEqual(['Tears']);
    press(tears);
    expect(actions.producer.produce(frame(services.store.get()))).toBeNull();
  });

  it('hold は押している間だけ max（標準パラメータも使える）', () => {
    const mouth = hk('parameter', 'MouthOpen', 'hold');
    actions.handle(mouth, 'down');
    const max = services.store.get().model.parameters.find((p) => p.id === 'MouthOpen')!.max;
    expect(actions.producer.produce(frame(services.store.get()))?.values).toEqual({ MouthOpen: max });
    actions.handle(mouth, 'up');
    expect(actions.producer.produce(frame(services.store.get()))).toBeNull();
  });

  it('プロジェクトに無いパラメータは出さない', () => {
    press(hk('parameter', 'Nothing'));
    expect(actions.producer.produce(frame(services.store.get()))).toBeNull();
  });

  it('割り当てが消えたら、max にしていた値も消す', () => {
    const tears = hk('parameter', 'Tears');
    press(tears);
    actions.retain([tears]);
    expect(actions.activeParameterIds()).toEqual(['Tears']);
    actions.retain([{ ...tears, mode: 'hold' }]); // 中身が変わった
    expect(actions.activeParameterIds()).toEqual([]);
  });
});

describe('トラッキングの一時停止', () => {
  it('toggle は services.tracking を止め、もう一度で同じカメラで再開する', async () => {
    const stop = vi.spyOn(services.tracking, 'stop');
    const start = vi.spyOn(services.tracking, 'start');
    const pause = hk('pauseTracking', null);
    press(pause);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(actions.trackingPaused()).toBe(true);
    press(pause);
    expect(start).toHaveBeenCalledWith('cam-2');
    expect(actions.trackingPaused()).toBe(false);
    services.tracking.stop();
  });

  it('hold は押している間だけ止める', () => {
    const stop = vi.spyOn(services.tracking, 'stop');
    const start = vi.spyOn(services.tracking, 'start');
    const pause = hk('pauseTracking', null, 'hold');
    actions.handle(pause, 'down');
    expect(stop).toHaveBeenCalledTimes(1);
    actions.handle(pause, 'up');
    expect(start).toHaveBeenCalledTimes(1);
    services.tracking.stop();
  });

  it('トラッキングを開始していなければ何もしない', () => {
    sessionActive = false;
    const stop = vi.spyOn(services.tracking, 'stop');
    press(hk('pauseTracking', null));
    expect(stop).not.toHaveBeenCalled();
    expect(actions.trackingPaused()).toBe(false);
  });

  it('止めている間に画面でトラッキングを停止したら、一時停止の印を消す', () => {
    const start = vi.spyOn(services.tracking, 'start');
    const pause = hk('pauseTracking', null);
    press(pause);
    sessionActive = false;
    actions.trackingSessionEnded();
    expect(actions.trackingPaused()).toBe(false);
    sessionActive = true;
    press(pause); // 次に押すと止める（再開ではない）
    expect(start).not.toHaveBeenCalled();
    expect(actions.trackingPaused()).toBe(true);
  });

  it('再開できなければ知らせる', async () => {
    services.tracking.start = () => Promise.reject(new Error('カメラが無い'));
    const pause = hk('pauseTracking', null);
    press(pause);
    press(pause);
    await Promise.resolve();
    await Promise.resolve();
    expect(notices).toEqual(['トラッキングを再開できない: カメラが無い']);
  });
});

describe('キャリブレーション・アニメーション', () => {
  it('recalibrate は押したときにアプリイベント recalibrate を出す', () => {
    press(hk('recalibrate', null));
    expect(events).toEqual([{ name: 'recalibrate', payload: undefined }]);
  });

  it('animation は hotkey:animation（targetId と phase）を出す。toggle は押したときだけ、hold は離したときも', () => {
    press(hk('animation', 'wave', 'toggle'));
    press(hk('animation', 'wave', 'hold'));
    expect(events).toEqual([
      { name: 'hotkey:animation', payload: { targetId: 'wave', phase: 'down', mode: 'toggle' } },
      { name: 'hotkey:animation', payload: { targetId: 'wave', phase: 'down', mode: 'hold' } },
      { name: 'hotkey:animation', payload: { targetId: 'wave', phase: 'up', mode: 'hold' } },
    ]);
  });
});

it('つないでいない（context が無い）ときは何もしない', () => {
  actions.setContext(null);
  press(hk('expression', 'smile'));
  expect(services.expressions.active()).toBeNull();
});
