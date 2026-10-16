import { validateProject } from './validate';
import type { Project } from './types';
import { attachClosedEyeLine } from './closedEyeLine';
import type { Model, Vec2 } from './types';

export const SCHEMA_VERSION = 11;

// { [版]: その版の json を次の版に変換する関数 }
export type Migrations = Record<number, (json: Record<string, unknown>) => Record<string, unknown>>;
export const MIGRATIONS: Migrations = {
  10: (json) => json, // AI音声は省略OFF。既存の口形・機器・キーを変更しない。
  9: (json) => json, // I-060は省略OFF。既存の遷移・トラック・再生方法を変えない
  1: opacityKeysToAbsolute,
  2: trackingSetupFromMappings,
  3: (json) =>
    isRecord(json.model) ? { ...json, model: { ...json.model, curveGuides: json.model.curveGuides ?? [] } } : json,
  4: (json) => json, // dynamicsの省略はOFF。既存の軸/線/キーを変更しない
  5: (json) => json, // 胸は使うときだけ。既存の物理・partのキーを変更しない
  6: (json) => json, // 輪郭線（I-068）は使うときだけ。省略は空で、既存のメッシュ・キーを変更しない
  7: (json) => json, // 格子の向きの省略は0。既存の格子・キーは自動で作り直さない（I-078/I-079）
  8: (json) => {
    if (!isRecord(json.model) || !isRecord(json.model.setupHints)) return json;
    const model = json.model as unknown as Model;
    const hints = { ...json.model.setupHints };
    for (const side of ['L', 'R'] as const) {
      const key = side === 'L' ? 'closedLineL' : 'closedLineR';
      const points = hints[key];
      if (Array.isArray(points)) {
        const usable = points.every((p) => isRecord(p) && Number.isFinite(p.x) && Number.isFinite(p.y));
        // 壊れた入力の診断はvalidateに任せる。幾何が無い場合も線を保持する。
        hints[key] =
          usable && Array.isArray(model.parts) && Array.isArray(model.meshes) && Array.isArray(model.warps)
            ? attachClosedEyeLine(model, side, points as Vec2[])
            : { partId: null, points };
      }
    }
    return { ...json, model: { ...json.model, setupHints: hints } };
  },
};

export class ProjectVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectVersionError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---- 1 → 2: 不透明度のキーを倍率から絶対値にする（I-026） ----

// 倍率 0 の代わりに記録していた値（カード34・42）。倍率では 0 から上げられなかったため。2 では 0 にする
export const LEGACY_OPACITY_FLOOR = 0.001;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const COORD_EPS = 1e-6;
const sameCoord = (a: number, b: number) => Math.abs(a - b) <= COORD_EPS * Math.max(1, Math.abs(a), Math.abs(b));

// キーの不透明度の倍率（0..。LEGACY_OPACITY_FLOOR 以下は 0）。読めなければ null
function factorOf(key: unknown): number | null {
  if (!isRecord(key) || !isRecord(key.delta) || typeof key.delta.opacity !== 'number') return null;
  const f = Math.max(0, key.delta.opacity);
  return f <= LEGACY_OPACITY_FLOOR + 1e-9 ? 0 : f;
}

function coordsOf(key: unknown): number[] | null {
  return isRecord(key) && Array.isArray(key.coords) && key.coords.every((c) => typeof c === 'number')
    ? (key.coords as number[])
    : null;
}

// デフォルト値での倍率。そこにキーがあればその値、1パラメータなら前後のキーの線形補間、ほかは 1
function factorAtDefault(keys: unknown[], defaults: number[]): number {
  const exact = keys.find((k) => {
    const c = coordsOf(k);
    return c !== null && c.length === defaults.length && c.every((v, i) => sameCoord(v, defaults[i]!));
  });
  if (exact !== undefined) return factorOf(exact) ?? 1;
  if (defaults.length !== 1) return 1;
  const points = keys
    .map((k) => ({ c: coordsOf(k)?.[0], f: factorOf(k) }))
    .filter((p): p is { c: number; f: number } => p.c !== undefined && p.f !== null)
    .sort((a, b) => a.c - b.c);
  if (points.length === 0) return 1;
  const d = defaults[0]!;
  if (d <= points[0]!.c) return points[0]!.f;
  const last = points[points.length - 1]!;
  if (d >= last.c) return last.f;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (d >= a.c && d <= b.c) return b.c > a.c ? a.f + ((b.f - a.f) * (d - a.c)) / (b.c - a.c) : a.f;
  }
  return 1;
}

// 1 では、キーの opacity は倍率で、パーツの不透明度 = Part.opacity × 各バインディングの倍率の積だった。
// 倍率が 1 でないキーを持つ transform のバインディングを不透明度のバインディング（controlsOpacity）にし、
// キーの値を「その姿勢でのパーツ自身の不透明度」にする。
// 新しい Part.opacity = Part.opacity × 各バインディングのデフォルト値での倍率の積（デフォルト値の見た目のまま）。
// キーの値 = Part.opacity × そのキーの倍率 × ほかのバインディングのデフォルト値での倍率。
// バインディングが1つなら見た目は変わらない。複数が同時にデフォルト値から外れたときだけ、積から和に変わる
function opacityKeysToAbsolute(json: Record<string, unknown>): Record<string, unknown> {
  const model = json.model;
  if (!isRecord(model) || !Array.isArray(model.parts) || !Array.isArray(model.bindings)) return json;
  const parameters = Array.isArray(model.parameters) ? model.parameters : [];
  const defaultOf = (id: unknown): number => {
    const p = parameters.find((x) => isRecord(x) && x.id === id);
    return isRecord(p) && typeof p.default === 'number' ? p.default : 0;
  };

  const byPart = new Map<string, number[]>(); // partId → 倍率の不透明度を持つバインディングの添字
  model.bindings.forEach((b, i) => {
    if (!isRecord(b) || b.channel !== 'transform' || !isRecord(b.target) || typeof b.target.id !== 'string') return;
    if (!Array.isArray(b.keys) || !b.keys.some((k) => Math.abs((factorOf(k) ?? 1) - 1) > 1e-9)) return;
    byPart.set(b.target.id, [...(byPart.get(b.target.id) ?? []), i]);
  });
  if (byPart.size === 0) return json;

  const parts = model.parts.slice();
  const bindings = model.bindings.slice();
  for (const [partId, indexes] of byPart) {
    const at = parts.findIndex((p) => isRecord(p) && p.id === partId);
    const part = parts[at];
    if (!isRecord(part)) continue;
    const base = typeof part.opacity === 'number' ? clamp01(part.opacity) : 1;
    const atDefault = indexes.map((i) => {
      const b = bindings[i] as Record<string, unknown>;
      const ids = Array.isArray(b.parameterIds) ? b.parameterIds : [];
      return factorAtDefault(b.keys as unknown[], ids.map(defaultOf));
    });
    indexes.forEach((i, n) => {
      const b = bindings[i] as Record<string, unknown>;
      const others = atDefault.reduce((acc, f, j) => (j === n ? acc : acc * f), 1);
      const keys = (b.keys as unknown[]).map((k) => {
        const f = factorOf(k);
        if (f === null || !isRecord(k) || !isRecord(k.delta)) return k;
        return { ...k, delta: { ...k.delta, opacity: clamp01(base * f * others) } };
      });
      bindings[i] = { ...b, keys, controlsOpacity: true };
    });
    parts[at] = { ...part, opacity: clamp01(base * atDefault.reduce((acc, f) => acc * f, 1)) };
  }
  return { ...json, model: { ...model, parts, bindings } };
}

// ---- 2 → 3: トラッキングの割り当ての設定（I-042） ----

// 2 では、trackingMappings が空なら既定のマッピング、あればその一覧だけを使い、同じパラメータへの割り当ては
// 後の行の値で上書きしていた。trackingSetup の mode をそれに合わせ（空なら standard、あれば custom）、各割り当てに
// weight 1 を足す。同じパラメータへの割り当てが複数あるものは priority にし、それまで効いていた後の行が上に来るよう
// その割り当ての並びを逆にする（ほかの行の位置は変えない）
function trackingSetupFromMappings(json: Record<string, unknown>): Record<string, unknown> {
  const mappings = Array.isArray(json.trackingMappings) ? json.trackingMappings : [];
  const withWeight = mappings.map((m) => (isRecord(m) && m.weight === undefined ? { ...m, weight: 1 } : m));
  const slots = new Map<unknown, number[]>(); // parameterId → 一覧の位置
  withWeight.forEach((m, i) => {
    if (!isRecord(m)) return;
    slots.set(m.parameterId, [...(slots.get(m.parameterId) ?? []), i]);
  });
  const ordered = withWeight.slice();
  const combine: { parameterId: unknown; method: 'priority' }[] = [];
  for (const [parameterId, at] of slots) {
    if (at.length < 2) continue;
    combine.push({ parameterId, method: 'priority' });
    at.forEach((pos, k) => (ordered[pos] = withWeight[at[at.length - 1 - k]!]));
  }
  return {
    ...json,
    trackingMappings: ordered,
    trackingSetup: { mode: mappings.length > 0 ? 'custom' : 'standard', combine },
  };
}

// 変換表を指定できる版（テスト用）。現在の版なら受け取ったものをそのまま返す
export function migrateWith(json: unknown, migrations: Migrations, currentVersion: number): unknown {
  if (!isRecord(json)) throw new ProjectVersionError('プロジェクトがオブジェクトではない');
  const version = json.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ProjectVersionError(`schemaVersion: 1 以上の整数であるべきところが ${JSON.stringify(version)}`);
  }
  if (version > currentVersion) {
    throw new ProjectVersionError(
      `schemaVersion: このアプリより新しい版（${version}）のファイルは開けない。対応している版は ${currentVersion} まで`,
    );
  }
  let current = json;
  for (let v = version; v < currentVersion; v++) {
    const step = migrations[v];
    if (!step) throw new ProjectVersionError(`schemaVersion: 版 ${v} から ${v + 1} への変換が無い`);
    current = { ...step(current), schemaVersion: v + 1 };
  }
  return current;
}

// 古い版を現在の版へ変換する
export function migrate(json: unknown): unknown {
  return migrateWith(json, MIGRATIONS, SCHEMA_VERSION);
}

// 解析 → migrate → validate
export function loadProjectJson(text: string): Project {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new ProjectVersionError(`JSON として読めない: ${e instanceof Error ? e.message : String(e)}`);
  }
  return validateProject(migrate(json));
}
