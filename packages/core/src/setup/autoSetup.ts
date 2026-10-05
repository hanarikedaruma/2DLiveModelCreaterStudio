import { ensureStandardParameters, newId, type Part, type Project } from '@app/schema';
import type { AutoSetup } from '@app/contracts';
import { rectOfAsset } from '../generate/bounds';
import { deepEqual } from '../generate/equal';
import { withDrawOrder } from './drawOrder';
import { withFaceWarp, withHeadWarp } from './faceTurn';
import { faceTurnBindings, headTurnBlockReason, planHeadTurn } from './headTurn';
import { buildHierarchy } from './hierarchy';
import { applyMasksAndDepth } from './masksDepth';
import { applyMotionPlans, planMotions } from './motions';
import { computePivots, type BoundsOf } from './pivots';
import { applyPointPlans, planStep1 } from './step1';
import { planStep2 } from './step2';
import { setupWarnings } from './warnings';

export const AUTO_SETUP_LABEL = 'かんたんセットアップ';

export interface AutoSetupOptions {
  faceTurn?: 'surface' | 'depth' | 'head-surface';
}

export function createAutoSetup(options: AutoSetupOptions = {}): AutoSetup {
  return {
    plan(project) {
      // 新しい id は plan ごとに覚えておき、同じ入力には同じ id を使う（apply を純粋にする）
      const pool: string[] = [];
      return {
        command: { label: AUTO_SETUP_LABEL, apply: (p) => runAutoSetup(p, pooledIds(pool, p), options) },
        warnings:
          options.faceTurn === 'head-surface'
            ? [
                ...setupWarnings(project.model, true),
                ...[headTurnBlockReason(project.model)].filter((w): w is string => w !== null),
              ]
            : setupWarnings(project.model, options.faceTurn !== 'depth'),
      };
    },
  };
}

// pool の id を順に使う（足りなければ作って pool に足す）。プロジェクトで使っている id は飛ばす
function pooledIds(pool: string[], project: Project): () => string {
  const taken = new Set<string>();
  for (const list of [project.model.parts, project.model.bindings, project.model.meshes, project.model.warps]) {
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

// かんたんセットアップの本体。何も変わらなければ同じ参照を返す
export function runAutoSetup(project: Project, nextId: () => string, options: AutoSetupOptions = {}): Project {
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
  const blocked = headTurn && headTurnBlockReason(model) !== null;
  const surfaceFaceTurn = !headTurn && options.faceTurn !== 'depth';
  if (surfaceFaceTurn) model = withFaceWarp(model, boundsOf, nextId);
  if (headTurn && !blocked) model = withHeadWarp(model, boundsOf, nextId);
  const plan = planStep1(model, planMotions(model, boundsOf), boundsOf, surfaceFaceTurn);
  const headPoints = headTurn && !blocked ? planHeadTurn(model) : [];
  // 手動の旧顔ワープがある場合は、他軸の自動キーも含め旧顔の向きを一式残す。
  const preservedFace = new Set(blocked ? faceTurnBindings(model).map((b) => b.id) : []);
  const step2 = planStep2(model, boundsOf); // 呼吸・腕（カード53）
  // 頭部の曲面と従来の奥行き移動を二重に掛けない。手動・ロック済みの旧キーは applyMotionPlans が残す。
  const transforms =
    headPoints.length > 0
      ? plan.transforms.filter((p) => p.parameterId !== 'FaceAngleX' && p.parameterId !== 'FaceAngleY')
      : plan.transforms;
  model = applyMotionPlans(model, [...transforms, ...step2], nextId); // 8 バインディング（transform）
  model = applyPointPlans(
    model,
    [...plan.points, ...headPoints],
    (b) => plan.owns(b) && !preservedFace.has(b.id),
    nextId,
  );
  return deepEqual(model, project.model) ? project : { ...project, model };
}
