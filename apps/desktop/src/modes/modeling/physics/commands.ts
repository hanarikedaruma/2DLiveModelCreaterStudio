// 物理のオン・オフ・揺れのキーの作り直し・値の変更のコマンド（カード50）。どれも1回の Undo。
// id は呼ぶ側で newId() を渡す（apply を純粋にするため）
import {
  PARAMETER_GROUPS,
  STANDARD_PARAMETERS,
  type Model,
  type Parameter,
  type Part,
  type Physics,
  type Project,
  type StandardPartType,
} from '@app/schema';
import type { Command } from '@app/contracts';
import { DEFAULT_STRENGTH, PHYSICS_PRESETS } from './presets';
import { isAutoSwayBinding, withSwayBindings, type SwayBindingIds } from './sway';

export const SWAY_PARAMETER_PREFIX = 'Sway_';
export const SWAY_GROUP_ID = 'sway';

// 標準の髪の部位が使う揺れパラメータ（標準パラメータ）
export const HAIR_SWAY_PARAMETERS: Partial<Record<StandardPartType, string>> = {
  frontHair: 'HairFront',
  sideHairL: 'HairSide',
  sideHairR: 'HairSide',
  backHair: 'HairBack',
};

export interface EnablePhysicsIds extends SwayBindingIds {
  physics: string;
}

// パーツの揺れパラメータの id（標準の髪なら HairFront など、ほかは Sway_<partId>）
export function swayParameterIdFor(part: Pick<Part, 'id' | 'standardType'>): string {
  return (part.standardType && HAIR_SWAY_PARAMETERS[part.standardType]) ?? `${SWAY_PARAMETER_PREFIX}${part.id}`;
}

// パーツの物理の項目（part.physicsId、無ければ partId で探す）
export function physicsOfPart(project: Project, partId: string): Physics | undefined {
  const part = project.model.parts.find((p) => p.id === partId);
  if (!part) return undefined;
  return (
    (part.physicsId !== null ? project.physics.find((ph) => ph.id === part.physicsId) : undefined) ??
    project.physics.find((ph) => ph.partId === partId)
  );
}

// 画像パーツの基準の形の上端と下端（メッシュがあれば頂点、無ければ素材）。どちらも無ければ null
function imageSpan(project: Project, part: Part): { top: number; bottom: number } | null {
  const mesh = part.meshId !== null ? project.model.meshes.find((m) => m.id === part.meshId) : undefined;
  if (mesh && mesh.vertices.length > 0) {
    const ys = mesh.vertices.map((v) => v.y);
    return { top: Math.min(...ys), bottom: Math.max(...ys) };
  }
  const asset = part.assetId !== null ? project.assets.find((a) => a.id === part.assetId) : undefined;
  return asset ? { top: asset.offset.y, bottom: asset.offset.y + asset.height } : null;
}

// パーツの高さ（px。Physics.length に入れる）。グループは子孫の画像パーツをまとめた高さ（基準状態）。分からなければ 0
export function partHeight(project: Project, part: Part): number {
  const { parts } = project.model;
  let top = Infinity;
  let bottom = -Infinity;
  const stack = [part];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const p = stack.pop()!;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    if (p.kind === 'group') {
      stack.push(...parts.filter((c) => c.parentId === p.id));
      continue;
    }
    const span = imageSpan(project, p);
    if (!span) continue;
    top = Math.min(top, span.top);
    bottom = Math.max(bottom, span.bottom);
  }
  const height = bottom - top;
  return Number.isFinite(height) && height > 0 ? height : 0;
}

// 揺れパラメータの表示名（ほかのパラメータと重ならないように番号を付ける）
function swayParameterName(model: Model, part: Part): string {
  const base = `揺れ ${part.name}`;
  const names = new Set(model.parameters.map((p) => p.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

// 揺れパラメータが無ければ足す（−1..1・デフォルト 0・グループ 'sway'。標準の髪は標準パラメータの表から）
function withSwayParameter(model: Model, part: Part, parameterId: string): Model {
  if (model.parameters.some((p) => p.id === parameterId)) return model;
  const standard = STANDARD_PARAMETERS.find((p) => p.id === parameterId);
  const parameter: Parameter = standard
    ? { ...standard }
    : {
        id: parameterId,
        name: swayParameterName(model, part),
        groupId: SWAY_GROUP_ID,
        min: -1,
        max: 1,
        default: 0,
        standard: false,
      };
  const hasGroup = model.parameterGroups.some((g) => g.id === parameter.groupId);
  const group = PARAMETER_GROUPS.find((g) => g.id === parameter.groupId);
  return {
    ...model,
    parameters: [...model.parameters, parameter],
    parameterGroups: hasGroup || !group ? model.parameterGroups : [...model.parameterGroups, { ...group }],
  };
}

function withPhysicsId(model: Model, partId: string, physicsId: string | null): Model {
  const index = model.parts.findIndex((p) => p.id === partId);
  const part = model.parts[index];
  if (!part || part.physicsId === physicsId) return model;
  const parts = model.parts.slice();
  parts[index] = { ...part, physicsId };
  return { ...model, parts };
}

// [揺らす] をオンにする。揺れパラメータ・Physics の項目（髪のプリセット）・揺れのバインディングを作る。
// すでに物理があるパーツには何もしない
export function enablePhysicsCommand(partId: string, ids: EnablePhysicsIds): Command {
  return {
    label: '揺らす',
    apply(project) {
      const part = project.model.parts.find((p) => p.id === partId);
      if (
        !part ||
        physicsOfPart(project, partId) ||
        project.model.curveGuides?.some((g) => g.partId === partId && g.enabled && g.gravity)
      )
        return project;
      const parameterId = swayParameterIdFor(part);
      const item: Physics = {
        id: ids.physics,
        partId,
        preset: 'hair',
        strength: DEFAULT_STRENGTH,
        direction: 'horizontal',
        length: partHeight(project, part),
        ...PHYSICS_PRESETS.hair,
        inputs: [], // 空なら物理演算の既定の入力（顔・体の角度）
        outputParameterId: parameterId,
      };
      let model = withSwayParameter(project.model, part, parameterId);
      model = withSwayBindings(model, part, parameterId, ids);
      model = withPhysicsId(model, partId, item.id);
      return { ...project, model, physics: [...project.physics, item] };
    },
  };
}

// 揺れのキーを今のピボット・メッシュで作り直す（自動で作ったものだけ。手で直したものは残す）
export function rebuildSwayCommand(partId: string, ids: SwayBindingIds): Command {
  return {
    label: '揺れのキーを作り直す',
    apply(project) {
      const part = project.model.parts.find((p) => p.id === partId);
      const item = physicsOfPart(project, partId);
      if (!part || !item) return project;
      const model = withSwayBindings(project.model, part, item.outputParameterId, ids);
      return model === project.model ? project : { ...project, model };
    },
  };
}

// パラメータがどこかで使われているか（バインディング・物理の入力と出力・トラッキング・表情・アニメーション・
// ホットキー・母音の値）
export function isParameterUsed(project: Project, id: string): boolean {
  const { model } = project;
  return (
    model.bindings.some((b) => b.parameterIds.includes(id)) ||
    project.physics.some((ph) => ph.outputParameterId === id || ph.inputs.some((x) => x.parameterId === id)) ||
    project.trackingMappings.some((m) => m.parameterId === id) ||
    project.expressions.some((e) => e.entries.some((x) => x.parameterId === id)) ||
    project.animations.some((a) => a.tracks.some((t) => t.parameterId === id)) ||
    project.studio.hotkeys.some((h) => h.action === 'parameter' && h.targetId === id) ||
    model.lipSync.vowels.some((v) => Object.hasOwn(v.values, id))
  );
}

// [揺らす] をオフにする。パーツの Physics の項目と、自動で作った揺れのバインディングを消す。
// 揺れパラメータ（Sway_<partId>）は、ほかで使っていなければ消す（標準パラメータは残す）
export function disablePhysicsCommand(partId: string): Command {
  return {
    label: '揺らさない',
    apply(project) {
      const part = project.model.parts.find((p) => p.id === partId);
      if (!part) return project;
      const items = project.physics.filter((ph) => ph.partId === partId || ph.id === part.physicsId);
      if (items.length === 0 && part.physicsId === null) return project;
      const outputs = new Set(items.map((ph) => ph.outputParameterId));
      const removing = new Set(items.map((ph) => ph.id));
      let model: Model = {
        ...project.model,
        bindings: project.model.bindings.filter((b) => ![...outputs].some((id) => isAutoSwayBinding(b, part, id))),
      };
      model = withPhysicsId(model, partId, null);
      let next: Project = { ...project, model, physics: project.physics.filter((ph) => !removing.has(ph.id)) };
      const swayId = `${SWAY_PARAMETER_PREFIX}${partId}`;
      const sway = next.model.parameters.find((p) => p.id === swayId && !p.standard);
      if (sway && !isParameterUsed(next, swayId)) {
        next = { ...next, model: { ...next.model, parameters: next.model.parameters.filter((p) => p !== sway) } };
      }
      return next;
    },
  };
}

// Physics の項目を fn で変える。変わらなければ何もしない
export function updatePhysicsCommand(label: string, physicsId: string, fn: (item: Physics) => Physics): Command {
  return {
    label,
    apply(project) {
      const index = project.physics.findIndex((ph) => ph.id === physicsId);
      const item = project.physics[index];
      if (!item) return project;
      const next = fn(item);
      if (next === item) return project;
      const physics = project.physics.slice();
      physics[index] = next;
      return { ...project, physics };
    },
  };
}

// 値の一部を変える（同じ値なら同じ項目を返す）
export function patchPhysics(item: Physics, patch: Partial<Omit<Physics, 'id' | 'partId'>>): Physics {
  const changed = (Object.keys(patch) as (keyof typeof patch)[]).some((k) => !Object.is(item[k], patch[k]));
  return changed ? { ...item, ...patch } : item;
}
