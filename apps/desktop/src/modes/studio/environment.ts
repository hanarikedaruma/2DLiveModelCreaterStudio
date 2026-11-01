import type { Services } from '@app/contracts';
import type { EnvironmentStore } from '../../shell/environment';
import { armRuntimeOf } from '../../services/arms';
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
    // 腕・手（AT-12）：ミラー・校正・カメラ。校正の保存は Environment.armCalibration へ
    const arms = armRuntimeOf(services.arms);
    arms?.setMirror(env.mirror);
    arms?.setCalibration(env.armCalibration ?? null);
    arms?.setCameraDeviceId(env.cameraDeviceId);
  };
  const off = environment.subscribe(apply);
  const offArms = armRuntimeOf(services.arms)?.onCalibrationChange((armCalibration) =>
    environment.set({ armCalibration }),
  );
  apply();
  return () => {
    off();
    offArms?.();
  };
}
