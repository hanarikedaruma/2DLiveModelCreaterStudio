// 周期アニメーション（カード48）。setActive で選んだアニメーションのうち periodic が true のものをループ再生し、
// トラックの補間値からデフォルト値を引いた差分を add で重ねる（レイヤーは1つ、weight 1）。LAYER_ORDER でアニメーションの
// 後に合成するので、アニメーションの再生中も止まらずに上へ足される。開始と停止は 0.5 秒でフェードする
// （フェードの途中で戻したら、そのときの強さから逆向きに進める。止めずに続けたものはループの位置もそのまま）
import type { Animation, BlendOp, Project } from '@app/schema';
import type { FrameContext, Layer, ParamValues, PeriodicPlayer } from '@app/contracts';
import { animationValuesAt } from './player';

export const PERIODIC_FADE_SECONDS = 0.5;
const FADE_MS = PERIODIC_FADE_SECONDS * 1000;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

// 再生中の1つ。on が true なら上げている（上げ終われば保つ）、false なら下げている（下げ終われば外す）
interface Running {
  animationId: string;
  start: number; // ミリ秒。ループの時刻 0
  on: boolean;
  fadeStart: number; // ミリ秒。いまの向きに進め始めた時刻
  fadeFrom: number; // そのときの強さ（0..1）
}

// 時刻 t（ミリ秒）での強さ（0..1、フェードの進み具合）
function levelAt(r: Running, t: number): number {
  const progress = Math.max(0, t - r.fadeStart) / FADE_MS;
  return clamp(r.on ? r.fadeFrom + progress : r.fadeFrom - progress, 0, 1);
}

// 時刻 t（ミリ秒）でのアニメーションの時刻（秒）。いつもループする（Animation.loop は見ない）
function loopTime(animation: Animation, r: Running, t: number): number {
  const rate = Number.isFinite(animation.speed) && animation.speed > 0 ? animation.speed : 0;
  const duration = Number.isFinite(animation.duration) && animation.duration > 0 ? animation.duration : 0;
  if (duration === 0) return 0;
  return ((Math.max(0, t - r.start) / 1000) * rate) % duration;
}

// 有効にするもの: 選ばれた順に、プロジェクトにあって periodic が true のもの（重なりは除く）
function wantedIds(project: Project, selected: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of selected) {
    if (out.includes(id)) continue;
    if (project.animations.some((a) => a.id === id && a.periodic)) out.push(id);
  }
  return out;
}

// setActive はすぐには変えず、次の produce の時刻から切り替える（setActive に時刻が無いため）。
// 選ばれていても periodic でないものは下げる。プロジェクトから消えたものは（値を作れないので）すぐ外す。
// 時刻が戻ったとき（前の produce より前の時刻）は、前の produce のときの強さとループの位置から、その時刻で続ける
export function createPeriodicPlayer(): PeriodicPlayer {
  let selected: string[] = [];
  let running: Running[] = []; // 始めた順
  let lastNow: number | null = null;

  return {
    id: 'periodic',
    setActive(animationIds) {
      selected = [...animationIds];
    },
    produce(ctx: FrameContext): Layer | null {
      const { project, now } = ctx;
      const byId = new Map(project.animations.map((a) => [a.id, a]));
      running = running.filter((r) => byId.has(r.animationId));
      if (lastNow !== null && now < lastNow) {
        for (const r of running) {
          r.fadeFrom = levelAt(r, lastNow);
          r.fadeStart = now;
          r.start = now - Math.max(0, lastNow - r.start);
        }
      }
      lastNow = now;

      const wanted = wantedIds(project, selected);
      for (const r of running) {
        const on = wanted.includes(r.animationId);
        if (on === r.on) continue;
        r.fadeFrom = levelAt(r, now);
        r.fadeStart = now;
        r.on = on;
      }
      for (const id of wanted) {
        if (!running.some((r) => r.animationId === id))
          running.push({ animationId: id, start: now, on: true, fadeStart: now, fadeFrom: 0 });
      }
      running = running.filter((r) => r.on || levelAt(r, now) > 0);

      const { parameters } = project.model;
      const defaults = new Map(parameters.map((p) => [p.id, p.default]));
      const values: ParamValues = {};
      for (const r of running) {
        const strength = smoothstep(levelAt(r, now));
        if (strength <= 0) continue;
        const animation = byId.get(r.animationId)!;
        const tracked = new Set(animation.tracks.filter((t) => t.keyframes.length > 0).map((t) => t.parameterId));
        // 影響範囲と値の範囲は通常のアニメーションと同じ決め方（範囲に丸めてからデフォルト値を引く）
        const at = animationValuesAt(animation, parameters, loopTime(animation, r, now));
        for (const [id, v] of Object.entries(at)) {
          if (!tracked.has(id)) continue; // トラックの無いパラメータはデフォルト値なので差分 0
          values[id] = (values[id] ?? 0) + (v - defaults.get(id)!) * strength;
        }
      }
      const ids = Object.keys(values);
      if (ids.length === 0) return null;
      const blend: Record<string, BlendOp> = {};
      for (const id of ids) blend[id] = 'add';
      return { id: 'periodic', weight: 1, values, blend };
    },
  };
}

// ---- 標準の呼吸 ----

export const STANDARD_BREATH_ANIMATION_ID = 'standard-breath';
const BREATH_PARAMETER_ID = 'Breath';

// 標準の「呼吸」: Breath を 0 → 1 → 0、4 秒で1周、なめらか。遷移は周期アニメーションでは使わないが、
// アニメーションの画面で「自動」に見えるよう、プリセット auto の値（アニメーション画面のカード46と同じ）にしておく
export function createStandardBreathAnimation(): Animation {
  return {
    id: STANDARD_BREATH_ANIMATION_ID,
    name: '呼吸',
    duration: 4,
    speed: 1,
    loop: true,
    periodic: true,
    tracks: [
      {
        parameterId: BREATH_PARAMETER_ID,
        keyframes: [
          { time: 0, value: 0, curve: 'smooth' },
          { time: 2, value: 1, curve: 'smooth' },
          { time: 4, value: 0, curve: 'smooth' },
        ],
      },
    ],
    affectedGroups: [],
    restart: 'restart',
    transition: {
      preset: 'auto',
      blendIn: 0.35,
      blendOut: 0.4,
      curve: 'smooth',
      blendMode: 'override',
      keepLipSync: true,
      keepPhysics: true,
      returnToTracking: true,
    },
  };
}

// 呼吸があるか: 標準の呼吸（id）か、Breath のキーフレームを持つ周期アニメーションがあれば true
export function hasBreathAnimation(project: Pick<Project, 'animations'>): boolean {
  return project.animations.some(
    (a) =>
      a.id === STANDARD_BREATH_ANIMATION_ID ||
      (a.periodic && a.tracks.some((t) => t.parameterId === BREATH_PARAMETER_ID && t.keyframes.length > 0)),
  );
}

// 呼吸が無ければ標準の呼吸を末尾に足す。あれば同じ参照を返す（シーンで有効にはしない）
export function withStandardBreathAnimation(project: Project): Project {
  if (hasBreathAnimation(project)) return project;
  return { ...project, animations: [...project.animations, createStandardBreathAnimation()] };
}
