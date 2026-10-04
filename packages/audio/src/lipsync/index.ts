// カード37: 音量のリップシンク。公開するものだけをここから export する
export {
  createLipSyncProducer,
  mouthOpenFromLevel,
  smoothMouthOpen,
  DEFAULT_LIP_SYNC_CONFIG,
  LIP_SYNC_ATTACK_MS,
  LIP_SYNC_RANGE_DB,
  LIP_SYNC_RELEASE_MS,
  LIP_SYNC_STRENGTH_RATES,
  type AudioLipSyncProducer,
  type LipSyncConfig,
  type LipSyncStrength,
  type MouthSource,
} from './lipSync';
