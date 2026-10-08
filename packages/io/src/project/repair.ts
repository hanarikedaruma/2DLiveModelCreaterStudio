// 開くときに直すもの（STEP3 のカード58）。検証は通るが、参照が切れているもの
import type { Project } from '@app/schema';

export interface RepairResult {
  project: Project;
  repairs: string[]; // 人に見せる文。直さなかったら空
}

// 出力先のパラメータが無い物理を外す（I-027。前の版ではパラメータを消しても物理が残った）。
// 外した物理を指すパーツの physicsId も外す
export function repairProject(project: Project): RepairResult {
  const repairs: string[] = [];
  const colliders = project.model.shoulderColliders?.filter(
    (c) =>
      project.model.parts.some((p) => p.id === c.partId && p.kind === 'image' && p.meshId === c.meshId) &&
      project.model.meshes.some((m) => m.id === c.meshId),
  );
  if (colliders && colliders.length !== project.model.shoulderColliders!.length) {
    repairs.push(`取付先が無い肩の線 ${project.model.shoulderColliders!.length - colliders.length} 本を外した`);
    project = { ...project, model: { ...project.model, shoulderColliders: colliders } };
  }
  const colliderIds = new Set((colliders ?? []).map((c) => c.id));
  const repairedGuides = project.model.curveGuides?.map((g) => {
    if (!g.collision || g.collision.colliderIds.every((id) => colliderIds.has(id))) return g;
    repairs.push(`流れ線の肩の指定から、存在しない線を外した（${g.id}）`);
    return {
      ...g,
      collision: { ...g.collision, colliderIds: g.collision.colliderIds.filter((id) => colliderIds.has(id)) },
    };
  });
  if (repairedGuides?.some((g, i) => g !== project.model.curveGuides![i]))
    project = { ...project, model: { ...project.model, curveGuides: repairedGuides } };
  const validGuides = project.model.curveGuides?.filter(
    (g) =>
      project.model.parts.some((p) => p.id === g.partId && p.kind === 'image' && p.meshId === g.meshId) &&
      project.model.meshes.some((m) => m.id === g.meshId),
  );
  if (validGuides && validGuides.length !== project.model.curveGuides!.length) {
    repairs.push(`対象が無い流れ線 ${project.model.curveGuides!.length - validGuides.length} 本を外した`);
    project = { ...project, model: { ...project.model, curveGuides: validGuides } };
  }
  const parameterIds = new Set(project.model.parameters.map((p) => p.id));
  const repairedPhysics = project.physics.map((ph) => {
    if (!ph.verticalOutputParameterId || parameterIds.has(ph.verticalOutputParameterId)) return ph;
    repairs.push(`上下の出力先が無い物理の指定を外した（${ph.id}）`);
    return { ...ph, verticalOutputParameterId: null };
  });
  if (repairedPhysics.some((ph, i) => ph !== project.physics[i])) project = { ...project, physics: repairedPhysics };
  const dangling = project.physics.filter((ph) => !parameterIds.has(ph.outputParameterId));
  if (dangling.length === 0) return { project, repairs };

  const removed = new Set(dangling.map((ph) => ph.id));
  const parts = project.model.parts.map((part) =>
    part.physicsId !== null && removed.has(part.physicsId) ? { ...part, physicsId: null } : part,
  );
  const partName = (id: string) => project.model.parts.find((p) => p.id === id)?.name ?? id;
  const names = dangling.map((ph) => partName(ph.partId)).join('・');
  return {
    project: {
      ...project,
      physics: project.physics.filter((ph) => !removed.has(ph.id)),
      model: { ...project.model, parts },
    },
    repairs: [...repairs, `出力先のパラメータが無い物理 ${dangling.length} 個を外した（${names}）`],
  };
}
