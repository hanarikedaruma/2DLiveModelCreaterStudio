// 腕・手の画面（AT-11）の言葉
import type {
  ArmFollowState,
  ArmLimitReason,
  ArmMotionStatus,
  BodyFeatureState,
  ObservationValidity,
} from '@app/contracts';
import type { ArmSide, HandShape } from '@app/schema';
import { actorSideOf } from './points';

export const SHAPE_LABEL: Record<HandShape, string> = { open: 'パー', fist: 'グー', point: '指さし', peace: 'ピース' };

export const FOLLOW_LABEL: Record<ArmFollowState, string> = {
  off: 'オフ',
  tracking: '追従中',
  inferred: '肘を補っている',
  holding: '手を見失っている（保持）',
  returning: '休止へ戻っている',
  rest: '休止中',
  recovering: '戻ってきた腕に合わせている',
  unavailable: '使えない',
};
export const HAND_STATE_LABEL: Record<ArmMotionStatus['handState'], string> = {
  tracking: '手形を追従',
  holding: '手形を保持',
  rest: '休止時の形',
  fixed: '固定',
};
export const LIMIT_LABEL: Record<ArmLimitReason, string> = {
  shoulder: '肩の範囲',
  elbow: '肘の範囲',
  wrist: '手首の範囲',
  forearm: '前腕の向きの範囲',
  hand: '手の向きの範囲',
  unreachable: '届かない',
  'invalid-input': '入力が正しくない',
  'invalid-rig': '腕の設定が正しくない',
};
export const FEATURE_LABEL: Record<BodyFeatureState, string> = {
  off: 'オフ',
  loading: '準備中',
  ready: '動いている',
  unavailable: '使えない',
  error: 'エラー',
};
export const VALIDITY_LABEL: Record<ObservationValidity, string> = {
  valid: '見えている',
  inferred: '補った',
  missing: '見えない',
  ambiguous: '左右が決まらない',
};

// 「左腕（あなたの右手）」。左右はモデルの左右、括弧はミラーに合わせてどちらの手で動くか
export function sideTitle(side: ArmSide, mirror: boolean): string {
  return `${side === 'L' ? '左腕' : '右腕'}（あなたの${actorSideOf(side, mirror) === 'right' ? '右手' : '左手'}）`;
}

export function statusLine(motion: ArmMotionStatus): string {
  if (motion.state === 'off' || motion.state === 'unavailable') return FOLLOW_LABEL[motion.state];
  const hand = motion.hand ? `・${SHAPE_LABEL[motion.hand]}` : '';
  return `${FOLLOW_LABEL[motion.state]}${hand}（${HAND_STATE_LABEL[motion.handState]}）`;
}
