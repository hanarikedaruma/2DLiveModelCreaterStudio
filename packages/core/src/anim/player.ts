// アニメーションの再生と遷移（カード47）。再生中のアニメーションごとに重み w(t) を持ち、開始は blendIn 秒で 0 → 1、
// 終了（ループでなければ終わりの時刻、または stop）は blendOut 秒で 1 → 0 にする。レイヤーは override
// （遷移の blendMode が addToTracking なら顔・体の角度は add）で weight = w(t)。ミキサーがその時点の合成結果
// （mixedSoFar）から混ぜるので、開始は現在の状態から始まり、終了は最新のトラッキングへ戻る。
// 再生中に別のアニメーションを始めたら、古いものは下げ、新しいものは上げる（同時に複数のレイヤーを返す）
import type { Animation, BlendOp, Parameter, ParameterGroupId, Project } from '@app/schema';
import type { AnimationPlayer, FrameContext, Layer, ParamValues } from '@app/contracts';

export type AnimationKeyframe = Animation['tracks'][number]['keyframes'][number];

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

// ---- トラックの補間 ----

function sortedByTime(keyframes: readonly AnimationKeyframe[]): readonly AnimationKeyframe[] {
  for (let i = 1; i < keyframes.length; i++) {
    if (keyframes[i]!.time < keyframes[i - 1]!.time) return [...keyframes].sort((a, b) => a.time - b.time);
  }
  return keyframes;
}

// 時刻 time（秒）でのトラックの値。キーフレームの curve は、そのキーフレームから次のキーフレームまでの区間に使う
// （linear 線形、smooth smoothstep、step 次のキーフレームまで前の値のまま）。最初のキーフレームより前は最初の値、
// 最後より後は最後の値。キーフレームが無ければ null
export function evaluateAnimationTrack(keyframes: readonly AnimationKeyframe[], time: number): number | null {
  if (keyframes.length === 0) return null;
  const keys = sortedByTime(keyframes);
  const first = keys[0]!;
  if (!(time > first.time)) return first.value;
  const last = keys[keys.length - 1]!;
  if (time >= last.time) return last.value;
  let i = 0;
  while (keys[i + 1]!.time <= time) i++;
  const a = keys[i]!;
  const b = keys[i + 1]!;
  const u = (time - a.time) / (b.time - a.time); // a.time ≤ time < b.time なので 0 で割らない
  switch (a.curve) {
    case 'step':
      return a.value;
    case 'smooth':
      return a.value + (b.value - a.value) * smoothstep(u);
    default:
      return a.value + (b.value - a.value) * u;
  }
}

// ---- 影響範囲と値 ----

// 影響範囲のパラメータ（parameters の順）。affectedGroups が空なら、キーフレームのあるトラックのパラメータのグループ
export function animationAffectedParameters(
  animation: Pick<Animation, 'tracks' | 'affectedGroups'>,
  parameters: readonly Parameter[],
): Parameter[] {
  let groups: Set<ParameterGroupId>;
  if (animation.affectedGroups.length > 0) {
    groups = new Set(animation.affectedGroups);
  } else {
    const byId = new Map(parameters.map((p) => [p.id, p]));
    groups = new Set();
    for (const track of animation.tracks) {
      const p = track.keyframes.length > 0 ? byId.get(track.parameterId) : undefined;
      if (p) groups.add(p.groupId);
    }
  }
  return parameters.filter((p) => groups.has(p.groupId));
}

// アニメーションの時刻 time（秒）での、影響範囲のパラメータの値（範囲に丸める）。
// 影響範囲の中でトラック（キーフレーム）の無いパラメータはデフォルト値
export function animationValuesAt(
  animation: Pick<Animation, 'tracks' | 'affectedGroups'>,
  parameters: readonly Parameter[],
  time: number,
): ParamValues {
  const tracks = new Map<string, readonly AnimationKeyframe[]>();
  for (const track of animation.tracks) {
    if (track.keyframes.length > 0 && !tracks.has(track.parameterId)) tracks.set(track.parameterId, track.keyframes);
  }
  const values: ParamValues = {};
  for (const p of animationAffectedParameters(animation, parameters)) {
    const keyframes = tracks.get(p.id);
    const v = keyframes ? evaluateAnimationTrack(keyframes, time) : p.default;
    if (v !== null && Number.isFinite(v)) values[p.id] = clamp(v, p.min, p.max);
  }
  return values;
}

// 遷移の合成方法が「トラッキングに加算」（addToTracking）のとき add にするパラメータ（顔・体の角度）
export const ANIMATION_ADD_PARAMETERS: readonly string[] = [
  'FaceAngleX',
  'FaceAngleY',
  'FaceAngleZ',
  'BodyAngleX',
  'BodyAngleY',
  'BodyAngleZ',
];

// addToTracking で add にするか。ユーザー定義のパラメータは、表情と同じくグループが顔・体なら角度として扱う
export function animationAddsToTracking(parameter: Pick<Parameter, 'id' | 'groupId' | 'standard'>): boolean {
  if (ANIMATION_ADD_PARAMETERS.includes(parameter.id)) return true;
  return !parameter.standard && (parameter.groupId === 'face' || parameter.groupId === 'body');
}

// 時刻 time（秒）でのアニメーションのレイヤー。add の項目の値は「トラックの値 − デフォルト値」
function layerAt(animation: Animation, parameters: readonly Parameter[], time: number, weight: number): Layer | null {
  const values = animationValuesAt(animation, parameters, time);
  const ids = Object.keys(values);
  if (ids.length === 0) return null;
  const addMode = animation.transition.blendMode === 'addToTracking';
  const byId = new Map(parameters.map((p) => [p.id, p]));
  const blend: Record<string, BlendOp> = {};
  for (const id of ids) {
    const p = byId.get(id)!;
    if (addMode && animationAddsToTracking(p)) {
      blend[id] = 'add';
      values[id] = values[id]! - p.default;
    } else {
      blend[id] = 'override';
    }
  }
  return { id: 'animation', weight, values, blend };
}

// ---- 再生 ----

// 1回の再生。fade が null の間は上げている（上げ終われば保つ）、fade があれば下げている
interface Playback {
  animationId: string;
  start: number; // ミリ秒。アニメーションの時刻 0
  fade: { start: number; from: number } | null; // 下げ始めた時刻と、そのときの重み
}

type Pending = { kind: 'play' | 'stop'; id: string; now: number } | { kind: 'stopAll'; now: number };

function ms(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

function curveAt(curve: Animation['transition']['curve'], progress: number): number {
  const x = clamp(progress, 0, 1);
  return curve === 'smooth' ? smoothstep(x) : x;
}

function rateOf(animation: Animation): number {
  return Number.isFinite(animation.speed) && animation.speed > 0 ? animation.speed : 0;
}

function durationOf(animation: Animation): number {
  return Number.isFinite(animation.duration) && animation.duration > 0 ? animation.duration : 0;
}

// 時刻 t（ミリ秒）でのアニメーションの時刻（秒）。ループなら繰り返し、ループでなければ終わりの時刻で止める
function localTime(animation: Animation, playback: Playback, t: number): number {
  const elapsed = (Math.max(0, t - playback.start) / 1000) * rateOf(animation);
  const duration = durationOf(animation);
  if (animation.loop) return duration > 0 ? elapsed % duration : 0;
  return Math.min(elapsed, duration);
}

// ループでないアニメーションが終わりの時刻に着く時刻（ミリ秒）。着かなければ Infinity
function endTime(animation: Animation, playback: Playback): number {
  if (animation.loop) return Infinity;
  const duration = durationOf(animation);
  if (duration === 0) return playback.start;
  const rate = rateOf(animation);
  return rate > 0 ? playback.start + (duration / rate) * 1000 : Infinity;
}

function weightAt(animation: Animation | undefined, playback: Playback, t: number): number {
  if (!animation) return 0;
  const { transition } = animation;
  if (playback.fade) {
    const out = ms(transition.blendOut);
    const progress = out <= 0 ? 1 : (t - playback.fade.start) / out;
    return playback.fade.from * (1 - curveAt(transition.curve, progress));
  }
  const rise = ms(transition.blendIn);
  return curveAt(transition.curve, rise <= 0 ? 1 : (t - playback.start) / rise);
}

function finished(animation: Animation | undefined, playback: Playback, t: number): boolean {
  if (!animation) return true;
  if (!playback.fade) return false;
  return t - playback.fade.start >= ms(animation.transition.blendOut);
}

function findAnimation(project: Project, id: string): Animation | undefined {
  return project.animations.find((a) => a.id === id);
}

// play・stop・stopAll はすぐには重みを変えず、次の produce で（そのときのプロジェクトの設定で）呼んだ時刻から切り替える。
// playing() は呼んだ直後から結果を返す。時刻が戻ったとき（開始より前の produce）は、その時刻から数え直す
export function createAnimationPlayer(): AnimationPlayer {
  let playbacks: Playback[] = []; // 古い順。上げている・保っているもの（fade が null）は最大1つ
  let pending: Pending[] = [];
  let current: string[] = []; // playing() の結果

  function beginFade(project: Project, playback: Playback, t: number) {
    if (playback.fade) return;
    playback.fade = { start: t, from: weightAt(findAnimation(project, playback.animationId), playback, t) };
  }

  // 時刻 t までに終わりの時刻へ着いたもの（ループでなく、トラッキングに戻るもの）を、終わりの時刻から下げる
  function settle(project: Project, t: number) {
    for (const playback of playbacks) {
      if (playback.fade) continue;
      const animation = findAnimation(project, playback.animationId);
      if (!animation || !animation.transition.returnToTracking) continue;
      const end = endTime(animation, playback);
      if (end <= t) playback.fade = { start: end, from: weightAt(animation, playback, end) };
    }
  }

  function run(project: Project, command: Pending, t: number) {
    settle(project, t);
    if (command.kind === 'stopAll') {
      for (const playback of playbacks) beginFade(project, playback, t);
      return;
    }
    const { id } = command;
    if (command.kind === 'stop') {
      for (const playback of playbacks) if (playback.animationId === id) beginFade(project, playback, t);
      return;
    }
    const animation = findAnimation(project, id);
    if (!animation) return;
    const playing = playbacks.some((p) => !p.fade && p.animationId === id);
    if (playing && animation.restart === 'ignore') return;
    // 割り込み・最初からの再開始: 再生中のものは下げ、新しく最初から上げる
    for (const playback of playbacks) beginFade(project, playback, t);
    playbacks.push({ animationId: id, start: t, fade: null });
  }

  return {
    id: 'animation',
    play(animationId, now) {
      pending.push({ kind: 'play', id: animationId, now });
      current = [animationId];
    },
    stop(animationId, now) {
      pending.push({ kind: 'stop', id: animationId, now });
      current = current.filter((id) => id !== animationId);
    },
    stopAll(now) {
      pending.push({ kind: 'stopAll', now });
      current = [];
    },
    playing: () => [...current],
    produce(ctx: FrameContext): Layer[] | null {
      const { project, now } = ctx;
      for (const command of pending) run(project, command, Number.isFinite(command.now) ? command.now : now);
      pending = [];
      for (const playback of playbacks) {
        // 時刻が戻った
        if (now < playback.start) playback.start = now;
        if (playback.fade && now < playback.fade.start) playback.fade.start = now;
      }
      settle(project, now);
      playbacks = playbacks.filter((p) => !finished(findAnimation(project, p.animationId), p, now));
      current = playbacks.filter((p) => !p.fade).map((p) => p.animationId);

      const { parameters } = project.model;
      const layers: Layer[] = [];
      for (const playback of playbacks) {
        const animation = findAnimation(project, playback.animationId)!;
        const weight = clamp(weightAt(animation, playback, now), 0, 1);
        // 後のレイヤーへ伝える。リップシンクは (1 − w) を掛け（重なれば積）、物理演算は再生の間止める
        if (!animation.transition.keepLipSync)
          ctx.flags.lipSyncWeight = clamp(ctx.flags.lipSyncWeight * (1 - weight), 0, 1);
        if (!animation.transition.keepPhysics) ctx.flags.physicsActive = false;
        if (weight <= 0) continue;
        const layer = layerAt(animation, parameters, localTime(animation, playback, now), weight);
        if (layer) layers.push(layer);
      }
      return layers.length > 0 ? layers : null;
    },
  };
}
