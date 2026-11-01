// 解いた後の関節の角速度・角加速度の制限（AT-09）。急な跳びを、止まる手前で減速しながら目標へ近づける
import type { ArmPose } from '@app/schema';

// 試作の開始値。2Hz・振幅30°の手振り（最大 約380°/s・約4700°/s²）は制限に掛からない
export const ARM_RATE = Object.freeze({ maxSpeed: 720, maxAccel: 12000 }); // 度/秒、度/秒²

const KEYS = ['shoulder', 'elbow', 'wrist'] as const;
export const zeroPose = (): ArmPose => ({ shoulder: 0, elbow: 0, wrist: 0 });

// current を target へ dt 秒だけ進める。velocity は書き換える（度/秒）
export function approachPose(current: ArmPose, target: ArmPose, velocity: ArmPose, dt: number): ArmPose {
  if (!(dt > 0)) return { ...current };
  const out = { ...current };
  for (const k of KEYS) {
    const delta = target[k] - current[k];
    // この距離で止まれる速さ（制動距離）と、上限の速さの小さい方
    const want = Math.sign(delta) * Math.min(ARM_RATE.maxSpeed, Math.sqrt(2 * ARM_RATE.maxAccel * Math.abs(delta)));
    let v = Math.max(velocity[k] - ARM_RATE.maxAccel * dt, Math.min(velocity[k] + ARM_RATE.maxAccel * dt, want));
    let next = current[k] + v * dt;
    // 行き過ぎるなら目標で止める
    if ((delta >= 0 && next > target[k]) || (delta <= 0 && next < target[k])) {
      next = target[k];
      v = delta / dt;
      if (Math.abs(v) > ARM_RATE.maxSpeed) v = Math.sign(v) * ARM_RATE.maxSpeed;
    }
    out[k] = next;
    velocity[k] = v;
  }
  return out;
}

export function lerpPose(a: ArmPose, b: ArmPose, t: number): ArmPose {
  const u = Math.min(1, Math.max(0, t));
  return {
    shoulder: a.shoulder + (b.shoulder - a.shoulder) * u,
    elbow: a.elbow + (b.elbow - a.elbow) * u,
    wrist: a.wrist + (b.wrist - a.wrist) * u,
  };
}

// 始まりと終わりをなめらかにする（smoothstep）
export const ease = (t: number): number => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

// 度の差を -180〜180 にする
export const wrapDegrees = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
