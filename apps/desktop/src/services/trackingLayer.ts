// トラッキングのレイヤー（カード24）。プロジェクトの parameters・trackingMappings が変わったら作り直す。
// 作り直しても、ミラー・外れたときの動き・キャリブレーション・プリセット・目の追従の設定（STEP1）は引き継ぐ
import type { Environment, Parameter, Project, TrackingMapping } from '@app/schema';
import type { Layer, TrackingFrame, TrackingLayerProducer } from '@app/contracts';

export type TrackingLayerFactory = (parameters: Parameter[], mappings?: TrackingMapping[]) => TrackingLayerProducer;

export function createProjectTrackingLayer(
  store: { get(): Project; subscribe(listener: (project: Project) => void): () => void },
  create: TrackingLayerFactory,
): TrackingLayerProducer {
  let mirror = true;
  let lostBehavior: 'returnToFront' | 'hold' = 'returnToFront';
  let calibration: Environment['calibration'] = null;
  let preset: Parameters<TrackingLayerProducer['setPreset']> = ['standard'];
  let eyeTracking = true;
  let parameters = store.get().model.parameters;
  let mappings = store.get().trackingMappings;

  const build = () => {
    const layer = create(parameters, mappings);
    layer.setMirror(mirror);
    layer.setLostBehavior(lostBehavior);
    layer.setCalibration(calibration);
    layer.setPreset(...preset);
    layer.setEyeTracking(eyeTracking);
    return layer;
  };
  let inner = build();

  store.subscribe((project) => {
    if (project.model.parameters === parameters && project.trackingMappings === mappings) return;
    parameters = project.model.parameters;
    mappings = project.trackingMappings;
    inner = build();
  });

  return {
    update: (frame: TrackingFrame) => inner.update(frame),
    tick: (now: number): Layer => inner.tick(now),
    status: () => inner.status(),
    setMirror(on) {
      mirror = on;
      inner.setMirror(on);
    },
    setLostBehavior(b) {
      lostBehavior = b;
      inner.setLostBehavior(b);
    },
    setCalibration(c) {
      calibration = c;
      inner.setCalibration(c);
    },
    setPreset(p, custom) {
      preset = [p, custom];
      inner.setPreset(p, custom);
    },
    setEyeTracking(on) {
      eyeTracking = on;
      inner.setEyeTracking(on);
    },
  };
}
