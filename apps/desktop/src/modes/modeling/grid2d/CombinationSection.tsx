// 組み合わせの補正（パラメータパネルのセクション、詳細）。任意の2パラメータを選び、
// 各パラメータのキー位置の組み合わせの格子を方向グリッドと同じ方法で編集する（例: 目 開閉 × 目 笑顔）
import { useState } from 'react';
import type { Parameter } from '@app/schema';
import { useEditor, useProject } from '../../../shell/api';
import { activePair, defaultPair, keyPositions, pairParameters, type ParameterPair } from './grid';
import { PairGrid } from './PairGrid';
import './grid2d.css';

function ParameterSelect(props: { label: string; value: string; parameters: Parameter[]; onChange(id: string): void }) {
  return (
    <label className="grid2d-select">
      <span>{props.label}</span>
      <select
        aria-label={`${props.label}のパラメータ`}
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value)}
      >
        {props.parameters.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CombinationSection() {
  const { model } = useProject();
  const [editor] = useEditor();
  // 最初は編集中の2パラメータの組（方向グリッドから来たときなど）。選んだ組がモデルから消えたら既定の組
  const [chosen, setChosen] = useState<ParameterPair | null>(() => activePair(model, editor));
  const pair = chosen && pairParameters(model, chosen) ? chosen : defaultPair(model);
  const params = pair ? pairParameters(model, pair) : null;

  return (
    <div className="grid2d-section">
      <h3 className="grid2d-title">組み合わせの補正</h3>
      {!pair || !params ? (
        <p className="grid2d-hint">パラメータが2つ以上あると、組み合わせを補正できる</p>
      ) : (
        <>
          <div className="grid2d-selects">
            <ParameterSelect
              label="横"
              value={pair.a}
              parameters={model.parameters}
              // 同じものを選んだら入れ替える
              onChange={(a) => setChosen(a === pair.b ? { a, b: pair.a } : { a, b: pair.b })}
            />
            <ParameterSelect
              label="縦"
              value={pair.b}
              parameters={model.parameters}
              onChange={(b) => setChosen(b === pair.a ? { a: pair.b, b } : { a: pair.a, b })}
            />
          </div>
          <Grid pair={pair} pa={params[0]} pb={params[1]} />
        </>
      )}
    </div>
  );
}

function Grid({ pair, pa, pb }: { pair: ParameterPair; pa: Parameter; pb: Parameter }) {
  const { model } = useProject();
  const xs = keyPositions(model, pa);
  const ys = keyPositions(model, pb);
  if (xs.length < 2 || ys.length < 2) {
    const missing = [xs.length < 2 ? pa.name : null, ys.length < 2 ? pb.name : null].filter(Boolean).join('・');
    return (
      <p className="grid2d-hint">
        {missing} にキーが無い。格子は各パラメータのキー位置の組み合わせなので、先にキーを作る
      </p>
    );
  }
  return (
    <>
      <p className="grid2d-hint">
        格子は各パラメータのキー位置の組み合わせ。両方が動くマスは2つの差分の和で動き、直すと補正のキーができる
      </p>
      <PairGrid variant="combination" label="組み合わせのマス" pair={pair} pa={pa} pb={pb} xs={xs} ys={ys} />
    </>
  );
}
