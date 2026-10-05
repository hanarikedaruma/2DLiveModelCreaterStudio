// 素材の取り込みと標準パーツの割り当てのコマンド（純粋関数）
import { STANDARD_PART_NAMES } from '@app/schema';
import type { Asset, Mesh, Model, Part, Project, Vec2 } from '@app/schema';
import type { Command } from '@app/contracts';
import { assetsCenter, basePart, idSequence, removeParts } from '../structure/modelOps';
import { isAssignableType, type AssignableType } from './slots';

export interface MeshData {
  vertices: Vec2[];
  uvs: Vec2[];
  triangles: [number, number, number][];
}

// 割り当て先の枠。free は「その他」（自由パーツ。partId が null なら新しく作る）
export type SlotTarget =
  { kind: 'standard'; type: AssignableType } | { kind: 'free'; partId: string | null; name: string };

export interface AssignItem {
  assetId: string;
  mesh: MeshData | null; // meshGenerator で作ったもの。作れなければ null（meshId も null になる）
}

// ---- 取り込み ----

// project.assets に足す（同じ id のものは足さない）。PNG の登録（assets.put）はコマンドの外で先に済ませる
export function addAssets(assets: readonly Asset[]): Command {
  return {
    label: '素材の取り込み',
    apply(project) {
      const have = new Set(project.assets.map((a) => a.id));
      const added = assets.filter((a) => !have.has(a.id));
      if (added.length === 0) return project;
      return { ...project, assets: [...project.assets, ...added] };
    },
  };
}

// ---- 枠と素材の対応 ----

// レイヤー名（PNG ならファイル名から拡張子を除いたもの）
export function layerNameOf(asset: Asset): string {
  return asset.source.layerName ?? asset.source.file.replace(/\.[^./\\]+$/, '');
}

export function assetCenter(asset: Asset): Vec2 {
  return { x: asset.offset.x + asset.width / 2, y: asset.offset.y + asset.height / 2 };
}

function parentOf(model: Model, part: Part): Part | undefined {
  return part.parentId === null ? undefined : model.parts.find((p) => p.id === part.parentId);
}

// 「その他」の枠になるパーツ。standardType が null で、根にあるか、変形グループ（かんたんセットアップが作る）の下にある
export function isFreeSlotPart(model: Model, part: Part): boolean {
  if (part.standardType !== null) return false;
  const parent = parentOf(model, part);
  if (!parent) return true;
  return parent.standardType !== null && !isAssignableType(parent.standardType);
}

// 枠のパーツ。標準パーツは同じ standardType の最初のもの
export function findSlotPart(model: Model, target: SlotTarget): Part | undefined {
  if (target.kind === 'standard') return model.parts.find((p) => p.standardType === target.type);
  return target.partId === null ? undefined : model.parts.find((p) => p.id === target.partId);
}

function isSlotPart(model: Model, part: Part): boolean {
  if (part.standardType !== null) {
    return (
      isAssignableType(part.standardType) && model.parts.find((p) => p.standardType === part.standardType) === part
    );
  }
  return isFreeSlotPart(model, part);
}

// 枠に入っている画像パーツ。画像ならそれ自身、グループなら standardType が null の画像の子
export function slotMembers(model: Model, slot: Part): Part[] {
  if (slot.kind === 'image') return slot.assetId ? [slot] : [];
  return model.parts.filter(
    (p) => p.parentId === slot.id && p.kind === 'image' && p.standardType === null && p.assetId !== null,
  );
}

// その素材がどの枠に入っているか
export function findAssignment(model: Model, assetId: string): { slot: Part; member: Part } | null {
  for (const part of model.parts) {
    if (part.kind !== 'image' || part.assetId !== assetId) continue;
    if (isSlotPart(model, part)) return { slot: part, member: part };
    const parent = parentOf(model, part);
    if (parent && parent.kind === 'group' && part.standardType === null && isSlotPart(model, parent)) {
      return { slot: parent, member: part };
    }
  }
  return null;
}

// 「その他」に並べる自由パーツ（素材が1つ以上入っているもの）
export function freeSlotParts(model: Model): Part[] {
  return model.parts.filter((p) => isFreeSlotPart(model, p) && slotMembers(model, p).length > 0);
}

// ---- 割り当て ----

// 枠から1つの画像パーツを外す。グループが空になったらグループも消す
function detach(project: Project, slot: Part, member: Part): Project {
  if (slot.id === member.id) return removeParts(project, [slot.id]);
  const next = removeParts(project, [member.id]);
  return next.model.parts.some((p) => p.parentId === slot.id) ? next : removeParts(next, [slot.id]);
}

function sameSlot(model: Model, a: Part | undefined, target: SlotTarget): boolean {
  return a !== undefined && findSlotPart(model, target)?.id === a.id;
}

// ドロップで枠に素材を入れる。画像パーツを作り、drawOrder の最前面に足す。
// 1つの枠に複数の素材が入ったら、枠をグループ（standardType を持つ）にし、各素材を子の画像パーツ（standardType null、name = レイヤー名）にする。
// ほかの枠に入っている素材は、そこから外して入れ直す（付け替え）
export function assign(
  target: SlotTarget,
  items: readonly AssignItem[],
  options: { label?: string; newId?: () => string } = {},
): Command {
  const ids = idSequence(options.newId);
  return {
    label: options.label ?? '割り当て',
    apply(project) {
      const next = ids();
      const assets = new Map(project.assets.map((a) => [a.id, a]));
      const seen = new Set<string>();
      let p = project;
      const adding: { item: AssignItem; asset: Asset }[] = [];
      for (const item of items) {
        const asset = assets.get(item.assetId);
        if (!asset || seen.has(item.assetId)) continue;
        seen.add(item.assetId);
        const current = findAssignment(p.model, item.assetId);
        if (current && sameSlot(p.model, current.slot, target)) continue;
        if (current) p = detach(p, current.slot, current.member);
        adding.push({ item, asset });
      }
      if (adding.length === 0) return p;

      const model = p.model;
      const slot = findSlotPart(model, target);
      if (target.kind === 'free' && target.partId !== null && !slot) return project;
      const slotName = target.kind === 'standard' ? STANDARD_PART_NAMES[target.type] : target.name;
      const slotType = target.kind === 'standard' ? target.type : null;

      const meshes: Mesh[] = [];
      const image = (asset: Asset, item: AssignItem, fields: Partial<Part>): Part => {
        let meshId: string | null = null;
        if (item.mesh) {
          meshId = next();
          meshes.push({ id: meshId, ...item.mesh, density: 'standard', edited: false });
        }
        return basePart({
          id: next(),
          name: layerNameOf(asset),
          kind: 'image',
          assetId: asset.id,
          meshId,
          pivot: assetCenter(asset),
          blendMode: asset.sourceBlendMode, // PSD の合成モードを引き継ぐ（カード32）
          opacity: asset.sourceOpacity,
          ...fields,
        });
      };

      let parts = model.parts;
      const created: Part[] = [];
      if (!slot && adding.length === 1) {
        const { item, asset } = adding[0]!;
        created.push(image(asset, item, { name: slotName, standardType: slotType }));
        parts = [...parts, ...created];
      } else if (!slot) {
        const groupId = next();
        const group = basePart({
          id: groupId,
          name: slotName,
          kind: 'group',
          standardType: slotType,
          pivot: assetsCenter(adding.map((a) => a.asset)) ?? { x: 0, y: 0 },
        });
        for (const { item, asset } of adding) created.push(image(asset, item, { parentId: groupId }));
        parts = [...parts, group, ...created];
      } else if (slot.kind === 'image') {
        // 画像の枠をグループにする。今の画像は（id を保ったまま）子にする
        const groupId = next();
        const slotAsset = slot.assetId ? assets.get(slot.assetId) : undefined;
        const allAssets = [...(slotAsset ? [slotAsset] : []), ...adding.map((a) => a.asset)];
        const group = basePart({
          id: groupId,
          name: slot.name,
          kind: 'group',
          standardType: slot.standardType,
          parentId: slot.parentId,
          pivot: assetsCenter(allAssets) ?? slot.pivot,
        });
        const child: Part = {
          ...slot,
          parentId: groupId,
          standardType: null,
          name: slotAsset ? layerNameOf(slotAsset) : slot.name,
        };
        for (const { item, asset } of adding) created.push(image(asset, item, { parentId: groupId }));
        const index = parts.indexOf(slot);
        parts = [...parts.slice(0, index), group, child, ...created, ...parts.slice(index + 1)];
      } else {
        for (const { item, asset } of adding) created.push(image(asset, item, { parentId: slot.id }));
        parts = [...parts, ...created];
      }

      return {
        ...p,
        model: {
          ...model,
          parts,
          meshes: meshes.length > 0 ? [...model.meshes, ...meshes] : model.meshes,
          drawOrder: [...model.drawOrder, ...created.map((c) => c.id)],
        },
      };
    },
  };
}

// 割り当ての解除。assetId を省くと枠ごと外す。グループの枠なら、その素材の子だけを外す
export function unassign(target: SlotTarget, assetId?: string): Command {
  return {
    label: '割り当ての解除',
    apply(project) {
      const slot = findSlotPart(project.model, target);
      if (!slot) return project;
      if (assetId === undefined) return removeParts(project, [slot.id]);
      if (slot.kind === 'image') return slot.assetId === assetId ? removeParts(project, [slot.id]) : project;
      const member = slotMembers(project.model, slot).find((m) => m.assetId === assetId);
      return member ? detach(project, slot, member) : project;
    },
  };
}
