import { STANDARD_PART_NAMES, type Model } from '@app/schema';
import { isUsableWarp } from '../deform/warp';
import { normalizeClosedLine } from './closedLine';
import { faceWarpOf } from './faceTurn';
import { blinkMethod, keepOnRerun, mouthMethod } from './motions';
import { SIDES, eyeTypes, indexStandardParts, type ImageType } from './standardParts';

// 表示名を「・」でつなぐ。「上まぶた L」のように英字で終わるときは、助詞の前に空白を入れる
const names = (types: ImageType[]) => {
  const text = types.map((t) => STANDARD_PART_NAMES[t]).join('・');
  return /[A-Za-z0-9]$/.test(text) ? `${text} ` : text;
};

// 推奨パーツ（白目・瞳・上まぶた・上唇・下唇・口の中）が足りないとき、動きがどう簡易になるかの文
export function setupWarnings(model: Model, surfaceFaceTurn = true): string[] {
  const index = indexStandardParts(model.parts);
  const missing = (types: ImageType[]) => types.filter((t) => !index.has(t));
  const out: string[] = [];

  for (const side of SIDES) {
    const t = eyeTypes(side);
    const method = blinkMethod(index, side);
    if (method === null) {
      out.push(`${names([t.eyeWhite, t.iris, t.upperLid])}がないため、目 ${side} のまばたきと視線の動きは作られません`);
      continue;
    }
    if (method === 'squash') {
      out.push(`${names(missing([t.eyeWhite, t.upperLid]))}がないため、まばたきは目全体を縦に縮める方式になります`);
    }
    if (!index.has(t.iris)) {
      out.push(`${names([t.iris])}がないため、視線の動き（EyeBallX・EyeBallY）は作られません`);
    } else if (!index.has(t.eyeWhite)) {
      const ref = index.has(t.eyeWhole) ? t.eyeWhole : t.iris;
      out.push(
        `${names([t.eyeWhite])}がないため、${names([t.iris])}は白目の形で切り抜かれず、動く幅は${names([ref])}の大きさで決めます`,
      );
    }
  }

  // 閉じた目の線（カード42）。引いてあるのに使えないとき
  for (const side of SIDES) {
    const t = eyeTypes(side);
    const hint = model.setupHints[side === 'L' ? 'closedLineL' : 'closedLineR'];
    if (!hint || hint.points.length === 0) continue;
    if (!normalizeClosedLine(hint.points)) {
      out.push(`閉じた目の線 ${side} は横の幅が無いため、まばたきは線に沿いません`);
    } else if (blinkMethod(index, side) !== 'lids') {
      out.push(`${names(missing([t.eyeWhite, t.upperLid]))}がないため、閉じた目の線 ${side} は使われません`);
    }
  }
  const faceWarp = faceWarpOf(model);
  if (surfaceFaceTurn && faceWarp && !isUsableWarp(faceWarp)) {
    out.push('顔の変形のワープが使えない形のため、曲面の顔の向きは作られません');
  }
  if (!surfaceFaceTurn) {
    const faceGroup = index.group('faceGroup');
    const warpIds = new Set(model.warps.filter((w) => w.partId === faceGroup?.id).map((w) => w.id));
    if (
      model.bindings.some(
        (b) =>
          b.target.type === 'warp' &&
          warpIds.has(b.target.id) &&
          b.channel === 'warpPoints' &&
          b.parameterIds.length >= 1 &&
          b.parameterIds.length <= 2 &&
          b.parameterIds.every((id) => id === 'FaceAngleX' || id === 'FaceAngleY') &&
          b.keys.some(keepOnRerun),
      )
    ) {
      out.push(
        '顔の向きに手動編集・ロック済みの変形があるため、そのバインディングは残ります。髪と同じ奥行き方式には完全にそろいません',
      );
    }
  }

  const method = mouthMethod(index);
  if (method === null) {
    out.push(`${names(['upperLip', 'lowerLip', 'mouthInside'])}がないため、口の開閉は作られません`);
    return out;
  }
  if (method === 'stretch') {
    out.push(`${names(missing(['lowerLip', 'mouthInside']))}がないため、口の開閉は口全体を縦に伸ばす方式になります`);
  }
  if (!index.has('upperLip')) {
    out.push(`${names(['upperLip'])}がないため、口を開けたときに口の上側の輪郭が出ません`);
  }
  const clipped = missing(['mouthInside']).length > 0 ? (['teeth', 'tongue'] as ImageType[]).filter(index.has) : [];
  if (clipped.length > 0) {
    out.push(`${names(['mouthInside'])}がないため、${names(clipped)}は口の中の形で切り抜かれません`);
  }
  return out;
}
