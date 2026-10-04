import { describe, expect, it } from 'vitest';
import { STANDARD_PARAMETERS, type Animation, type Parameter } from '@app/schema';
import { createAnimation } from './commands';
import {
  clampTime,
  keyframeAt,
  lastKeyTime,
  moveKeyframe,
  removeKeyframe,
  roundTime,
  sampleAnimation,
  sampleKeyframes,
  setDuration,
  setKeyframe,
  setKeyframeCurve,
  smoothstep,
  type KeyCurve,
  type Keyframe,
} from './keyframes';

const key = (time: number, value: number, curve: KeyCurve = 'linear'): Keyframe => ({ time, value, curve });

function anim(tracks: Animation['tracks'] = [], duration = 2): Animation {
  return { ...createAnimation('テスト', 'a1'), duration, tracks };
}

const params: Parameter[] = STANDARD_PARAMETERS.filter((p) => ['FaceAngleX', 'EyeOpenL', 'MouthOpen'].includes(p.id));

describe('補間（プレビューの値）', () => {
  it('線形: 前後のキーフレームの間を直線で結ぶ', () => {
    const keys = [key(0, 0, 'linear'), key(1, 30, 'linear')];
    expect(sampleKeyframes(keys, 0)).toBe(0);
    expect(sampleKeyframes(keys, 0.25)).toBeCloseTo(7.5, 9);
    expect(sampleKeyframes(keys, 0.5)).toBeCloseTo(15, 9);
    expect(sampleKeyframes(keys, 0.75)).toBeCloseTo(22.5, 9);
    expect(sampleKeyframes(keys, 1)).toBe(30);
  });

  it('なめらか: 前後のキーフレームの間を smoothstep（u²(3−2u)）で結ぶ', () => {
    const keys = [key(0, 0, 'smooth'), key(1, 30, 'smooth')];
    expect(sampleKeyframes(keys, 0.25)).toBeCloseTo(30 * 0.15625, 9); // 0.25² × 2.5
    expect(sampleKeyframes(keys, 0.5)).toBeCloseTo(15, 9);
    expect(sampleKeyframes(keys, 0.75)).toBeCloseTo(30 * 0.84375, 9);
    // 端では傾きが 0（線形より端の近くの変化が小さい）
    expect(sampleKeyframes(keys, 0.05)!).toBeLessThan(30 * 0.05);
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
  });

  it('一定: 次のキーフレームまで前の値のまま、次の時刻で切り替わる', () => {
    const keys = [key(0, 0, 'step'), key(1, 30, 'step')];
    expect(sampleKeyframes(keys, 0)).toBe(0);
    expect(sampleKeyframes(keys, 0.5)).toBe(0);
    expect(sampleKeyframes(keys, 0.999)).toBe(0);
    expect(sampleKeyframes(keys, 1)).toBe(30);
  });

  it('区間の補間は前のキーフレームの curve で決まる（区間ごとに違ってよい）', () => {
    const keys = [key(0, 0, 'step'), key(1, 10, 'smooth'), key(2, 20, 'linear'), key(3, 0, 'linear')];
    expect(sampleKeyframes(keys, 0.5)).toBe(0); // step
    expect(sampleKeyframes(keys, 1.25)).toBeCloseTo(10 + 10 * 0.15625, 9); // smooth
    expect(sampleKeyframes(keys, 2.5)).toBeCloseTo(10, 9); // linear
  });

  it('最初のキーフレームより前は最初の値、最後より後は最後の値。キーフレームが無ければ undefined', () => {
    const keys = [key(0.5, 3), key(1.5, 7)];
    expect(sampleKeyframes(keys, 0)).toBe(3);
    expect(sampleKeyframes(keys, 2)).toBe(7);
    expect(sampleKeyframes([key(1, 4)], 0.3)).toBe(4);
    expect(sampleKeyframes([], 1)).toBeUndefined();
  });

  it('時刻の順に並んでいなくても正しく補間する', () => {
    expect(sampleKeyframes([key(1, 30), key(0, 0)], 0.5)).toBeCloseTo(15, 9);
  });

  it('sampleAnimation: トラックのあるパラメータは補間した値、無いパラメータはデフォルト値', () => {
    const a = anim([
      { parameterId: 'FaceAngleX', keyframes: [key(0, 0, 'linear'), key(2, 20, 'linear')] },
      { parameterId: 'MouthOpen', keyframes: [key(0, 0, 'step'), key(1, 1, 'step')] },
      { parameterId: 'Unknown', keyframes: [key(0, 5)] },
    ]);
    expect(sampleAnimation(a, params, 0.5)).toEqual({ FaceAngleX: 5, EyeOpenL: 1, MouthOpen: 0 });
    expect(sampleAnimation(a, params, 1)).toEqual({ FaceAngleX: 10, EyeOpenL: 1, MouthOpen: 1 });
    // アニメーションが無ければすべてデフォルト値（モデルに無いパラメータは出さない）
    expect(sampleAnimation(null, params, 1)).toEqual({ FaceAngleX: 0, EyeOpenL: 1, MouthOpen: 0 });
  });
});

describe('キーフレームの操作', () => {
  it('追加: 時刻の順に入れる。0..duration に収めて 0.01 秒に丸める。トラックが無ければ作る', () => {
    let a = anim();
    a = setKeyframe(a, 'FaceAngleX', 1, 10);
    a = setKeyframe(a, 'FaceAngleX', 0.304, 5);
    a = setKeyframe(a, 'FaceAngleX', 9, 20);
    expect(a.tracks).toEqual([
      {
        parameterId: 'FaceAngleX',
        keyframes: [key(0.3, 5, 'smooth'), key(1, 10, 'smooth'), key(2, 20, 'smooth')],
      },
    ]);
  });

  it('同じ時刻にあれば値だけを変える（補間はそのまま）。同じ値なら同じ参照を返す', () => {
    const a = anim([{ parameterId: 'FaceAngleX', keyframes: [key(1, 10, 'step')] }]);
    const b = setKeyframe(a, 'FaceAngleX', 1, 12);
    expect(b.tracks[0]!.keyframes).toEqual([key(1, 12, 'step')]);
    expect(setKeyframe(b, 'FaceAngleX', 1, 12)).toBe(b);
    expect(setKeyframe(b, 'FaceAngleX', 1, Number.NaN)).toBe(b);
  });

  it('削除: 最後のキーフレームを消すとトラックも消える。無ければ同じ参照', () => {
    const a = anim([{ parameterId: 'FaceAngleX', keyframes: [key(0, 0), key(1, 10)] }]);
    const b = removeKeyframe(a, 'FaceAngleX', 1);
    expect(b.tracks[0]!.keyframes).toEqual([key(0, 0)]);
    expect(removeKeyframe(b, 'FaceAngleX', 0).tracks).toEqual([]);
    expect(removeKeyframe(b, 'FaceAngleX', 0.5)).toBe(b);
    expect(removeKeyframe(b, 'MouthOpen', 0)).toBe(b);
  });

  it('移動: 値と補間を保ったまま時刻を変え、順に並べ直す。範囲の外は端にする', () => {
    const a = anim([{ parameterId: 'FaceAngleX', keyframes: [key(0, 0, 'linear'), key(1, 10, 'step')] }]);
    const b = moveKeyframe(a, 'FaceAngleX', 0, 1.5);
    expect(b.tracks[0]!.keyframes).toEqual([key(1, 10, 'step'), key(1.5, 0, 'linear')]);
    expect(moveKeyframe(a, 'FaceAngleX', 1, 5).tracks[0]!.keyframes).toEqual([key(0, 0, 'linear'), key(2, 10, 'step')]);
    expect(moveKeyframe(a, 'FaceAngleX', 1, -1).tracks[0]!.keyframes).toEqual([key(0, 10, 'step')]);
    expect(moveKeyframe(a, 'FaceAngleX', 1, 1)).toBe(a);
    expect(moveKeyframe(a, 'FaceAngleX', 0.5, 1)).toBe(a);
  });

  it('移動先に別のキーフレームがあれば、動かした方に置き換える', () => {
    const a = anim([{ parameterId: 'FaceAngleX', keyframes: [key(0, 0), key(1, 10), key(2, 20)] }]);
    expect(moveKeyframe(a, 'FaceAngleX', 0, 1).tracks[0]!.keyframes).toEqual([key(1, 0), key(2, 20)]);
  });

  it('補間の切り替え。同じなら同じ参照', () => {
    const a = anim([{ parameterId: 'FaceAngleX', keyframes: [key(0, 0, 'linear'), key(1, 10)] }]);
    const b = setKeyframeCurve(a, 'FaceAngleX', 0, 'step');
    expect(keyframeAt(b, 'FaceAngleX', 0)).toEqual(key(0, 0, 'step'));
    expect(setKeyframeCurve(b, 'FaceAngleX', 0, 'step')).toBe(b);
    expect(setKeyframeCurve(b, 'FaceAngleX', 0.5, 'smooth')).toBe(b);
  });

  it('長さ: 0.1 秒より短くせず、いちばん後ろのキーフレームより短くもしない', () => {
    const a = anim([{ parameterId: 'FaceAngleX', keyframes: [key(0, 0), key(1.5, 10)] }]);
    expect(lastKeyTime(a)).toBe(1.5);
    expect(setDuration(a, 3).duration).toBe(3);
    expect(setDuration(a, 1).duration).toBe(1.5);
    expect(setDuration(anim(), 0).duration).toBe(0.1);
    expect(setDuration(a, 2)).toBe(a);
  });

  it('時刻の丸め', () => {
    expect(roundTime(0.1 + 0.2)).toBe(0.3);
    expect(roundTime(-0.001)).toBe(0);
    expect(clampTime(anim(), 2.346)).toBe(2);
    expect(clampTime(anim(), Number.NaN)).toBe(0);
  });
});
