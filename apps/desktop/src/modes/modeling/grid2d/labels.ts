// 2パラメータの格子のマスの言葉（方向グリッドは「左上」、組み合わせの補正は「目 開閉 L 0・目 笑顔 L 1」）
import type { Parameter } from '@app/schema';
import { formatValue, resultWord } from '../parameters/labels';
import { cellKind, near, type CellStatus, type GridCell } from './grid';

// 方向グリッドのマスの名前。中央は「正面」、上下左右は「上」「左」、斜めは「左上」
export function directionName(pa: Parameter, pb: Parameter, cell: GridCell): string {
  const kind = cellKind(pa, pb, cell);
  const wa = resultWord(pa, cell.a) ?? formatValue(pa, cell.a);
  const wb = resultWord(pb, cell.b) ?? formatValue(pb, cell.b);
  if (kind === 'center') return '正面';
  if (kind === 'axis') return near(cell.a, pa.default) ? wb : wa;
  return `${wa}${wb}`;
}

// 組み合わせの補正のマスの名前
export function combinationName(pa: Parameter, pb: Parameter, cell: GridCell): string {
  return `${pa.name} ${formatValue(pa, cell.a)}・${pb.name} ${formatValue(pb, cell.b)}`;
}

export const STATUS_WORDS: Record<CellStatus, string> = { auto: '自動', corrected: '修正済み' };

// マスの状態の言葉（読み上げとツールチップ）
export function cellStatusText(pa: Parameter, pb: Parameter, cell: GridCell, status: CellStatus): string {
  const kind = cellKind(pa, pb, cell);
  if (kind === 'center') return '基準状態';
  if (kind === 'axis') return `${near(cell.a, pa.default) ? pb.name : pa.name}だけ`;
  return STATUS_WORDS[status];
}
