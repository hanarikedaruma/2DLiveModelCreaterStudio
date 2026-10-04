// 再補間（カード31）。ロックされたキーと代表状態を残し、範囲の中の中間キーをバインディングの方式で作り直す
import type { Binding, Model } from '@app/schema';
import { generateBetweenKeys, linearInterpolator, normalizeWithin, type Interpolator } from './between';
import { easeInterpolator } from './ease';
import { rotateInterpolator } from './rotate';
import { surfaceInterpolator, surfaceTarget } from './surface';

// バインディングの方式の補間。linear・depth は線形。回転・曲面に使えないバインディングも線形にする
export function interpolatorFor(binding: Binding, model: Model): Interpolator {
  switch (binding.generation) {
    case 'rotate':
      return rotateInterpolator(binding, model);
    case 'surface': {
      const target = surfaceTarget(binding, model);
      return target ? surfaceInterpolator(target.warp, target.parameterId) : linearInterpolator;
    }
    case 'ease':
      return easeInterpolator;
    default:
      return linearInterpolator;
  }
}

// KeyGenerator.regenerate。range（両端を含む。無ければ全体）の中の未ロックの generated だけを作り直す。
// 範囲の外のキー・ロックされたキー・代表状態はそのまま。方式（generation）は変えない
export function regenerateBinding(
  binding: Binding,
  model: Model,
  step: number,
  range?: readonly [number, number],
): Binding {
  return generateBetweenKeys(binding, interpolatorFor(binding, model), {
    divisions: binding.divisions,
    step,
    within: normalizeWithin(range),
    generation: binding.generation,
  });
}
