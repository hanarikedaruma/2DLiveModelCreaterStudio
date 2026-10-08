import type { HairFrameEvaluator, Services } from '@app/contracts';
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
