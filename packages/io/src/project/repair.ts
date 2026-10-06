// 開くときに直すもの（STEP3 のカード58）。検証は通るが、参照が切れているもの
import type { Project } from '@app/schema';

export interface RepairResult {
  project: Project;
  repairs: string[]; // 人に見せる文。直さなかったら空
}

// 出力先のパラメータが無い物理を外す（I-027。前の版ではパラメータを消しても物理が残った）。
// 外した物理を指すパーツの physicsId も外す
export function repairProject(project: Project): RepairResult {
  const parameterIds = new Set(project.model.parameters.map((p) => p.id));
  const dangling = project.physics.filter((ph) => !parameterIds.has(ph.outputParameterId));
  if (dangling.length === 0) return { project, repairs: [] };

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
    repairs: [`出力先のパラメータが無い物理 ${dangling.length} 個を外した（${names}）`],
  };
}
