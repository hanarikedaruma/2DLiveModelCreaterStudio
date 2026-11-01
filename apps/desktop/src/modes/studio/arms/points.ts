// 位置合わせの骨格（AT-11）。推定の点（未反転の画像の0..1）を枠の座標に直す。
// ミラーの反転はここ（displayPoint）の1回だけにする：ON は鏡のように（演者の右手が枠の右）、OFF はカメラから見たまま。
// こうすると、枠の右に出る腕と、モデルが動かす腕（見る人から右に見える腕）が一致する
import type { ArmCalibrationStep } from '@app/contracts';
import type { ArmSide, Vec2 } from '@app/schema';
import type { ActorSide, ArmDiagnostics, DiagnosticPoint } from './service';

export const VISIBLE = 0.5; // Pose の visibility がこれ以上で、枠の中なら見えている（AT-05 と同じ）

export function displayPoint(p: Vec2, mirror: boolean, box: { width: number; height: number }): Vec2 {
  return { x: (mirror ? 1 - p.x : p.x) * box.width, y: p.y * box.height };
}

export function isVisible(p: DiagnosticPoint | null | undefined): p is DiagnosticPoint {
  return (
    !!p &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    p.visibility >= VISIBLE &&
    p.x >= 0 &&
    p.x <= 1 &&
    p.y >= 0 &&
    p.y <= 1
  );
}

// ミラー ON は演者の右手 → モデルの左腕（L）。AT-05 の対応付けと同じ
export function modelSideOf(actor: ActorSide, mirror: boolean): ArmSide {
  return (actor === 'right') === mirror ? 'L' : 'R';
}
export function actorSideOf(side: ArmSide, mirror: boolean): ActorSide {
  return (side === 'L') === mirror ? 'right' : 'left';
}

export type BodyPart = `${ActorSide}${'Shoulder' | 'Elbow' | 'Wrist'}`;
export const BODY_PARTS: BodyPart[] = [
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
];
export const PART_LABEL: Record<BodyPart, string> = {
  leftShoulder: '左肩',
  rightShoulder: '右肩',
  leftElbow: '左肘',
  rightElbow: '右肘',
  leftWrist: '左手首',
  rightWrist: '右手首',
};
const JOINT = { Shoulder: 'shoulder', Elbow: 'elbow', Wrist: 'wrist' } as const;

export function partPoint(diagnostics: ArmDiagnostics | null, part: BodyPart): DiagnosticPoint | null {
  const actor: ActorSide = part.startsWith('left') ? 'left' : 'right';
  const joint = JOINT[part.slice(actor.length) as keyof typeof JOINT];
  return diagnostics?.pose?.[actor][joint] ?? null;
}

// 校正の手順ごとに写っていなければならない点。足りない点で数え始めない（集めた点を確かめるのはサービス）
export const STEP_NEEDS: Record<ArmCalibrationStep, BodyPart[]> = {
  neutral: ['leftShoulder', 'rightShoulder'],
  bend: ['leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist'],
  left: ['leftShoulder', 'rightShoulder', 'leftWrist'],
  right: ['leftShoulder', 'rightShoulder', 'rightWrist'],
};

export function missingParts(step: ArmCalibrationStep, diagnostics: ArmDiagnostics | null): BodyPart[] {
  return STEP_NEEDS[step].filter((part) => !isVisible(partPoint(diagnostics, part)));
}
