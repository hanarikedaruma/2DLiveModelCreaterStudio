import type { DeformedModel, HairFrameEvaluator, Services } from '@app/contracts';
import type { Project } from '@app/schema';
import { createHairFrameEvaluator } from '@app/core';

const evaluators = new WeakMap<Services, HairFrameEvaluator>();
export function hairFrames(services: Services): HairFrameEvaluator {
  let evaluator = evaluators.get(services);
  if (!evaluator) {
    evaluator = createHairFrameEvaluator(services.evaluator, services.pipeline);
    evaluators.set(services, evaluator);
  }
  return evaluator;
}
export function hairFrameWarning(project: Project, model: DeformedModel): string {
  const messages: string[] = [];
  for (const guide of project.model.curveGuides ?? []) {
    const result = model.curveGuides?.[guide.id];
    if (!result) continue;
    const name = project.model.parts.find((p) => p.id === guide.partId)?.name ?? '髪';
    const reasons = new Set(
      [
        result.collision?.reason,
        result.dynamics?.reason,
        ...(result.collision?.diagnostics?.map((d) => d.reason) ?? []),
      ].filter(Boolean),
    );
    if (reasons.size) messages.push(`${name}：${[...reasons].join(' ')}`);
  }
  return messages.join('\n');
}
