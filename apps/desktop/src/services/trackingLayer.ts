// トラッキングのレイヤー（カード24）。プロジェクトの parameters・trackingMappings・trackingSetup が変わったら作り直す。
// 作り直しても、ミラー・外れたときの動き・キャリブレーション・プリセット・目の追従の設定（STEP1）は引き継ぐ
import type { Environment, Parameter, Project, TrackingMapping, TrackingSetup } from '@app/schema';
import type { Layer, TrackingFrame, TrackingLayerProducer } from '@app/contracts';

// mappings が無ければ既定のマッピング、空なら何も動かさない。combine は同じパラメータへの割り当ての合わせ方（I-042）
export type TrackingLayerFactory = (
  parameters: Parameter[],
  mappings?: TrackingMapping[],
  combine?: TrackingSetup['combine'],
) => TrackingLayerProducer;

// trackingSetup.mode に合わせた割り当て（standard = 既定（undefined）、custom = 一覧、off = 空）
export function mappingsOf(project: Project): TrackingMapping[] | undefined {
  const { mode } = project.trackingSetup;
  if (mode === 'standard') return undefined;
  return mode === 'custom' ? project.trackingMappings : [];
}

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
  let setup = store.get().trackingSetup;

  const build = (project: Project) => {
    const layer = create(project.model.parameters, mappingsOf(project), project.trackingSetup.combine);
    layer.setMirror(mirror);
    layer.setLostBehavior(lostBehavior);
    layer.setCalibration(calibration);
    layer.setPreset(...preset);
    layer.setEyeTracking(eyeTracking);
    return layer;
  };
  let inner = build(store.get());

  store.subscribe((project) => {
    if (
      project.model.parameters === parameters &&
      project.trackingMappings === mappings &&
      project.trackingSetup === setup
    )
      return;
    parameters = project.model.parameters;
    mappings = project.trackingMappings;
    setup = project.trackingSetup;
    inner = build(project);
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
