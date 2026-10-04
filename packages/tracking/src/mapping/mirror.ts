import type { TrackingFrame } from '@app/contracts';
import type { TrackingInput } from '@app/schema';

// ミラーを当てたあとの入力の値。キャラクターの向き・左右にそろえた値で、既定では同じ名前のパラメータへ写す。
// オン（鏡のように映す）: yaw・roll・eyeBallX はそのまま。左右の目を入れ替える（ユーザーの右目 → eyeOpenL）
// オフ: yaw・roll・eyeBallX の符号を反転する。目は入れ替えない
// 口の形・口の横幅・眉（STEP1）は左右の平均なので、ミラーによらずそのまま。フレームに無い（undefined の）入力は入れない
export function trackingInputs(frame: TrackingFrame, mirror: boolean): Partial<Record<TrackingInput, number>> {
  const lr = (v: number): number => (mirror ? v : 0 - v); // 0 − 0 は +0
  const inputs: Partial<Record<TrackingInput, number>> = {
    faceYaw: lr(frame.faceYaw),
    facePitch: frame.facePitch,
    faceRoll: lr(frame.faceRoll),
    eyeOpenL: mirror ? frame.eyeOpenR : frame.eyeOpenL,
    eyeOpenR: mirror ? frame.eyeOpenL : frame.eyeOpenR,
    eyeBallX: lr(frame.eyeBallX),
    eyeBallY: frame.eyeBallY,
    mouthOpen: frame.mouthOpen,
  };
  if (frame.mouthForm !== undefined) inputs.mouthForm = frame.mouthForm;
  if (frame.mouthWidth !== undefined) inputs.mouthWidth = frame.mouthWidth;
  if (frame.browY !== undefined) inputs.browY = frame.browY;
  return inputs;
}
