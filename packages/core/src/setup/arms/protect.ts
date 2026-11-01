import type { Project } from '@app/schema';
import { armOwnedParts } from '../../joint/evaluate';

// 全体の自動セットアップを再実行しても、確定した腕の素材・基準・キー・親・固定描画順を維持する。
export function preserveArmSetup(before: Project, after: Project): Project {
  if (!before.model.armRigs?.length) return after;
  const armParts = new Set(before.model.armRigs.flatMap((r) => armOwnedParts(before.model, r)));
  const protectedParts = new Set(armParts);
  for (const r of before.model.armRigs) {
    const seen = new Set<string>();
    for (
      let id = r.parentPartId;
      id !== null && !seen.has(id);
      id = before.model.parts.find((p) => p.id === id)?.parentId ?? null
    ) {
      seen.add(id);
      protectedParts.add(id);
    }
  }
  const meshes = new Set(before.model.parts.filter((p) => protectedParts.has(p.id) && p.meshId).map((p) => p.meshId!));
  const warps = new Set(before.model.warps.filter((w) => protectedParts.has(w.partId)).map((w) => w.id));
  const owns = (b: Project['model']['bindings'][number]) =>
    protectedParts.has(b.target.id) || meshes.has(b.target.id) || warps.has(b.target.id);
  const oldParts = new Map(before.model.parts.map((p) => [p.id, p]));
  // 腕以外は新しい標準順を使う。腕の並びを、元の直後の非腕素材を目印に戻す。
  // 新しい後ろ髪を末尾へ送らず、「顔より前」に置いた腕の末尾位置は維持する。
  const liveOrder = new Set(after.model.drawOrder);
  const drawOrder = after.model.drawOrder.filter((id) => !armParts.has(id));
  let floor = 0;
  before.model.drawOrder.forEach((id, index) => {
    if (!armParts.has(id) || !liveOrder.has(id)) return;
    const anchor = before.model.drawOrder
      .slice(index + 1)
      .find((next) => !armParts.has(next) && drawOrder.includes(next));
    const at = Math.max(floor, anchor === undefined ? drawOrder.length : drawOrder.indexOf(anchor));
    drawOrder.splice(at, 0, id);
    floor = at + 1;
  });
  return {
    ...after,
    model: {
      ...after.model,
      armRigs: before.model.armRigs,
      parts: after.model.parts.map((p) => (protectedParts.has(p.id) ? (oldParts.get(p.id) ?? p) : p)),
      meshes: [
        ...after.model.meshes.filter((m) => !meshes.has(m.id)),
        ...before.model.meshes.filter((m) => meshes.has(m.id)),
      ],
      warps: [
        ...after.model.warps.filter((w) => !protectedParts.has(w.partId)),
        ...before.model.warps.filter((w) => protectedParts.has(w.partId)),
      ],
      bindings: [...after.model.bindings.filter((b) => !owns(b)), ...before.model.bindings.filter(owns)],
      drawOrder,
    },
  };
}
