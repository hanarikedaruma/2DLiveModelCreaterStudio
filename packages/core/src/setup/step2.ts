// カード53 呼吸・腕の標準パラメータと自動セットアップ（STEP2）。呼吸で胴体を縦に伸ばして首から上を持ち上げ、
// 腕の変形グループを肩（腕の上端中央）で回す。キーは source 'auto'（再実行で manual と locked のキーを残すのは applyMotionPlans）。
// パラメータはプロジェクトを開いたときに足す（アプリの step2Params）。プロジェクトに無いパラメータの動きは作らない。
// 揺れもの（HairFront・HairSide・HairBack）は、物理の設定で使われるまでバインディングを作らない
import type { Model, Part } from '@app/schema';
import { transformDelta, type DeltaParts, type KeySpec } from '../generate/keys';
import type { BindingPlan } from './motions';
import type { BoundsOf } from './pivots';
import { indexStandardParts } from './standardParts';

// 動きの量（カード53の表）
export const STEP2_MOTION = {
  breathTorso: 1.015, // 呼吸 1 での胴体の縦の倍率（胴体の下端中央を中心に伸ばす）
  breathNeckRise: 0.006, // 呼吸 1 で首から上（neckRoot）が上がる量（胴体の高さに対する割合）
  armRaise: 30, // 腕 1 で腕を上げる回転（度）。L は反時計回り（負）、R は時計回り（正）
};

export function planStep2(model: Model, boundsOf: BoundsOf): BindingPlan[] {
  const index = indexStandardParts(model.parts);
  const parameterIds = new Set(model.parameters.map((p) => p.id));
  const plans: BindingPlan[] = [];
  const zero = transformDelta();
  const add = (part: Part | undefined, parameterId: string, keys: KeySpec[]) => {
    if (part && parameterIds.has(parameterId)) plans.push({ partId: part.id, parameterId, generation: 'linear', keys });
  };
  // 0・1（値 1 で delta）
  const atOne = (delta: DeltaParts): KeySpec[] => [
    { coord: 0, delta: zero },
    { coord: 1, delta: transformDelta(delta) },
  ];
  // −1・0・1（値 1 で at(1)、−1 で at(−1)）
  const symmetric = (at: (sign: number) => DeltaParts): KeySpec[] => [
    { coord: -1, delta: transformDelta(at(-1)) },
    { coord: 0, delta: zero },
    { coord: 1, delta: transformDelta(at(1)) },
  ];

  // ---- 呼吸: 値 1 で胴体が縦に伸び（下端中央を中心に）、首から上が胴体の高さ × 0.006 上がる ----
  // 胴体のピボットはカード11の規則で中心なので、下端が動かないよう、伸びた分（下端とピボットの差 × (倍率 − 1)）だけ上へ戻す
  const stretch = STEP2_MOTION.breathTorso;
  for (const torso of index.images('torso')) {
    const r = boundsOf(torso);
    if (r) add(torso, 'Breath', atOne({ scaleY: stretch, y: (1 - stretch) * (r.y + r.height - torso.pivot.y) }));
  }
  const first = index.first('torso');
  const torso = first ? boundsOf(first) : null;
  if (torso) add(index.group('neckRoot'), 'Breath', atOne({ y: -torso.height * STEP2_MOTION.breathNeckRise }));

  // ---- 腕: 値 1 で腕を上げる（肩を中心に手先が外へ回る）。値 −1 で逆 ----
  // L は画面の右に描かれるので、手先を右（外）へ回すのは反時計回り（負）。R はその逆
  add(
    index.group('armRootL'),
    'ArmL',
    symmetric((s) => ({ rotation: -s * STEP2_MOTION.armRaise })),
  );
  add(
    index.group('armRootR'),
    'ArmR',
    symmetric((s) => ({ rotation: s * STEP2_MOTION.armRaise })),
  );
  return plans;
}
