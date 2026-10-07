// カード68（ホットキーのパラメータの上書きを専用の hotkey の層へ）のテスト。テストの担当は CL（実装の担当は CO）
// カード68 の実装待ち: 実装をコミットしたら、実装の担当が describe.skip を describe に戻す（このファイルで触ってよいのはその行だけ）
import { describe, expect, it } from 'vitest';
import type { Hotkey } from '@app/schema';
import type { Layer, LayerProducer } from '@app/contracts';
import { createAutoBlink, createParameterMixer } from '@app/core';
import { createFakeServices } from '../services';
import { createStudioRuntime } from '../modes/studio/runtime';
import { createHotkeyActions } from './actions';

// 口 開閉（0〜1）を最大にするホットキー
const mouthMax: Hotkey = { id: 'h-mouth', keys: 'Ctrl+1', action: 'parameter', targetId: 'MouthOpen', mode: 'toggle' };

const fixed = (id: 'expression' | 'animation', value: number): LayerProducer => ({
  id,
  produce: (): Layer => ({ id, weight: 1, values: { MouthOpen: value }, blend: { MouthOpen: 'override' } }),
});

type Name = 'expression' | 'hotkey' | 'animation';

function setup(order: Name[]) {
  const services = createFakeServices();
  services.mixer = createParameterMixer();
  services.autoBlink = createAutoBlink(() => 0);
  const runtime = createStudioRuntime({ scheduler: { request: () => () => {} } });
  const actions = createHotkeyActions();
  actions.setContext({
    services,
    now: () => 0,
    emit() {},
    trackingSessionActive: () => false,
    cameraDeviceId: () => null,
    expressionMode: () => 'stack',
    notify() {},
  });
  const producers: Record<Name, LayerProducer> = {
    expression: fixed('expression', 0.2),
    hotkey: actions.producer,
    animation: fixed('animation', 0.5),
  };
  // 登録の順を変えて確かめる
  const offs = order.map((name) => runtime.registerLayerProducer(producers[name]));
  const detach = runtime.attach(services);
  return {
    actions,
    runtime,
    dispose() {
      detach();
      for (const off of offs) off();
    },
  };
}

function permutations<T>(list: T[]): T[][] {
  if (list.length <= 1) return [list];
  return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [x, ...rest]));
}

describe('カード68: ホットキーのパラメータの上書きは hotkey の層（表情の後・アニメーションの前）', () => {
  it('ホットキーの producer の id は hotkey', () => {
    expect(createHotkeyActions().producer.id).toBe('hotkey');
  });

  it.each(permutations<Name>(['expression', 'hotkey']))(
    '表情とホットキー（登録の順 %s → %s）: 最後の値はホットキーの値',
    (...order) => {
      const { actions, runtime, dispose } = setup(order);
      try {
        expect(runtime.tick(0)!.params.MouthOpen).toBeCloseTo(0.2, 9);
        actions.handle(mouthMax, 'down');
        const frame = runtime.tick(16)!;
        expect(frame.params.MouthOpen).toBeCloseTo(1, 9);
        // 層ごとの値でも、表情の層とホットキーの層が分かれて読める
        expect(frame.layers.find((l) => l.id === 'hotkey')?.values).toMatchObject({ MouthOpen: 1 });
        expect(frame.layers.filter((l) => l.id === 'expression').map((l) => l.values.MouthOpen)).toEqual([0.2]);
        // もう一度押すと上書きをやめ、表情の値に戻る
        actions.handle(mouthMax, 'down');
        expect(runtime.tick(32)!.params.MouthOpen).toBeCloseTo(0.2, 9);
      } finally {
        dispose();
      }
    },
  );

  it.each(permutations<Name>(['expression', 'hotkey', 'animation']))(
    '表情・ホットキー・アニメーション（登録の順 %s → %s → %s）: 最後の値はアニメーションの値、層は表情 → ホットキー → アニメーションの順',
    (...order) => {
      const { actions, runtime, dispose } = setup(order);
      try {
        actions.handle(mouthMax, 'down');
        const frame = runtime.tick(16)!;
        expect(frame.params.MouthOpen).toBeCloseTo(0.5, 9);
        const ids = frame.layers.map((l) => l.id);
        expect(ids.indexOf('expression')).toBeGreaterThanOrEqual(0);
        expect(ids.indexOf('hotkey')).toBeGreaterThan(ids.indexOf('expression'));
        expect(ids.indexOf('animation')).toBeGreaterThan(ids.indexOf('hotkey'));
      } finally {
        dispose();
      }
    },
  );

  it('押している間（hold）は、離すと表情の値に戻る', () => {
    const { actions, runtime, dispose } = setup(['hotkey', 'expression']);
    try {
      const hold: Hotkey = { ...mouthMax, id: 'h-hold', mode: 'hold' };
      actions.handle(hold, 'down');
      expect(runtime.tick(0)!.params.MouthOpen).toBeCloseTo(1, 9);
      actions.handle(hold, 'up');
      expect(runtime.tick(16)!.params.MouthOpen).toBeCloseTo(0.2, 9);
    } finally {
      dispose();
    }
  });
});
