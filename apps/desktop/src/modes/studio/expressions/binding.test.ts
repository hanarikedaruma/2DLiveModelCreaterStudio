import { describe, expect, it, vi } from 'vitest';
import { createEmptyProject, ensureStandardParameters, type Expression, type Hotkey, type Project } from '@app/schema';
import { FakeExpressions, type FrameContext, type Services } from '@app/contracts';
import { createExpressionController, createParameterMixer } from '@app/core';
import { createFakeServices } from '../../../services';
import { createHotkeyActions } from '../../../hotkeys/actions';
import { createStudioRuntime } from '../runtime';
import { createExpressionBinding, memoryCardModeStorage } from './binding';

const smile: Expression = {
  id: 'smile',
  name: '笑顔',
  entries: [
    { parameterId: 'MouthForm', value: 0.8, blend: 'override' },
    { parameterId: 'EyeOpenL', value: 0.5, blend: 'multiply' },
  ],
  fadeIn: 0.2,
  fadeOut: 0.4,
};
const angry: Expression = {
  id: 'angry',
  name: '怒り',
  entries: [{ parameterId: 'BrowFormL', value: 1, blend: 'add' }],
  fadeIn: 0,
  fadeOut: 0,
};
const blush: Expression = {
  id: 'blush',
  name: '照れ',
  entries: [
    { parameterId: 'MouthForm', value: 0.3, blend: 'override' },
    { parameterId: 'Cheek', value: 1, blend: 'override' },
  ],
  fadeIn: 0.2,
  fadeOut: 0.2,
};

function step1Project(): Project {
  const p = createEmptyProject('テスト');
  return { ...p, model: ensureStandardParameters(p.model, 'step1'), expressions: [smile, angry, blush] };
}

function ctx(project: Project, now = 0): FrameContext {
  return { now, dt: 16, project, mixedSoFar: {}, flags: { lipSyncWeight: 1, physicsActive: true } };
}

const memory = (mode: string | null = null) => createExpressionBinding(memoryCardModeStorage(mode));

describe('createExpressionBinding', () => {
  it('つないでいなければ何も出さず、押しても何もしない', () => {
    const binding = memory();
    expect(binding.producer.id).toBe('expression');
    expect(binding.producer.produce(ctx(step1Project()))).toBeNull();
    binding.toggle('smile', 0);
    expect(binding.actives()).toEqual([]);
    expect(binding.bound()).toBeNull();
  });

  it('通常（重ねる）は、押すたびに重ねる・外す。適用した順を知らせる', () => {
    const binding = memory();
    expect(binding.mode()).toBe('stack');
    const expressions = new FakeExpressions();
    const toggle = vi.spyOn(expressions, 'toggle');
    const apply = vi.spyOn(expressions, 'apply');
    binding.bind(expressions);
    const listener = vi.fn();
    binding.subscribe(listener);

    binding.toggle('smile', 100);
    expect(toggle).toHaveBeenLastCalledWith('smile', 100);
    expect(binding.actives()).toEqual(['smile']);
    binding.toggle('angry', 200);
    expect(binding.actives()).toEqual(['smile', 'angry']);
    binding.toggle('smile', 300);
    expect(toggle).toHaveBeenLastCalledWith('smile', 300);
    expect(binding.actives()).toEqual(['angry']);
    binding.toggle('angry', 400);
    expect(binding.actives()).toEqual([]);
    expect(apply).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('「1つずつ切り替え」は、押した表情だけにし、それだけを適用中ならもう一度で解除する（STEP1 と同じ）', () => {
    const binding = memory('single');
    expect(binding.mode()).toBe('single');
    const expressions = new FakeExpressions();
    const apply = vi.spyOn(expressions, 'apply');
    binding.bind(expressions);

    binding.toggle('smile', 100);
    expect(apply).toHaveBeenLastCalledWith('smile', 100);
    expect(binding.actives()).toEqual(['smile']);
    binding.toggle('angry', 200);
    expect(apply).toHaveBeenLastCalledWith('angry', 200);
    expect(binding.actives()).toEqual(['angry']);
    binding.toggle('angry', 300);
    expect(apply).toHaveBeenLastCalledWith(null, 300);
    expect(binding.actives()).toEqual([]);
    // 重なっているところで押すと、押した表情だけにする
    expressions.toggle('smile', 0);
    expressions.toggle('angry', 0);
    binding.toggle('angry', 400);
    expect(apply).toHaveBeenLastCalledWith('angry', 400);
    expect(binding.actives()).toEqual(['angry']);
  });

  it('押し方を変えると保存して知らせ、次に作ったときも使う（適用中の表情は変えない）', () => {
    const storage = memoryCardModeStorage();
    const binding = createExpressionBinding(storage);
    const expressions = new FakeExpressions();
    binding.bind(expressions);
    binding.toggle('smile', 0);
    binding.toggle('angry', 0);
    const listener = vi.fn();
    binding.subscribe(listener);
    binding.setMode('single');
    expect(binding.mode()).toBe('single');
    expect(storage.value).toBe('single');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(expressions.actives()).toEqual(['smile', 'angry']);
    binding.setMode('single'); // 同じなら何もしない
    expect(listener).toHaveBeenCalledTimes(1);
    expect(createExpressionBinding(storage).mode()).toBe('single');
    binding.setMode('stack');
    expect(storage.value).toBe('stack');
    // 読めない値は通常（重ねる）
    expect(memory('other').mode()).toBe('stack');
  });

  it('実行中のモードは個別 localStorage へ保存しない', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    createExpressionBinding().setMode('single');
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('ほかから services.expressions を直接切り替えたら（ホットキー・シーン）、次のフレームで知らせる', () => {
    const binding = memory();
    const expressions = new FakeExpressions();
    binding.bind(expressions);
    const listener = vi.fn();
    binding.subscribe(listener);
    expressions.apply('angry', 0);
    expect(binding.actives()).toEqual([]);
    expect(binding.producer.produce(ctx(step1Project()))).toMatchObject({ values: { BrowFormL: 1 } });
    expect(binding.actives()).toEqual(['angry']);
    expect(listener).toHaveBeenCalledTimes(1);
    // 変わらなければ知らせず、同じ配列を返す（画面の useSyncExternalStore のため）
    const before = binding.actives();
    binding.producer.produce(ctx(step1Project()));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(binding.actives()).toBe(before);
  });

  it('つなぎ直すと、新しいものの適用中の表情に合わせる', () => {
    const binding = memory();
    const first = new FakeExpressions();
    binding.bind(first);
    binding.toggle('smile', 0);
    const second = new FakeExpressions();
    binding.bind(second);
    expect(binding.bound()).toBe(second);
    expect(binding.actives()).toEqual([]);
    binding.toggle('smile', 0);
    expect(second.actives()).toEqual(['smile']);
    expect(first.actives()).toEqual(['smile']);
  });
});

describe('スタジオの実行部での表情（本物の ExpressionController をつないだとき）', () => {
  function setup(mode: 'stack' | 'single' = 'stack') {
    const runtime = createStudioRuntime({ scheduler: { request: () => () => {} } });
    const services: Services = {
      ...createFakeServices(),
      mixer: createParameterMixer(),
      expressions: createExpressionController(), // アプリの services.expressions と同じ本物
    };
    services.store.load(step1Project());
    const binding = memory(mode);
    runtime.registerLayerProducer(binding.producer);
    binding.bind(services.expressions);
    runtime.attach(services);
    return { runtime, services, binding };
  }

  it('押した表情にフェードしながら切り替わる（0・半分・終わり）。もう一度押すとフェードして外れる', () => {
    const { runtime, binding } = setup();
    expect(runtime.tick(0)!.params).toMatchObject({ MouthForm: 0, EyeOpenL: 1 });
    binding.toggle('smile', 1000);
    expect(runtime.tick(1000)!.params).toMatchObject({ MouthForm: 0, EyeOpenL: 1 });
    const half = runtime.tick(1100)!.params;
    expect(half.MouthForm).toBeCloseTo(0.4, 10);
    expect(half.EyeOpenL).toBeCloseTo(0.75, 10);
    expect(runtime.tick(1200)!.params).toMatchObject({ MouthForm: 0.8, EyeOpenL: 0.5 });

    binding.toggle('smile', 2000); // 解除（fadeOut 0.4 秒）
    expect(binding.actives()).toEqual([]);
    const out = runtime.tick(2200)!.params;
    expect(out.MouthForm).toBeCloseTo(0.4, 10);
    expect(out.EyeOpenL).toBeCloseTo(0.75, 10);
    expect(runtime.tick(2400)!.params).toMatchObject({ MouthForm: 0, EyeOpenL: 1 });
  });

  it('別の表情を押すと重なり、override は後から押した表情になる。片方だけ外すとその表情だけがフェードで消える', () => {
    const { runtime, binding } = setup();
    binding.toggle('smile', 0);
    runtime.tick(0);
    binding.toggle('blush', 500);
    runtime.tick(500);
    // 照れ（fadeIn 0.2 秒）の半分: 口の形は笑顔 0.8 と照れ 0.3 の間
    const mid = runtime.tick(600)!.params;
    expect(mid.MouthForm).toBeCloseTo(0.55, 10);
    expect(mid.Cheek).toBeCloseTo(0.5, 10);
    const both = runtime.tick(700)!.params;
    expect(both.MouthForm).toBeCloseTo(0.3, 10);
    expect(both).toMatchObject({ Cheek: 1, EyeOpenL: 0.5 });
    expect(binding.actives()).toEqual(['smile', 'blush']);

    binding.toggle('smile', 1000); // 笑顔だけ外す（fadeOut 0.4 秒）
    expect(binding.actives()).toEqual(['blush']);
    const fading = runtime.tick(1200)!.params;
    expect(fading.MouthForm).toBeCloseTo(0.3, 10);
    expect(fading.Cheek).toBe(1);
    expect(fading.EyeOpenL).toBeCloseTo(0.75, 10);
    expect(runtime.tick(1400)!.params).toMatchObject({ MouthForm: 0.3, Cheek: 1, EyeOpenL: 1 });
  });

  it('「1つずつ切り替え」では、前の表情はフェードアウトし新しい表情はフェードインする', () => {
    const { runtime, binding } = setup('single');
    binding.toggle('smile', 0);
    runtime.tick(0);
    runtime.tick(500);
    binding.toggle('angry', 1000); // 怒りは fadeIn 0、笑顔は fadeOut 0.4 秒
    expect(binding.actives()).toEqual(['angry']);
    const mid = runtime.tick(1200)!.params;
    expect(mid.BrowFormL).toBe(1);
    expect(mid.MouthForm).toBeCloseTo(0.4, 10);
    const end = runtime.tick(1400)!.params;
    expect(end).toMatchObject({ BrowFormL: 1, MouthForm: 0, EyeOpenL: 1 });
  });

  it('ホットキーのパラメータ（後に登録した producer）は表情より後に効く', () => {
    const { runtime, binding, services } = setup();
    const actions = createHotkeyActions();
    runtime.registerLayerProducer(actions.producer);
    actions.setContext({
      services,
      now: () => 0,
      emit: () => {},
      trackingSessionActive: () => false,
      cameraDeviceId: () => null,
      expressionMode: () => 'stack',
      notify: () => {},
    });
    binding.toggle('smile', 0);
    binding.toggle('blush', 0);
    runtime.tick(0);
    expect(runtime.tick(1000)!.params.MouthForm).toBeCloseTo(0.3, 10);
    const hotkey: Hotkey = { id: 'h', keys: 'F2', action: 'parameter', targetId: 'MouthForm', mode: 'hold' };
    actions.handle(hotkey, 'down');
    expect(runtime.tick(1016)!.params.MouthForm).toBe(1);
    actions.handle(hotkey, 'up');
    expect(runtime.tick(1032)!.params.MouthForm).toBeCloseTo(0.3, 10);
  });
});
