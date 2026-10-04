// 方向グリッド（パラメータパネルのセクション、かんたん）。顔 左右 × 顔 上下 の 3×3（−30 / 0 / 30）。
// 斜めのマスは何もしなければ上下と左右の差分の和で動き、そのまま直すと補正のキーができる
import { useProject } from '../../../shell/api';
import { DIRECTION_PAIR, directionValues, pairParameters } from './grid';
import { PairGrid } from './PairGrid';
import './grid2d.css';

export function DirectionGridSection() {
  const { model } = useProject();
  const params = pairParameters(model, DIRECTION_PAIR);
  if (!params) return null;
  const [pa, pb] = params;
  return (
    <div className="grid2d-section">
      <h3 className="grid2d-title">顔の向き</h3>
      <p className="grid2d-hint">斜めのマスは、上下と左右の和で動く。そのまま直すと補正のキーができる</p>
      <PairGrid
        variant="direction"
        label="顔の向きのマス"
        pair={DIRECTION_PAIR}
        pa={pa}
        pb={pb}
        xs={directionValues(pa)}
        ys={directionValues(pb)}
      />
    </div>
  );
}
