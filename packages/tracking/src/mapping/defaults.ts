import type { TrackingInput, TrackingMapping } from '@app/schema';
import { DEFAULT_SMOOTHING } from './oneEuro';

function mapping(input: TrackingInput, parameterId: string, range: [number, number]): TrackingMapping {
  return {
    input,
    parameterId,
    inputRange: [range[0], range[1]],
    outputRange: [range[0], range[1]],
    invert: false,
    curve: 'linear',
    smoothing: DEFAULT_SMOOTHING, // minCutoff 1.0
    deadZone: 0,
  };
}

// 既定のマッピング（Project の trackingMappings が空のとき）。毎回新しい配列を返す。
// 口の形・口の横幅・眉（STEP1、カード35）は、モデルにそのパラメータがあるときだけ使われる
export function createDefaultTrackingMappings(): TrackingMapping[] {
  return [
    mapping('faceYaw', 'FaceAngleX', [-30, 30]),
    mapping('facePitch', 'FaceAngleY', [-30, 30]),
    mapping('faceRoll', 'FaceAngleZ', [-30, 30]),
    mapping('eyeOpenL', 'EyeOpenL', [0, 1]),
    mapping('eyeOpenR', 'EyeOpenR', [0, 1]),
    mapping('eyeBallX', 'EyeBallX', [-1, 1]),
    mapping('eyeBallY', 'EyeBallY', [-1, 1]),
    mapping('mouthOpen', 'MouthOpen', [0, 1]),
    mapping('mouthForm', 'MouthForm', [-1, 1]),
    mapping('mouthWidth', 'MouthWidth', [-1, 1]),
    mapping('browY', 'BrowYL', [-1, 1]),
    mapping('browY', 'BrowYR', [-1, 1]),
  ];
}
