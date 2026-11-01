// 腕の校正の計算と有効性の検査（AT-05）。画面（AT-11）と保存（AT-12）はここで行わない。
// 校正は演者の値だけを持ち、モデルの骨長は入れない。px は未反転の画像のもの。
import type { ArmCalibrationStep, PoseObservation } from '@app/contracts';
import type { ArmCalibration, Vec2 } from '@app/schema';
import { POSE_POINT, distance, poseVisible, shoulderFrame, toPx, type ActorSide, type Image } from './geometry';

export interface CalibrationSample {
  step: ArmCalibrationStep;
  pose: PoseObservation;
  image: Image;
}

export interface CalibrationCamera {
  deviceId: string | null;
  width: number;
  height: number;
  fps: number;
}

export interface CalibrationResult {
  calibration: ArmCalibration | null;
  problems: string[]; // 校正できない・やり直す理由
  // 片手を上げる手順で、演者の実際の左右を確かめた結果（画面で「どちらの手が上がったか」を示す）
  sides: Record<ActorSide, { confirmed: boolean; imageHalf: 'left' | 'right' | null }>;
}

const MIN_FRAMES = 5; // 手順ごとに、使える点がこれだけ無ければ校正しない
// 前腕÷上腕の目安の範囲（人の腕。外れると肘か手首の誤検出）
const LOWER_PER_UPPER = { min: 0.5, max: 1.6 };
// 肩幅に対する腕の長さ（上腕＋前腕）の目安。中立の手首が写っていないときに使う
export const ARM_PER_SHOULDER_WIDTH = 1.4;

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const medianPoint = (points: Vec2[]): Vec2 | null => {
  const x = median(points.map((p) => p.x));
  const y = median(points.map((p) => p.y));
  return x === null || y === null ? null : { x, y };
};

export function computeArmCalibration(samples: CalibrationSample[], camera: CalibrationCamera): CalibrationResult {
  const problems: string[] = [];
  const of = (step: ArmCalibrationStep) => samples.filter((s) => s.step === step);
  const sides: CalibrationResult['sides'] = {
    left: { confirmed: false, imageHalf: null },
    right: { confirmed: false, imageHalf: null },
  };

  // 1. 楽な姿勢：肩の中心・軸・幅、中立の手首
  const lefts: Vec2[] = [];
  const rights: Vec2[] = [];
  const neutral: Record<ActorSide, Vec2[]> = { left: [], right: [] };
  for (const s of of('neutral')) {
    const l = s.pose.landmarks[POSE_POINT.shoulder.left];
    const r = s.pose.landmarks[POSE_POINT.shoulder.right];
    if (!poseVisible(l) || !poseVisible(r)) continue;
    lefts.push(toPx(l, s.image));
    rights.push(toPx(r, s.image));
    for (const side of ['left', 'right'] as const) {
      const w = s.pose.landmarks[POSE_POINT.wrist[side]];
      if (poseVisible(w)) neutral[side].push(toPx(w, s.image));
    }
  }
  const left = medianPoint(lefts);
  const right = medianPoint(rights);
  const frame = left && right && lefts.length >= MIN_FRAMES ? shoulderFrame(left, right) : null;
  if (!frame) problems.push('両肩が写る楽な姿勢を、もう少し長く撮る');
  else if (frame.axis.x <= 0) problems.push('両肩の左右が逆に写っている（後ろ向き・映像の反転）');

  // 2. 肘を軽く曲げる：上腕・前腕の長さ（肘と手首が写っているフレームだけ）
  const arms = {} as Record<ActorSide, { upper: number; lower: number } | null>;
  for (const side of ['left', 'right'] as const) {
    const upper: number[] = [];
    const lower: number[] = [];
    for (const s of of('bend')) {
      const sh = s.pose.landmarks[POSE_POINT.shoulder[side]];
      const el = s.pose.landmarks[POSE_POINT.elbow[side]];
      const wr = s.pose.landmarks[POSE_POINT.wrist[side]];
      if (!poseVisible(sh) || !poseVisible(el) || !poseVisible(wr)) continue;
      upper.push(distance(toPx(sh, s.image), toPx(el, s.image)));
      lower.push(distance(toPx(el, s.image), toPx(wr, s.image)));
    }
    const u = upper.length >= MIN_FRAMES ? median(upper) : null;
    const l = lower.length >= MIN_FRAMES ? median(lower) : null;
    const name = side === 'left' ? '左' : '右';
    if (u === null || l === null) {
      problems.push(`${name}腕の肘と手首が写る姿勢で、肘を軽く曲げる`);
      arms[side] = null;
    } else if (!(u > 0 && l > 0) || l / u < LOWER_PER_UPPER.min || l / u > LOWER_PER_UPPER.max) {
      problems.push(`${name}腕の上腕と前腕の長さの比が人の腕の範囲を外れた（肘か手首の誤検出）`);
      arms[side] = null;
    } else arms[side] = { upper: u, lower: l };
  }

  // 3. 片手ずつ上げる：上げた側の Pose の手首が肩より上にあるか（演者の実際の左右）
  for (const side of ['left', 'right'] as const) {
    let raised = 0;
    let total = 0;
    const xs: number[] = [];
    for (const s of of(side)) {
      const sh = s.pose.landmarks[POSE_POINT.shoulder[side]];
      const wr = s.pose.landmarks[POSE_POINT.wrist[side]];
      if (!poseVisible(sh) || !poseVisible(wr)) continue;
      total++;
      if (wr.y < sh.y) {
        raised++;
        xs.push(wr.x);
      }
    }
    const x = median(xs);
    sides[side] = {
      confirmed: total >= MIN_FRAMES && raised / total >= 0.5,
      imageHalf: x === null ? null : x < 0.5 ? 'left' : 'right',
    };
    if (!sides[side].confirmed)
      problems.push(`${side === 'left' ? '左' : '右'}手だけを上げる手順で、上げた手が確かめられない`);
  }

  if (problems.length || !frame || !arms.left || !arms.right) return { calibration: null, problems, sides };
  const armOf = (side: ActorSide) => {
    const a = arms[side]!;
    const down = { x: frame.down.x * (a.upper + a.lower), y: frame.down.y * (a.upper + a.lower) };
    const origin = side === 'left' ? frame.left : frame.right;
    // 手首が写らない（腕を下ろすと画面の下に出る）ときは、肩から真下に腕の長さだけ下がった位置にする
    const neutralWrist = medianPoint(neutral[side]) ?? { x: origin.x + down.x, y: origin.y + down.y };
    return { upper: a.upper, lower: a.lower, neutralWrist };
  };
  return {
    calibration: {
      version: 1,
      camera: { ...camera },
      shoulderCenter: frame.center,
      shoulderAxis: frame.axis,
      shoulderWidth: frame.width,
      arms: { left: armOf('left'), right: armOf('right') },
    },
    problems,
    sides,
  };
}

// 校正を撮ったカメラの条件と今のカメラが違えば、校正のやり直しを案内する（理由を返す。空なら同じ）
export function calibrationMismatch(
  calibration: ArmCalibration,
  camera: { deviceId: string | null; width: number; height: number },
): string[] {
  const reasons: string[] = [];
  if (calibration.camera.deviceId !== camera.deviceId) reasons.push('カメラが変わった');
  if (calibration.camera.width / calibration.camera.height !== camera.width / camera.height)
    reasons.push('映像の縦横比が変わった');
  else if (calibration.camera.width !== camera.width) reasons.push('映像の解像度が変わった（長さは比で直して使う）');
  return reasons;
}
