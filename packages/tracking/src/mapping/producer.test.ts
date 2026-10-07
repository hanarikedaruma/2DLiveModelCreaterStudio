import type { TrackingFrame } from '@app/contracts';
import { STANDARD_PARAMETERS, type TrackingMapping, type TrackingSetup, standardParametersFor } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { createDefaultTrackingMappings } from './defaults';
import { createTrackingLayerProducer } from './producer';

const FRAME = 1000 / 30;
const MVP = standardParametersFor('mvp');

function frame(time: number, patch: Partial<TrackingFrame> = {}): TrackingFrame {
  return {
    time,
    detected: true,
    faceYaw: 0,
    facePitch: 0,
    faceRoll: 0,
    eyeOpenL: 1,
    eyeOpenR: 1,
    eyeBallX: 0,
    eyeBallY: 0,
    mouthOpen: 0,
    ...patch,
  };
}

// ユーザーが右を向き・上を向き・右へ傾け、右目を細め、右を見て、口を開けたフレーム
const POSE = frame(0, {
  faceYaw: 20,
  facePitch: 8,
  faceRoll: 10,
  eyeOpenL: 0.9,
  eyeOpenR: 0.2,
  eyeBallX: 0.5,
  eyeBallY: -0.25,
  mouthOpen: 0.6,
});

describe('createTrackingLayerProducer', () => {
  it("tick は id 'tracking'・blend なしのレイヤーを返す", () => {
    const p = createTrackingLayerProducer(MVP);
    p.update(POSE);
    const layer = p.tick(0);
    expect(layer.id).toBe('tracking');
    expect(layer.blend).toBeUndefined();
  });

  it('空の一覧なら何も動かさない（I-042。「無効」と、何も割り当てていないカスタム）', () => {
    const p = createTrackingLayerProducer(MVP, []);
    p.update(POSE);
    expect(p.tick(0).values).toEqual({});
  });

  it('mappings が無ければ既定のマッピング（ミラーのオン: yaw・roll・eyeBallX はそのまま、目は入れ替え）', () => {
    for (const mappings of [undefined]) {
      const p = createTrackingLayerProducer(MVP, mappings);
      p.update(POSE);
      const v = p.tick(0).values;
      expect(Object.keys(v).sort()).toEqual(
        ['EyeBallX', 'EyeBallY', 'EyeOpenL', 'EyeOpenR', 'FaceAngleX', 'FaceAngleY', 'FaceAngleZ', 'MouthOpen'].sort(),
      );
      expect(v.FaceAngleX).toBeCloseTo(20, 9);
      expect(v.FaceAngleY).toBeCloseTo(8, 9);
      expect(v.FaceAngleZ).toBeCloseTo(10, 9);
      expect(v.EyeOpenL).toBeCloseTo(0.2, 9); // ユーザーの右目
      expect(v.EyeOpenR).toBeCloseTo(0.9, 9);
      expect(v.EyeBallX).toBeCloseTo(0.5, 9);
      expect(v.EyeBallY).toBeCloseTo(-0.25, 9);
      expect(v.MouthOpen).toBeCloseTo(0.6, 9);
    }
  });

  it('ミラーのオフ: yaw・roll・eyeBallX の符号を反転し、目は入れ替えない', () => {
    const p = createTrackingLayerProducer(MVP);
    p.setMirror(false);
    p.update(POSE);
    const v = p.tick(0).values;
    expect(v.FaceAngleX).toBeCloseTo(-20, 9);
    expect(v.FaceAngleY).toBeCloseTo(8, 9);
    expect(v.FaceAngleZ).toBeCloseTo(-10, 9);
    expect(v.EyeOpenL).toBeCloseTo(0.9, 9);
    expect(v.EyeOpenR).toBeCloseTo(0.2, 9);
    expect(v.EyeBallX).toBeCloseTo(-0.5, 9);
  });

  it('ミラーを切り替えると、次のフレームを待たずに値が切り替わる', () => {
    const p = createTrackingLayerProducer(MVP);
    p.update(POSE);
    p.setMirror(false);
    expect(p.tick(0).values.FaceAngleX).toBeCloseTo(-20, 9);
    p.setMirror(true);
    expect(p.tick(0).values.FaceAngleX).toBeCloseTo(20, 9);
  });

  it('マッピングの写像（invert・deadZone・丸め）を使い、パラメータの範囲で丸める', () => {
    const mappings: TrackingMapping[] = [
      { ...createDefaultTrackingMappings()[0]!, invert: true }, // faceYaw → FaceAngleX
      { ...createDefaultTrackingMappings()[1]!, deadZone: 10 }, // facePitch → FaceAngleY
      { ...createDefaultTrackingMappings()[7]!, outputRange: [0, 2] }, // mouthOpen → MouthOpen（0..1 で丸める）
    ];
    const p = createTrackingLayerProducer(MVP, mappings);
    p.update(frame(0, { faceYaw: 45, facePitch: 8, mouthOpen: 0.75 }));
    expect(p.tick(0).values).toEqual({ FaceAngleX: -30, FaceAngleY: 0, MouthOpen: 1 });
  });

  it('parameters に無いパラメータと、推定に無い入力のマッピングは使わない', () => {
    const mappings: TrackingMapping[] = [
      { ...createDefaultTrackingMappings()[0]!, parameterId: 'NoSuchParameter' },
      { ...createDefaultTrackingMappings()[7]!, input: 'mouthForm', parameterId: 'MouthForm' },
      createDefaultTrackingMappings()[7]!,
    ];
    const p = createTrackingLayerProducer(STANDARD_PARAMETERS, mappings);
    p.update(frame(0, { mouthOpen: 0.5 }));
    expect(p.tick(0).values).toEqual({ MouthOpen: 0.5 });
  });

  describe('スムージング（既定: minCutoff 1.0・beta 0.02・dCutoff 1.0）', () => {
    // 30fps で k0 番目のフレームから段差を入れ、段差から 150ms 以内の最後のフレームでの値
    function after150ms(patchFrom: Partial<TrackingFrame>, patchTo: Partial<TrackingFrame>, key: string): number {
      const p = createTrackingLayerProducer(MVP);
      const k0 = 10;
      const k1 = k0 + Math.floor(150 / FRAME);
      for (let k = 0; k <= k1; k++) p.update(frame(k * FRAME, k < k0 ? patchFrom : patchTo));
      return p.tick(k1 * FRAME).values[key]!;
    }

    it('段差の入力に対し、30fps で 150ms 以内に 90% へ届く（顔の角度 0 → 30）', () => {
      expect(after150ms({ faceYaw: 0 }, { faceYaw: 30 }, 'FaceAngleX')).toBeGreaterThanOrEqual(27);
      expect(after150ms({ facePitch: 0 }, { facePitch: -30 }, 'FaceAngleY')).toBeLessThanOrEqual(-27);
    });

    it('目と口も同じように追う（目を閉じる 1 → 0、口を開ける 0 → 1）', () => {
      // ミラーのオンでは、ユーザーの右目が EyeOpenL
      expect(after150ms({ eyeOpenR: 1 }, { eyeOpenR: 0 }, 'EyeOpenL')).toBeLessThanOrEqual(0.1);
      expect(after150ms({ eyeOpenL: 1 }, { eyeOpenL: 0 }, 'EyeOpenR')).toBeLessThanOrEqual(0.1);
      expect(after150ms({ mouthOpen: 0 }, { mouthOpen: 1 }, 'MouthOpen')).toBeGreaterThanOrEqual(0.9);
      expect(after150ms({ eyeBallX: -1 }, { eyeBallX: 1 }, 'EyeBallX')).toBeGreaterThanOrEqual(0.8);
    });

    it('smoothing が大きいほど遅れる', () => {
      const run = (smoothing: number): number => {
        const p = createTrackingLayerProducer(MVP, [{ ...createDefaultTrackingMappings()[0]!, smoothing }]);
        for (let k = 0; k < 4; k++) p.update(frame(k * FRAME, { faceYaw: k === 0 ? 0 : 5 }));
        return p.tick(3 * FRAME).values.FaceAngleX!;
      };
      expect(run(0)).toBeGreaterThan(run(0.5));
      expect(run(0.5)).toBeGreaterThan(run(1));
    });
  });

  describe('外れたとき', () => {
    function trackedUntil(t1: number, behavior?: 'returnToFront' | 'hold') {
      const p = createTrackingLayerProducer(MVP);
      if (behavior) p.setLostBehavior(behavior);
      for (let t = 0; t <= t1; t += FRAME) p.update(frame(t, { faceYaw: 20, mouthOpen: 0.5 }));
      p.update(frame(t1, { faceYaw: 20, mouthOpen: 0.5 }));
      return p;
    }

    it('最後に detected だった時刻から 0.5秒で 1、1.0秒で 0.5、1.5秒で 0。値は最後の値のまま', () => {
      const p = trackedUntil(2000);
      const held = p.tick(2000).values;
      for (let t = 2000 + FRAME; t <= 3600; t += FRAME) p.update(frame(t, { detected: false, faceYaw: -30 }));
      expect(p.tick(2500).weight).toBe(1);
      expect(p.tick(3000).weight).toBeCloseTo(0.5, 9);
      expect(p.tick(3500).weight).toBe(0);
      // 目は外れたときに出さない（自動の層がまばたきにする。STEP3 のカード66）。ほかは最後の値のまま
      const { EyeOpenL: _l, EyeOpenR: _r, ...face } = held;
      expect(p.tick(3500).values).toEqual(face);
      expect(held.FaceAngleX).toBeCloseTo(20, 6);
    });

    it('再び detected になったら 0.3秒で 1 に戻す', () => {
      const p = trackedUntil(2000);
      for (let t = 2000 + FRAME; t < 4000; t += FRAME) p.update(frame(t, { detected: false }));
      expect(p.tick(4000).weight).toBe(0);
      p.update(frame(4000, { faceYaw: 10 }));
      expect(p.tick(4000).weight).toBe(0);
      expect(p.tick(4150).weight).toBeCloseTo(0.5, 9);
      for (let t = 4000 + FRAME; t <= 4300; t += FRAME) p.update(frame(t, { faceYaw: 10 }));
      expect(p.tick(4300).weight).toBe(1);
    });

    it('フレームが来なくなったとき（カメラを止めたなど）も同じ時間で戻す', () => {
      const p = trackedUntil(2000);
      expect(p.tick(3000).weight).toBeCloseTo(0.5, 9);
      expect(p.tick(3500).weight).toBe(0);
    });

    it("'hold' のときは weight が 1 のまま", () => {
      const p = trackedUntil(2000, 'hold');
      for (let t = 2000 + FRAME; t < 5000; t += FRAME) p.update(frame(t, { detected: false }));
      for (const t of [2500, 3000, 3500, 5000]) expect(p.tick(t).weight).toBe(1);
      expect(p.tick(5000).values.FaceAngleX).toBeCloseTo(20, 6);
      p.setLostBehavior('returnToFront');
      expect(p.tick(5000).weight).toBe(0);
    });

    it('まだ一度も検出していなければ weight は0で何も出さない・lost（目は自動の層が出す。STEP3 のカード66）', () => {
      const p = createTrackingLayerProducer(MVP);
      expect(p.tick(0)).toEqual({ id: 'tracking', weight: 0, values: {} });
      expect(p.status()).toBe('lost');
    });

    it("status は検出中なら 'tracking'、detected false のフレームか 0.5秒より長くフレームが無ければ 'lost'", () => {
      const p = trackedUntil(1000);
      p.tick(1010);
      expect(p.status()).toBe('tracking');
      p.update(frame(1033, { detected: false }));
      expect(p.status()).toBe('lost');
      p.update(frame(1066));
      expect(p.status()).toBe('tracking');
      p.tick(1500);
      expect(p.status()).toBe('tracking');
      p.tick(1600);
      expect(p.status()).toBe('lost');
    });
  });
});

describe('同じパラメータへの複数の割り当て（I-042）', () => {
  // 顔の左右（faceYaw）と視線の左右（eyeBallX）の両方で、ユーザー定義の「しっぽ」（−10..10）を動かす
  const TAIL = {
    id: 'Tail',
    name: 'しっぽ',
    groupId: 'other' as const,
    min: -10,
    max: 10,
    default: 0,
    standard: false,
  };
  const yaw = {
    ...createDefaultTrackingMappings()[0]!,
    parameterId: 'Tail',
    outputRange: [-10, 10] as [number, number],
  };
  const eyes = {
    ...createDefaultTrackingMappings()[5]!,
    parameterId: 'Tail',
    outputRange: [-10, 10] as [number, number],
    weight: 3,
  };
  // faceYaw 15（−30..30 の 3/4 → 5）、eyeBallX 0.5（−1..1 の 3/4 → 5）。ならしが落ち着くまで同じフレームを送る
  const settled = (mappings: TrackingMapping[], combine: TrackingSetup['combine'], patch = {}) => {
    const p = createTrackingLayerProducer([...MVP, TAIL], mappings, { combine });
    for (let t = 0; t < 3000; t += FRAME) p.update(frame(t, { faceYaw: 15, eyeBallX: 0.5, ...patch }));
    return p.tick(3000).values.Tail;
  };

  it('加算は 重み × 値 の和（指定が無いときも加算）。パラメータの範囲で丸める', () => {
    expect(settled([yaw, { ...eyes, weight: 0.2 }], [])).toBeCloseTo(5 + 0.2 * 5, 6);
    expect(settled([yaw, eyes], [{ parameterId: 'Tail', method: 'add' }])).toBe(10);
  });

  it('重み付き平均', () => {
    const v = settled([yaw, { ...eyes, outputRange: [-2, 2] }], [{ parameterId: 'Tail', method: 'average' }]);
    expect(v).toBeCloseTo((1 * 5 + 3 * 1) / 4, 6);
    // 重みがどれも 0 ならふつうの平均
    const zero = settled(
      [
        { ...yaw, weight: 0 },
        { ...eyes, weight: 0, outputRange: [-2, 2] },
      ],
      [{ parameterId: 'Tail', method: 'average' }],
    );
    expect(zero).toBeCloseTo((5 + 1) / 2, 6);
  });

  it('優先は一覧で上の割り当て。そのフレームに入力が無ければ次の割り当て', () => {
    const combine: TrackingSetup['combine'] = [{ parameterId: 'Tail', method: 'priority' }];
    expect(settled([{ ...eyes, outputRange: [-2, 2] }, yaw], combine)).toBeCloseTo(1, 6);
    expect(settled([yaw, { ...eyes, outputRange: [-2, 2] }], combine)).toBeCloseTo(5, 6);
    // 口の形（mouthForm）は MVP の推定に無い入力なので、下の割り当てを使う
    const form = { ...yaw, input: 'mouthForm' as const, inputRange: [-1, 1] as [number, number] };
    expect(settled([form, yaw], combine, { mouthForm: undefined })).toBeCloseTo(5, 6);
  });
});
