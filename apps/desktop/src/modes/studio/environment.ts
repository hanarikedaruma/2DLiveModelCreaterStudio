import type { Services } from '@app/contracts';
import type { EnvironmentStore } from '../../shell/environment';
import { expressionBinding } from './expressions/binding';
import { bodyFollowBinding } from './producers/bodyFollow';
import { studioRuntime } from './runtime';

export function bindStudioEnvironment(services: Services, environment: EnvironmentStore): () => void {
  const apply = () => {
    const env = environment.get();
    services.tracking.configureCapture(env.cameraCapture);
    services.trackingLayer.setMirror(env.mirror);
    services.trackingLayer.setCalibration(env.calibration);
    services.trackingLayer.setPreset(env.trackingPreset, env.trackingCustom);
    services.trackingLayer.setEyeTracking(env.eyeTracking);
    studioRuntime.setAutoBlink(env.autoBlink); // STEP3 のカード66
    bodyFollowBinding.bind(services.bodyFollow);
    bodyFollowBinding.setStrength(env.bodyFollowStrength);
    expressionBinding.setMode(env.expressionMode);
  };
  const off = environment.subscribe(apply);
  apply();
  return off;
}
