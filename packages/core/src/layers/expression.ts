// 表情（カード38・52）。apply で表情を1つに切り替え（STEP1）、toggle で表情を重ねる・外す（カード52）。
// 外れた表情は fadeOut、足した表情は fadeIn の秒数で重みを変え（ease-in-out）、produce は表情ごとに1つのレイヤー
// （weight はフェードの重み）を適用した順に返す。あわせて、表情を作るときの合成方法の決め方（標準の合成ルール）と、
// 作った状態と項目の値の変換を置く
import type { BlendOp, Expression, Parameter, ParameterGroupId } from '@app/schema';
import type { ExpressionController, FrameContext, Layer, ParamValues } from '@app/contracts';

export const EXPRESSION_FADE_DEFAULT = 0.2; // fadeIn・fadeOut の初期値（秒）

// ease-in-out（始めと終わりがゆっくり。0 → 0、0.5 → 0.5、1 → 1）
export function expressionEase(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

// ---- 合成方法の決め方 ----

// 標準の合成ルール（表情の列）。顔・体の角度 add、目の開閉 multiply、目の笑顔・頬染め override、眉 add、
// 口の開閉 add、口の形・横幅 override
export const EXPRESSION_STANDARD_BLENDS: Readonly<Record<string, BlendOp>> = {
  FaceAngleX: 'add',
  FaceAngleY: 'add',
  FaceAngleZ: 'add',
  BodyAngleX: 'add',
  BodyAngleY: 'add',
  BodyAngleZ: 'add',
  EyeOpenL: 'multiply',
  EyeOpenR: 'multiply',
  EyeSmileL: 'override',
  EyeSmileR: 'override',
  Cheek: 'override',
  BrowYL: 'add',
  BrowYR: 'add',
  BrowFormL: 'add',
  BrowFormR: 'add',
  MouthOpen: 'add',
  MouthForm: 'override',
  MouthWidth: 'override',
};

// 表に無いユーザー定義のパラメータは、グループで決める（顔・体・眉は add、ほかは override）
const GROUP_BLENDS: Partial<Record<ParameterGroupId, BlendOp>> = { face: 'add', body: 'add', brow: 'add' };

// グループごとの2択。'rule' はトラッキングに重ねる（ルールどおり）、'fixed' は固定する（override）
export type ExpressionGroupMode = 'rule' | 'fixed';
export type ExpressionGroupModes = Partial<Record<ParameterGroupId, ExpressionGroupMode>>;

// ルールどおりの合成方法。表に無い標準パラメータ（瞳・呼吸・腕・揺れもの）は override
export function expressionRuleBlend(parameter: Pick<Parameter, 'id' | 'groupId' | 'standard'>): BlendOp {
  if (Object.hasOwn(EXPRESSION_STANDARD_BLENDS, parameter.id)) return EXPRESSION_STANDARD_BLENDS[parameter.id]!;
  if (parameter.standard) return 'override';
  return GROUP_BLENDS[parameter.groupId] ?? 'override';
}

// グループの2択に応じた合成方法
export function expressionBlendFor(
  parameter: Pick<Parameter, 'id' | 'groupId' | 'standard'>,
  mode: ExpressionGroupMode = 'rule',
): BlendOp {
  return mode === 'fixed' ? 'override' : expressionRuleBlend(parameter);
}

// ---- 作った状態（パラメータの値）と項目の値の変換 ----
// override・max は値そのまま、add はデフォルト値からの差、multiply はデフォルト値に対する倍率
// （デフォルト値が 0 なら値そのまま）。標準パラメータではどれも値そのままになる

export function expressionEntryValue(parameter: Pick<Parameter, 'default'>, blend: BlendOp, state: number): number {
  switch (blend) {
    case 'add':
      return state - parameter.default;
    case 'multiply':
      return parameter.default !== 0 ? state / parameter.default : state;
    default:
      return state;
  }
}

export function expressionStateValue(parameter: Pick<Parameter, 'default'>, blend: BlendOp, value: number): number {
  switch (blend) {
    case 'add':
      return parameter.default + value;
    case 'multiply':
      return parameter.default !== 0 ? value * parameter.default : value;
    default:
      return value;
  }
}

const STATE_TOLERANCE = 1e-6;

const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);

// 作った状態から項目を作る。デフォルト値から動かしたパラメータだけを、parameters の順に入れる。
// 合成方法はグループの2択（無ければルールどおり）で決める
export function buildExpressionEntries(
  parameters: readonly Parameter[],
  state: ParamValues,
  modes: ExpressionGroupModes = {},
): Expression['entries'] {
  const entries: Expression['entries'] = [];
  for (const p of parameters) {
    const raw = state[p.id];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const v = clamp(raw, p.min, p.max);
    if (Math.abs(v - p.default) <= STATE_TOLERANCE) continue;
    const blend = expressionBlendFor(p, modes[p.groupId] ?? 'rule');
    entries.push({ parameterId: p.id, value: expressionEntryValue(p, blend, v), blend });
  }
  return entries;
}

// 表情の項目から、作った状態（編集を始めるときの editorParamValues）に戻す。プロジェクトに無いパラメータは除く
export function expressionStateOf(
  parameters: readonly Parameter[],
  expression: Pick<Expression, 'entries'>,
): ParamValues {
  const state: ParamValues = {};
  for (const e of expression.entries) {
    const p = parameters.find((x) => x.id === e.parameterId);
    if (!p || !Number.isFinite(e.value)) continue;
    state[p.id] = clamp(expressionStateValue(p, e.blend, e.value), p.min, p.max);
  }
  return state;
}

// 表情の項目から、グループの2択を読む。ルールでは override でない項目を override にしていれば 'fixed'
export function expressionGroupModesOf(
  parameters: readonly Parameter[],
  expression: Pick<Expression, 'entries'>,
): ExpressionGroupModes {
  const modes: ExpressionGroupModes = {};
  for (const e of expression.entries) {
    const p = parameters.find((x) => x.id === e.parameterId);
    if (!p) continue;
    if (e.blend === 'override' && expressionRuleBlend(p) !== 'override') modes[p.groupId] = 'fixed';
  }
  return modes;
}

// ---- ExpressionController ----

// 表情ごとの重みの動き。to 1 は現れていく（fadeIn）、to 0 は消えていく（fadeOut）。
// 重み = from + (to − from) × ease((t − start) / 秒数)
interface Track {
  id: string;
  from: number;
  to: 0 | 1;
  start: number; // ミリ秒
}

function findExpression(project: FrameContext['project'], id: string): Expression | undefined {
  return project.expressions.find((e) => e.id === id);
}

function fadeMs(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

// 表情の項目から、重み weight の1つのレイヤーを作る（blend は各項目の blend）。
// プロジェクトに無いパラメータと数でない値は除き、何も残らなければ null
function expressionLayer(expression: Expression, weight: number, parameterIds: ReadonlySet<string>): Layer | null {
  const values: ParamValues = {};
  const blend: Record<string, BlendOp> = {};
  for (const e of expression.entries) {
    if (!parameterIds.has(e.parameterId) || !Number.isFinite(e.value)) continue;
    values[e.parameterId] = e.value;
    blend[e.parameterId] = e.blend;
  }
  if (Object.keys(values).length === 0) return null;
  return { id: 'expression', weight, values, blend };
}

// 表情を適用する。apply・toggle はすぐには重みを変えず、次の produce で（そのときのプロジェクトの秒数で）切り替える。
// produce は表情ごとに1つのレイヤーを適用した順に返すので、override で取り合うパラメータは後から適用した表情が勝つ。
// 時刻が戻ったとき（apply の時刻より前の produce）は、その時刻から数え直す
export function createExpressionController(): ExpressionController {
  let applied: string[] = []; // 適用中の表情（適用した順）
  // レイヤーの順（適用した順）に並べた重みの動き。外れた表情は消え終わるまで元の位置に残る。同じ表情は1つだけ
  let tracks: Track[] = [];
  let pending: { ids: readonly string[]; now: number }[] = [];

  function weightAt(project: FrameContext['project'], track: Track, t: number): number {
    const expression = findExpression(project, track.id);
    const ms = expression ? fadeMs(track.to === 1 ? expression.fadeIn : expression.fadeOut) : 0;
    const progress = ms <= 0 ? 1 : (t - track.start) / ms;
    return track.from + (track.to - track.from) * expressionEase(progress);
  }

  // 時刻 t で、適用中の表情を ids（適用した順）にする。外れた表情はその時点の重みから消えていき、
  // 新しく足した表情は後ろに足して現れる。適用したままの表情はフェードを続ける。
  // 消えかけの表情に戻るときは、その重みから現れる（後から適用したことになるので、順番は後ろへ移る）
  function transition(project: FrameContext['project'], ids: readonly string[], t: number) {
    const wanted = new Set(ids);
    const returning = new Map<string, number>();
    const next: Track[] = [];
    for (const track of tracks) {
      if (wanted.has(track.id)) {
        if (track.to === 1) next.push(track);
        else returning.set(track.id, weightAt(project, track, t));
        continue;
      }
      if (track.to === 0) {
        next.push(track);
        continue;
      }
      const w = weightAt(project, track, t);
      if (w > 0) next.push({ id: track.id, from: w, to: 0, start: t });
    }
    for (const id of ids) {
      if (next.some((track) => track.id === id)) continue;
      next.push({ id, from: returning.get(id) ?? 0, to: 1, start: t });
    }
    tracks = next;
  }

  function request(ids: string[], now: number) {
    applied = ids;
    pending.push({ ids, now });
  }

  return {
    id: 'expression',
    // ほかを全部外して expressionId だけにする（null で全部外す）。STEP1 の1つずつの切り替えと同じ
    apply(expressionId, now) {
      const ids = expressionId === null ? [] : [expressionId];
      if (!sameIds(ids, applied)) request(ids, now);
    },
    active: () => applied.at(-1) ?? null, // 最後に適用した表情
    // 適用していなければ後ろに足し（fadeIn）、適用していれば外す（fadeOut）
    toggle(expressionId, now) {
      request(
        applied.includes(expressionId) ? applied.filter((id) => id !== expressionId) : [...applied, expressionId],
        now,
      );
    },
    actives: () => [...applied],
    produce(ctx): Layer[] | null {
      const { project, now } = ctx;
      for (const p of pending) transition(project, p.ids, Number.isFinite(p.now) ? p.now : now);
      pending = [];

      const parameterIds = new Set(project.model.parameters.map((p) => p.id));
      const layers: Layer[] = [];
      tracks = tracks.filter((track) => {
        if (now < track.start) track.start = now; // 時刻が戻った
        const weight = weightAt(project, track, now);
        if (track.to === 0 && weight <= 0) return false; // 消え終わった
        const expression = findExpression(project, track.id);
        const layer = expression && weight > 0 ? expressionLayer(expression, Math.min(1, weight), parameterIds) : null;
        if (layer) layers.push(layer);
        return true;
      });
      return layers.length > 0 ? layers : null;
    },
  };
}
