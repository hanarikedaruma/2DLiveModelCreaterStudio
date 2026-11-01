// 腕の追従の準備が足りない項目（AT-11）。該当するものを全て返す（1つ直すと次が見える、にしない）。
// block は追従できない理由、advice はできるが勧めること、note は知らせるだけ
import type { ArmServiceStatus } from '@app/contracts';
import type { ArmCalibration, ArmRig, ArmSide, ArmTrackingSettings } from '@app/schema';
import { calibrationMismatch } from '@app/tracking';

export type ReadinessLevel = 'block' | 'advice' | 'note';
export interface ReadinessItem {
  id: string;
  level: ReadinessLevel;
  side?: ArmSide;
  text: string;
  action?: 'calibrate';
}
export interface ReadinessInput {
  status: ArmServiceStatus;
  settings: ArmTrackingSettings;
  calibration: ArmCalibration | null;
  rigs: readonly ArmRig[];
  camera: { deviceId: string | null; width: number; height: number } | null; // 今のカメラ（開始していなければ null）
  faceMappingOff: boolean; // 顔のトラッキングの割り当てが「無効」
}

export const SIDE_LABEL: Record<ArmSide, string> = { L: '左腕', R: '右腕' };
const SIDES: ArmSide[] = ['L', 'R'];
const reasonText = (reason: string | null) => (reason ? `（${reason}）` : '');

export function armReadiness(input: ReadinessInput): ReadinessItem[] {
  const { status, settings } = input;
  const items: ReadinessItem[] = [];
  if (!status.available)
    items.push({ id: 'unavailable', level: 'block', text: `腕の認識を使えない${reasonText(status.reason)}` });
  const enabled = SIDES.filter((side) => settings.sides[side].enabled);
  if (enabled.length === 0) return items;

  const pose = status.tracking.pose;
  if (status.available && (pose.state === 'unavailable' || pose.state === 'error'))
    items.push({ id: 'pose', level: 'block', text: `腕の認識を使えない${reasonText(pose.reason)}` });
  else if (pose.state === 'off')
    items.push({
      id: 'camera',
      level: 'advice',
      text: 'カメラのトラッキングを開始すると腕が動く（トラッキングの［開始］）',
    });
  else if (pose.state === 'loading') items.push({ id: 'loading', level: 'advice', text: '腕の認識を準備している' });

  for (const side of enabled) {
    const label = SIDE_LABEL[side];
    const rig = input.rigs.find((r) => r.side === side);
    const issues = status.rigIssues.filter((i) => i.side === side);
    const errors = issues.filter((i) => i.severity === 'error');
    if (!rig) {
      items.push({
        id: `rig-${side}`,
        level: 'block',
        side,
        text: `${label}：モデルに腕の設定が無い（モデリングの「腕の設定」で作る）`,
      });
      continue;
    }
    for (const [n, issue] of errors.entries())
      items.push({ id: `rig-${side}-error-${n}`, level: 'block', side, text: `${label}：${issue.message}` });
    if (!rig.enabled && errors.length === 0)
      items.push({ id: `rig-${side}-off`, level: 'block', side, text: `${label}：モデルの腕の設定が無効になっている` });
    for (const [n, issue] of issues.filter((i) => i.severity === 'warning').entries())
      items.push({ id: `rig-${side}-warning-${n}`, level: 'advice', side, text: `${label}：${issue.message}` });
  }

  const hands = status.tracking.hands;
  if (hands.state === 'unavailable' || hands.state === 'error')
    items.push({
      id: 'hands',
      level: 'advice',
      text: `手の認識を使えない${reasonText(hands.reason)}。手形は休止時の形のまま`,
    });
  else if (hands.state === 'off' && pose.state === 'ready')
    items.push({ id: 'hands', level: 'advice', text: '手の認識がオフ。手形は休止時の形のまま' });

  if (status.calibration.state === 'invalid')
    items.push({
      id: 'calibration-invalid',
      level: 'advice',
      text: `腕の校正に失敗した${reasonText(status.calibration.reason)}`,
      action: 'calibrate',
    });
  if (!input.calibration) {
    items.push({
      id: 'calibration',
      level: 'advice',
      text: '腕を校正していない（しなくても動くが、腕の長さは目安になる）',
      action: 'calibrate',
    });
  } else if (input.camera) {
    const reasons = calibrationMismatch(input.calibration, input.camera);
    // 縦横比が同じで解像度だけ違うなら、長さを比で直して使えるので知らせるだけ
    const needed = reasons.some((r) => !r.startsWith('映像の解像度'));
    if (reasons.length)
      items.push({
        id: 'calibration-camera',
        level: needed ? 'advice' : 'note',
        text: `カメラが校正のときと違う（${reasons.join('・')}）`,
        action: needed ? 'calibrate' : undefined,
      });
  }
  if (input.faceMappingOff)
    items.push({ id: 'face-off', level: 'note', text: '顔のトラッキングの割り当ては無効。腕は左右の設定で動く' });
  return items;
}
