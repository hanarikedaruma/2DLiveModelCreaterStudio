// AT-05: 観測の正規化と、演者・左右の対応付け、腕の校正の計算
export {
  ASSOCIATION,
  BodyAssociationImpl,
  createBodyAssociation,
  type AssociationDiagnostics,
  type BodyAssociationOptions,
} from './association';
export {
  ARM_PER_SHOULDER_WIDTH,
  calibrationMismatch,
  computeArmCalibration,
  type CalibrationCamera,
  type CalibrationResult,
  type CalibrationSample,
} from './calibration';
export type { ActorSide } from './geometry';
