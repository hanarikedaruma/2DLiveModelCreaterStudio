// アニメーションのキーフレーム（カード46）。時刻 t の補間と、キーフレームの追加・移動・削除・補間の切り替え。
// どれも新しい Animation を返す（変わらなければ同じ参照）。1つのトラックの中で、同じ時刻のキーフレームは1つだけにする
import type { Animation, Parameter } from '@app/schema';
import type { ParamValues } from '@app/contracts';
import { evaluateAnimationTrack } from '@app/core';

export type Track = Animation['tracks'][number];
export type Keyframe = Track['keyframes'][number];
export type KeyCurve = Keyframe['curve'];

export const TIME_STEP = 0.01; // 秒。キーフレームの時刻はこの刻みに丸める
export const MIN_DURATION = 0.1;
export const MAX_DURATION = 600;
export const DEFAULT_DURATION = 2;
export const DEFAULT_CURVE: KeyCurve = 'smooth'; // 新しいキーフレームの補間

const EPS = 1e-6;

export const sameTime = (a: number, b: number): boolean => Math.abs(a - b) < EPS;

// TIME_STEP の刻みに丸める（0.1 + 0.2 のような誤差を残さない）
export function roundTime(t: number): number {
  const r = Number((Math.round(t / TIME_STEP) * TIME_STEP).toFixed(2));
  return Object.is(r, -0) ? 0 : r;
}

export function smoothstep(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

// 時刻 t の値。区間の補間は前のキーフレームの curve で決める:
// linear は直線、smooth は前後のキーフレームの間を smoothstep、step は次のキーフレームまで前の値のまま。
// 最初のキーフレームより前は最初の値、最後より後は最後の値。キーフレームが無ければ undefined
export function sampleKeyframes(keyframes: readonly Keyframe[], t: number): number | undefined {
  return evaluateAnimationTrack(keyframes, t) ?? undefined;
}

// プレビューの値: 時刻 t でトラックを補間した値。トラックの無いパラメータはデフォルト値。
// モデルに無いパラメータのトラックは出さない
export function sampleAnimation(animation: Animation | null, parameters: readonly Parameter[], t: number): ParamValues {
  const out: ParamValues = {};
  for (const p of parameters) out[p.id] = p.default;
  if (!animation) return out;
  for (const track of animation.tracks) {
    if (!(track.parameterId in out)) continue;
    const v = sampleKeyframes(track.keyframes, t);
    if (v !== undefined) out[track.parameterId] = v;
  }
  return out;
}

export function trackOf(animation: Animation, parameterId: string): Track | undefined {
  return animation.tracks.find((t) => t.parameterId === parameterId);
}

export function keyframeAt(animation: Animation, parameterId: string, time: number): Keyframe | undefined {
  return trackOf(animation, parameterId)?.keyframes.find((k) => sameTime(k.time, time));
}

// いちばん後ろのキーフレームの時刻（無ければ 0）
export function lastKeyTime(animation: Animation): number {
  let last = 0;
  for (const track of animation.tracks) for (const k of track.keyframes) last = Math.max(last, k.time);
  return last;
}

// 0..duration に収めて刻みに丸める
export function clampTime(animation: Animation, time: number): number {
  const t = Number.isFinite(time) ? time : 0;
  return roundTime(Math.min(Math.max(t, 0), animation.duration));
}

// parameterId のトラックのキーフレームを fn で書き換える。空になったトラックは消し、無ければ末尾に足す
function withTrack(
  animation: Animation,
  parameterId: string,
  fn: (keyframes: readonly Keyframe[]) => readonly Keyframe[],
): Animation {
  const index = animation.tracks.findIndex((t) => t.parameterId === parameterId);
  const current = index < 0 ? [] : animation.tracks[index]!.keyframes;
  const next = fn(current);
  if (next === current) return animation;
  let tracks: Track[];
  if (next.length === 0) {
    if (index < 0) return animation;
    tracks = animation.tracks.filter((_, i) => i !== index);
  } else if (index < 0) {
    tracks = [...animation.tracks, { parameterId, keyframes: [...next] }];
  } else {
    tracks = animation.tracks.map((t, i) => (i === index ? { ...t, keyframes: [...next] } : t));
  }
  return { ...animation, tracks };
}

// 同じ時刻のものを除いて、時刻の順に入れる
function insertKeyframe(keyframes: readonly Keyframe[], key: Keyframe): Keyframe[] {
  const rest = keyframes.filter((k) => !sameTime(k.time, key.time));
  const at = rest.findIndex((k) => k.time > key.time);
  return at < 0 ? [...rest, key] : [...rest.slice(0, at), key, ...rest.slice(at)];
}

// time にキーフレームを置く。その時刻にあれば値だけを変える（補間はそのまま）
export function setKeyframe(
  animation: Animation,
  parameterId: string,
  time: number,
  value: number,
  curve: KeyCurve = DEFAULT_CURVE,
): Animation {
  if (!Number.isFinite(value)) return animation;
  const t = clampTime(animation, time);
  return withTrack(animation, parameterId, (keys) => {
    const i = keys.findIndex((k) => sameTime(k.time, t));
    if (i < 0) return insertKeyframe(keys, { time: t, value, curve });
    if (keys[i]!.value === value) return keys;
    return keys.map((k, j) => (j === i ? { ...k, value } : k));
  });
}

export function removeKeyframe(animation: Animation, parameterId: string, time: number): Animation {
  return withTrack(animation, parameterId, (keys) =>
    keys.some((k) => sameTime(k.time, time)) ? keys.filter((k) => !sameTime(k.time, time)) : keys,
  );
}

// from の時刻のキーフレームを to（0..duration に丸める）へ動かす。to に別のキーフレームがあれば、動かした方に置き換える
export function moveKeyframe(animation: Animation, parameterId: string, from: number, to: number): Animation {
  const t = clampTime(animation, to);
  return withTrack(animation, parameterId, (keys) => {
    const key = keys.find((k) => sameTime(k.time, from));
    if (!key || sameTime(key.time, t)) return keys;
    return insertKeyframe(
      keys.filter((k) => k !== key),
      { ...key, time: t },
    );
  });
}

// 補間（そのキーフレームから次のキーフレームまで）を変える
export function setKeyframeCurve(animation: Animation, parameterId: string, time: number, curve: KeyCurve): Animation {
  return withTrack(animation, parameterId, (keys) => {
    const i = keys.findIndex((k) => sameTime(k.time, time));
    if (i < 0 || keys[i]!.curve === curve) return keys;
    return keys.map((k, j) => (j === i ? { ...k, curve } : k));
  });
}

// 長さ（秒）を変える。MIN_DURATION..MAX_DURATION に収め、いちばん後ろのキーフレームより短くはしない
export function setDuration(animation: Animation, duration: number): Animation {
  if (!Number.isFinite(duration)) return animation;
  const min = Math.max(MIN_DURATION, lastKeyTime(animation));
  const d = roundTime(Math.min(MAX_DURATION, Math.max(min, duration)));
  return d === animation.duration ? animation : { ...animation, duration: d };
}
