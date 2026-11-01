// 開くときに直すもの（STEP3 のカード58）。検証は通るが、参照が切れているもの
import { defaultArmTrackingSettings, inspectArmRigs, type Project } from '@app/schema';

export interface RepairResult {
  project: Project;
  repairs: string[]; // 人に見せる文。直さなかったら空
}

// 出力先のパラメータが無い物理を外す（I-027。前の版ではパラメータを消しても物理が残った）。
// 外した物理を指すパーツの physicsId も外す
export function repairProject(project: Project): RepairResult {
  const repairs: string[] = [];
  const armIssues = inspectArmRigs(project.model).filter((i) => i.severity === 'error');
  if (armIssues.length) {
    const invalid = new Set(armIssues.map((i) => i.rigId));
    const sides = new Set(armIssues.map((i) => i.side));
    const settings = project.armTracking ?? defaultArmTrackingSettings();
    const rigs = project.model.armRigs!.map((r) => (invalid.has(r.id) && r.enabled ? { ...r, enabled: false } : r));
    const changed =
      rigs.some((r, i) => r !== project.model.armRigs![i]) || [...sides].some((s) => settings.sides[s].enabled);
    if (changed) {
      for (const side of sides)
        repairs.push(
          `腕 ${side} を無効にした: ${[...new Set(armIssues.filter((i) => i.side === side).map((i) => i.message))].join('・')}`,
        );
      project = {
        ...project,
        model: { ...project.model, armRigs: rigs },
        ...(project.armTracking
          ? {
              armTracking: {
                ...settings,
                sides: {
                  L: sides.has('L') ? { ...settings.sides.L, enabled: false } : settings.sides.L,
                  R: sides.has('R') ? { ...settings.sides.R, enabled: false } : settings.sides.R,
                },
              },
            }
          : {}),
      };
    }
  }
  if (project.armTracking) {
    const settings = project.armTracking;
    for (const side of ['L', 'R'] as const) {
      if (settings.sides[side].enabled && !project.model.armRigs?.some((r) => r.side === side && r.enabled)) {
        repairs.push(`使用できるリグが無い腕 ${side} の追従をOFFにした`);
        project = {
          ...project,
          armTracking: {
            ...project.armTracking!,
            sides: { ...project.armTracking!.sides, [side]: { ...settings.sides[side], enabled: false } },
          },
        };
      }
    }
  }
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
  // 輪郭線（I-068）: 対象の画像パーツが無い線を外し、一緒に動かすパーツから無いものを外す
  if (project.model.contourLines) {
    const images = new Set(project.model.parts.filter((p) => p.kind === 'image').map((p) => p.id));
    const lines = project.model.contourLines.filter((l) => images.has(l.partId));
    if (lines.length !== project.model.contourLines.length)
      repairs.push(`対象が無い輪郭線 ${project.model.contourLines.length - lines.length} 本を外した`);
    const fixed = lines.map((l) => {
      if (l.withPartIds.every((id) => images.has(id))) return l;
      repairs.push(`輪郭線の一緒に動かすパーツから、無いパーツを外した（${l.name}）`);
      return { ...l, withPartIds: l.withPartIds.filter((id) => images.has(id)) };
    });
    if (fixed.length !== project.model.contourLines.length || fixed.some((l, i) => l !== lines[i]))
      project = { ...project, model: { ...project.model, contourLines: fixed } };
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
