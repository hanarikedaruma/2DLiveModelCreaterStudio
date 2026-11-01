// AT-12: 腕のサービス（体の推定→対応付け→手形→追従）と、スタジオの実行部へつなぐ口
export {
  armRuntimeOf,
  createArmService,
  CALIBRATION_COLLECT_MS,
  CALIBRATION_TIMEOUT_MS,
  type ArmRuntime,
  type ArmServiceDeps,
  type ArmServiceWithRuntime,
} from './service';
