// カード16: マッピング・スムージング・外れたときの復帰。公開するものだけをここから export する
export { createTrackingLayerProducer, type TrackingLayerOptions } from './producer';
export { createDefaultTrackingMappings } from './defaults';
export { mapTrackingValue } from './map';
export { OneEuroFilter, ONE_EURO_DEFAULTS, smoothingToMinCutoff, type OneEuroParams } from './oneEuro';
// カード35: キャリブレーションの当て方と、動きの簡易設定（プリセット）
export {
  applyCalibration,
  normalizeCalibration,
  MAX_EYE_CLOSED,
  MIN_MOUTH_OPEN_MAX,
  type TrackingCalibration,
} from './calibrate';
export {
  TRACKING_PRESETS,
  UNTUNED_TRACKING,
  CENTERED_TRACKING_INPUTS,
  resolveTrackingTuning,
  type TrackingTuning,
  type TrackingPreset,
  type TrackingPresetName,
} from './presets';
