import { ensureStandardParameters, newId, type Part, type Project } from '@app/schema';
import type { AutoSetup } from '@app/contracts';
import { rectOfAsset } from '../generate/bounds';
import { deepEqual } from '../generate/equal';
import { withDrawOrder } from './drawOrder';
import { withFaceWarp, withHeadWarp } from './faceTurn';
import { headMeshIds, isHeadPoseBinding, planHeadPose, withEyeWarps } from './headPose';
import { faceTurnBindings, headPoseBlockReason, headTurnBlockReason, planHeadTurn } from './headTurn';
import { buildHierarchy } from './hierarchy';
import { applyMasksAndDepth } from './masksDepth';
import { applyMotionPlans, planMotions } from './motions';
import { computePivots, type BoundsOf } from './pivots';
import { applyPointPlans, planStep1 } from './step1';
import { planStep2 } from './step2';
import { setupWarnings } from './warnings';
import { setupChest } from './chest';
import { planBlink } from './blink';

export const AUTO_SETUP_LABEL = '自動セットアップ';

export interface AutoSetupOptions {
  // 顔の向きの作り方。head-pose = 共通の姿勢から顔・髪・耳を個別に変形する（I-039 の根本改善）、
  // head-surface = 頭全体に同じ曲面のワープ（I-039 の暫定）、surface = 顔だけの曲面（カード42）、depth = 奥行きの移動
  faceTurn?: 'surface' | 'depth' | 'head-surface' | 'head-pose';
}

export function createAutoSetup(options: AutoSetupOptions = {}): AutoSetup {
  return {
    blink: planBlink,
    plan(project) {
      // 新しい id は plan ごとに覚えておき、同じ入力には同じ id を使う（apply を純粋にする）
      const pool: string[] = [];
      const chestWarnings: string[] = [];
      runAutoSetup(project, pooledIds(pool, project), options, chestWarnings);
      return {
        command: { label: AUTO_SETUP_LABEL, apply: (p) => runAutoSetup(p, pooledIds(pool, p), options) },
        warnings:
          options.faceTurn === 'head-surface' || options.faceTurn === 'head-pose'
            ? [
                ...setupWarnings(project.model, true),
                ...chestWarnings,
                ...[
                  options.faceTurn === 'head-pose'
                    ? headPoseBlockReason(project.model)
                    : headTurnBlockReason(project.model),
                ].filter((w): w is string => w !== null),
              ]
            : [...setupWarnings(project.model, options.faceTurn !== 'depth'), ...chestWarnings],
      };
    },
  };
}

// pool の id を順に使う（足りなければ作って pool に足す）。プロジェクトで使っている id は飛ばす
function pooledIds(pool: string[], project: Project): () => string {
  const taken = new Set<string>();
  for (const list of [
    project.model.parts,
    project.model.bindings,
    project.model.meshes,
    project.model.warps,
    project.model.parameters,
    project.physics,
  ]) {
    for (const item of list) taken.add(item.id);
  }
  let i = 0;
  return () => {
    for (;;) {
      const id = pool[i] ?? (pool[i] = newId());
      i++;
      if (!taken.has(id)) {
        taken.add(id);
        return id;
      }
    }
  };
}

// 自動セットアップの本体。何も変わらなければ同じ参照を返す
export function runAutoSetup(
  project: Project,
  nextId: () => string,
  options: AutoSetupOptions = {},
  warnings?: string[],
): Project {
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  // 画像パーツの外接矩形 = 素材の offset と幅・高さ
  const boundsOf: BoundsOf = (part: Part) => {
    const asset = part.kind === 'image' && part.assetId !== null ? assets.get(part.assetId) : undefined;
    return asset ? rectOfAsset(asset) : null;
  };
  const canvas = project.assets[0]?.canvasSize ?? null;

  let model = buildHierarchy(project.model, nextId); // 1・2 変形グループと階層
  model = computePivots(model, boundsOf, canvas); // 3 ピボット
  model = withDrawOrder(model); // 4 描画順
  model = applyMasksAndDepth(model); // 5・6 マスクと奥行き
  // 7 標準パラメータ。STEP1 の動きも作るので、MVP と STEP1 の標準パラメータで足りないものを足す
  // （STEP2 の標準パラメータはプロジェクトを開いたときにアプリが足す。無ければ STEP2 の動きは作らない）
  model = ensureStandardParameters(model, 'step1');
  const headTurn = options.faceTurn === 'head-surface';
  const headPose = options.faceTurn === 'head-pose';
  const blocked =
    (headTurn && headTurnBlockReason(model) !== null) || (headPose && headPoseBlockReason(model) !== null);
  const surfaceFaceTurn = !headTurn && !headPose && options.faceTurn !== 'depth';
  if (surfaceFaceTurn) model = withFaceWarp(model, boundsOf, nextId);
  if (headTurn && !blocked) model = withHeadWarp(model, boundsOf, nextId);
  // 共通の姿勢の方式では、目のグループに遠近のワープを足す（I-067 の A8。すでにあるワープはそのまま使う）
  if (headPose && !blocked) model = withEyeWarps(model, boundsOf, nextId);
  const plan = planStep1(model, planMotions(model, boundsOf), boundsOf, surfaceFaceTurn);
  const posePlan = headPose && !blocked ? planHeadPose(model, boundsOf) : null;
  const headPoints = headTurn && !blocked ? planHeadTurn(model) : (posePlan?.points ?? []);
  // 共通の姿勢の方式では、それまでの方式の自動のキー（顔・頭のワープ、頭と首の頂点・目のワープの顔の向き）を作り直す対象にする
  const poseMeshes = headPose && !blocked ? headMeshIds(model) : new Set<string>();
  const oldTurns = new Set(headPose && !blocked ? faceTurnBindings(model, true).map((b) => b.id) : []);
  // 手動の旧顔ワープがある場合は、他軸の自動キーも含め旧顔の向きを一式残す。
  const preservedFace = new Set(blocked ? faceTurnBindings(model).map((b) => b.id) : []);
  const step2 = planStep2(model, boundsOf); // 呼吸・腕（カード53）
  // 頭部の曲面と従来の奥行き移動を二重に掛けない。手動・ロック済みの旧キーは applyMotionPlans が残す。
  const replacesDepth = headPoints.length > 0 || (posePlan?.transforms.length ?? 0) > 0;
  const transforms = [
    ...(replacesDepth
      ? plan.transforms.filter((p) => p.parameterId !== 'FaceAngleX' && p.parameterId !== 'FaceAngleY')
      : plan.transforms),
    ...(posePlan?.transforms ?? []),
  ];
  // 頬染めの基準の不透明度（値 0 で消える。I-026）
  if (plan.partOpacities.size > 0) {
    model = {
      ...model,
      parts: model.parts.map((p) => {
        const opacity = plan.partOpacities.get(p.id);
        return opacity === undefined || opacity === p.opacity ? p : { ...p, opacity };
      }),
    };
  }
  model = applyMotionPlans(model, [...transforms, ...step2], nextId); // 8 バインディング（transform）
  model = applyPointPlans(
    model,
    [...plan.points, ...headPoints],
    (b) => (plan.owns(b) && !preservedFace.has(b.id)) || oldTurns.has(b.id) || isHeadPoseBinding(model, poseMeshes, b),
    nextId,
  );
  const next = deepEqual(model, project.model) ? project : { ...project, model };
  let result = setupChest(next, nextId, warnings);
  for (const side of ['L', 'R'] as const) {
    const line = result.model.setupHints[side === 'L' ? 'closedLineL' : 'closedLineR'];
    if (!line || line.partId === null) continue;
    const blink = planBlink(result, side, undefined, nextId);
    if (blink.command && !blink.replacesCustom) result = blink.command.apply(result);
  }
  return deepEqual(result, project) ? project : result;
}
