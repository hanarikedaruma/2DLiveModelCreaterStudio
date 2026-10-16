// 2パラメータの格子（方向グリッドと組み合わせの補正で共通）。マスを押すとそのマスを編集中にし、
// 組み合わせのマスには状態（自動 / 修正済み）を出す。選んだマスが修正済みなら [自動に戻す] で補正のキーを消す
import type { Parameter } from '@app/schema';
import { useDispatch, useEditor, useProject } from '../../../shell/api';
import { formatValue } from '../parameters/labels';
import { LockIcon } from '../structure/ui';
import {
  crossSection,
  cellKind,
  cellLockState,
  cellPatch,
  cellStatus,
  correctionKeyCount,
  isCurrentCell,
  lockCellCommand,
  resetCellCommand,
  type CellKind,
  type CellStatus,
  type GridCell,
  type ParameterPair,
} from './grid';
import { cellStatusText, combinationName, directionName, STATUS_WORDS } from './labels';

export interface PairGridProps {
  pair: ParameterPair;
  pa: Parameter; // 横（列）
  pb: Parameter; // 縦（行）
  xs: number[]; // 列の値（昇順。左から並べる）
  ys: number[]; // 行の値（昇順。下から並べる）
  variant: 'direction' | 'combination';
  label: string; // 格子の名前（読み上げ）
}

// マスの中の短い言葉（組み合わせの補正）
function shortText(kind: CellKind, status: CellStatus): string {
  if (kind === 'center') return '基準';
  if (kind === 'axis') return '単独';
  return status === 'corrected' ? '修正' : '自動';
}

export function PairGrid({ pair: chosen, pa, pb, xs, ys, variant, label }: PairGridProps) {
  const { model } = useProject();
  const [editor, setEditor] = useEditor();
  // 一緒にキーを編集しているほかのパラメータがあれば、その値での2軸断面（I-028）
  const pair = crossSection(model, editor, chosen);
  const fixed = pair.fixed ?? [];
  const direction = variant === 'direction';
  const nameOf = (cell: GridCell) => (direction ? directionName(pa, pb, cell) : combinationName(pa, pb, cell));
  const rows = [...ys].reverse(); // 上が大きい値
  const current =
    rows.flatMap((b) => xs.map((a) => ({ a, b }))).find((c) => isCurrentCell(pa, pb, c, editor, fixed)) ?? null;

  const cellButton = (cell: GridCell) => {
    const kind = cellKind(pa, pb, cell);
    const status = cellStatus(model, pair, cell);
    const name = nameOf(cell);
    const text = `${name}（${cellStatusText(pa, pb, cell, status)}）`;
    const locked = kind === 'combined' && cellLockState(model, pair, cell).locked;
    const classes = ['grid2d-cell', `grid2d-${kind}`];
    if (kind === 'combined' && status === 'corrected') classes.push('corrected');
    return (
      <button
        key={`${cell.a}:${cell.b}`}
        type="button"
        className={classes.join(' ')}
        aria-pressed={current !== null && current.a === cell.a && current.b === cell.b}
        aria-label={text}
        title={locked ? `${text}・ロックあり` : text}
        data-locked={locked}
        data-cell={`${cell.a},${cell.b}`}
        data-status={kind === 'combined' ? status : kind}
        onClick={() => setEditor(cellPatch(pa, pb, cell, fixed))}
      >
        {direction ? (
          <>
            <span className="grid2d-cell-name">{name}</span>
            {kind === 'combined' && <span className="grid2d-cell-status">{STATUS_WORDS[status]}</span>}
          </>
        ) : (
          <span className="grid2d-cell-status">{shortText(kind, status)}</span>
        )}
      </button>
    );
  };

  const columns = direction ? `repeat(${xs.length}, minmax(0, 1fr))` : `auto repeat(${xs.length}, minmax(32px, 1fr))`;
  return (
    <div className={`grid2d grid2d-${variant}`}>
      {fixed.length > 0 && (
        <p className="grid2d-hint grid2d-section-note">
          断面:{' '}
          {fixed
            .map((f) => {
              const p = model.parameters.find((x) => x.id === f.id);
              return p ? `${p.name} ＝ ${formatValue(p, f.value)}` : f.id;
            })
            .join('、')}
          （{[pa, pb].length + fixed.length} つのパラメータの組み合わせのキー）
        </p>
      )}
      <div className="grid2d-cells" role="group" aria-label={label} style={{ gridTemplateColumns: columns }}>
        {!direction && (
          <>
            <span className="grid2d-corner" title={`横: ${pa.name}、縦: ${pb.name}`}>
              縦＼横
            </span>
            {xs.map((a) => (
              <span key={`h${a}`} className="grid2d-head">
                {formatValue(pa, a)}
              </span>
            ))}
          </>
        )}
        {rows.map((b) => (
          <div key={`r${b}`} className="grid2d-row">
            {!direction && <span className="grid2d-head grid2d-row-head">{formatValue(pb, b)}</span>}
            {xs.map((a) => cellButton({ a, b }))}
          </div>
        ))}
      </div>
      <CurrentCell pair={pair} pa={pa} pb={pb} cell={current} name={current ? nameOf(current) : ''} />
    </div>
  );
}

interface CurrentCellProps {
  pair: ParameterPair;
  pa: Parameter;
  pb: Parameter;
  cell: GridCell | null;
  name: string;
}

// 選んだマスの状態と [自動に戻す]
function CurrentCell({ pair, pa, pb, cell, name }: CurrentCellProps) {
  const { model } = useProject();
  const dispatch = useDispatch();
  if (!cell) return <p className="grid2d-current grid2d-hint">マスを押すと、そのマスのキーを編集する</p>;
  const kind = cellKind(pa, pb, cell);
  // 断面（I-028）では、どのマスも組と断面のパラメータの組み合わせのキー
  if ((pair.fixed ?? []).length > 0 && kind !== 'combined') {
    return <p className="grid2d-current">{name}: 断面のパラメータとの組み合わせのキーを編集する</p>;
  }
  if (kind === 'center') return <p className="grid2d-current">{name}: 2つの既定値の組み合わせのキーを編集する</p>;
  if (kind === 'axis') {
    const p = cellPatch(pa, pb, cell).activeParameterIds[0] === pa.id ? pa : pb;
    return (
      <p className="grid2d-current">
        {name}: {p.name} だけのキーを編集する
      </p>
    );
  }
  const count = correctionKeyCount(model, pair, cell);
  const locks = cellLockState(model, pair, cell);
  return (
    <div className="grid2d-current">
      <p className="grid2d-current-text">
        {name}:{' '}
        {count > 0 ? (
          <strong className="grid2d-corrected-text">修正済み（補正のキー {count} 個）</strong>
        ) : (
          <>
            自動（{pa.name}と{pb.name}の差分の和）。このまま直すと補正のキーができる
          </>
        )}
      </p>
      <button
        type="button"
        className="grid2d-lock"
        disabled={locks.count === 0}
        aria-label={locks.locked ? '補正キーのロックを解除' : '補正キーをロック'}
        aria-pressed={locks.locked}
        title={`${locks.locked ? '補正キーのロックを解除' : '補正キーをロック'}（このマスの2パラメータのキーだけ）`}
        onClick={() => dispatch(lockCellCommand(pair, cell, !locks.locked))}
      >
        <LockIcon locked={locks.locked} />
      </button>
      <button
        type="button"
        disabled={count === 0}
        title="このマスの補正のキーを消し、差分の和で動くようにする"
        onClick={() => dispatch(resetCellCommand(pair, cell))}
      >
        自動に戻す
      </button>
    </div>
  );
}
