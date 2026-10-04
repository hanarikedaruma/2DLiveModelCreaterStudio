import { STANDARD_DRAW_ORDER, type Id, type Model, type Part } from '@app/schema';
import { imageTypeOf } from './standardParts';

// 描画順（背面 → 前面）。標準の画像パーツは STANDARD_DRAW_ORDER の順、
// 標準外の画像パーツは親の直前（手前。親の部分木で最も手前の画像のすぐ前）に入れる
export function computeDrawOrder(model: Model): Id[] {
  const byId = new Map(model.parts.map((p) => [p.id, p]));
  const previous = new Map(model.drawOrder.map((id, i) => [id, i]));
  const images = model.parts.filter((p) => p.kind === 'image');
  // 前の描画順（無ければ parts の順で後ろ）
  const prevRank = (p: Part) => previous.get(p.id) ?? model.drawOrder.length + images.indexOf(p);
  const typeRank = (p: Part) => STANDARD_DRAW_ORDER.indexOf(imageTypeOf(p)!);

  const ancestors = (id: Id): Id[] => {
    const out: Id[] = [];
    const seen = new Set<Id>([id]);
    let parent = byId.get(id)?.parentId ?? null;
    while (parent !== null && !seen.has(parent)) {
      out.push(parent);
      seen.add(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
    return out;
  };

  const order = images
    .filter((p) => imageTypeOf(p) !== null)
    .sort((a, b) => typeRank(a) - typeRank(b) || prevRank(a) - prevRank(b))
    .map((p) => p.id);
  // 親を先に置くので浅いものから
  const free = images
    .filter((p) => imageTypeOf(p) === null)
    .sort((a, b) => ancestors(a.id).length - ancestors(b.id).length || prevRank(a) - prevRank(b));

  for (const part of free) {
    let at = order.length; // 手がかりが無ければ最前面
    for (const anchor of ancestors(part.id)) {
      // anchor 自身かその子孫で、いちばん手前にある画像
      const last = findLastIndex(order, (id) => id === anchor || ancestors(id).includes(anchor));
      if (last >= 0) {
        at = last + 1;
        break;
      }
    }
    order.splice(at, 0, part.id);
  }
  return order;
}

function findLastIndex<T>(items: readonly T[], test: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i]!)) return i;
  return -1;
}

// 描画順を更新する。並びが同じなら同じ参照
export function withDrawOrder(model: Model): Model {
  const drawOrder = computeDrawOrder(model);
  const same = drawOrder.length === model.drawOrder.length && drawOrder.every((id, i) => id === model.drawOrder[i]);
  return same ? model : { ...model, drawOrder };
}
