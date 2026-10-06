import type { Binding, Model } from '@app/schema';
import { isUsableWarp } from '../deform/warp';
import { generateSurfaceKeys, SURFACE_MAX_ANGLE, type SurfaceParameter } from '../generate/surface';
import { faceTurnCrossTerm, headWarpOf } from './faceTurn';
import { keepOnRerun } from './motions';
import { indexStandardParts } from './standardParts';
import type { PointPlan } from './step1';

// I-039 暫定: 顔側の曲面を頭部共通にする。上下は首との重なりを残すため、左右より狭くする。
export const HEAD_TURN_ANGLE = { FaceAngleX: 12, FaceAngleY: 6 } as const;
const VALUES = [-30, -20, -10, 0, 10, 20, 30];
const scaled = (id: SurfaceParameter, value: number) => (value * HEAD_TURN_ANGLE[id]) / SURFACE_MAX_ANGLE;

// 顔（faceGroup）のワープの顔の向きのバインディング。withHead なら頭（headRoot）のワープのものも
export function faceTurnBindings(model: Model, withHead = false): Binding[] {
  const index = indexStandardParts(model.parts);
  const groups = [index.group('faceGroup')?.id, withHead ? index.group('headRoot')?.id : undefined];
  const ids = new Set(model.warps.filter((w) => groups.includes(w.partId)).map((w) => w.id));
  return model.bindings.filter(
    (b) =>
      b.target.type === 'warp' &&
      ids.has(b.target.id) &&
      b.channel === 'warpPoints' &&
      b.parameterIds.length >= 1 &&
      b.parameterIds.length <= 2 &&
      b.parameterIds.every((id) => id === 'FaceAngleX' || id === 'FaceAngleY'),
  );
}

export function headTurnBlockReason(model: Model): string | null {
  if (faceTurnBindings(model).some((b) => b.keys.some(keepOnRerun)))
    return '顔の向きに手動編集・ロック済みの変形があるため、頭部共通の曲面方式には切り替えず、顔の向きの設定を残します';
  const warp = headWarpOf(model);
  if (warp && !isUsableWarp(warp)) return '頭の変形のワープが使えない形のため、頭部共通の曲面方式には切り替えません';
  return null;
}

// 共通の姿勢の方式（headPose.ts）に切り替えられない理由。顔・頭のワープの顔の向きに、手で直したキー・ロックした
// キーがあれば、勝手に作り直さずに残す
export function headPoseBlockReason(model: Model): string | null {
  return faceTurnBindings(model, true).some((b) => b.keys.some(keepOnRerun))
    ? '顔・頭のワープの顔の向きに手動編集・ロック済みの変形があるため、顔・髪・耳を個別に動かす方式には切り替えず、顔の向きの設定を残します'
    : null;
}

export function planHeadTurn(model: Model): PointPlan[] {
  const warp = headWarpOf(model);
  if (!warp || !isUsableWarp(warp)) return [];
  const target = { type: 'warp' as const, id: warp.id };
  // linear として密なキーを保存し、一般の「間を生成」で旧20度の曲面へ戻らないようにする。
  const plans: PointPlan[] = (['FaceAngleX', 'FaceAngleY'] as const).map((id) => {
    const shapes = generateSurfaceKeys(
      warp,
      id,
      VALUES.map((v) => scaled(id, v)),
    );
    return {
      target,
      parameterIds: [id],
      generation: 'linear',
      keys: VALUES.map((v, i) => ({ coords: [v], delta: shapes[i]! })),
    };
  });
  const keys: PointPlan['keys'] = [];
  for (const x of [-30, 0, 30]) {
    for (const y of [-30, 0, 30]) {
      keys.push({ coords: [x, y], delta: faceTurnCrossTerm(warp, scaled('FaceAngleX', x), scaled('FaceAngleY', y)) });
    }
  }
  plans.push({ target, parameterIds: ['FaceAngleX', 'FaceAngleY'], generation: 'linear', keys });
  return plans;
}
