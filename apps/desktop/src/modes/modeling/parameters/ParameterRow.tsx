// パラメータの1行。名前と結果の言葉（押すと編集中にする / やめる。Ctrl+クリックで加える）と、キーの印つきのスライダー
import type { Parameter } from '@app/schema';
import { KeySlider, type KeyActions } from './KeySlider';
import { resultLabel } from './labels';
import type { KeyMark } from './marks';

export interface ParameterRowProps {
  parameter: Parameter;
  value: number;
  active: boolean;
  marks: KeyMark[];
  onToggle(additive: boolean): void; // additive = Ctrl（Mac は ⌘）を押しながら
  onChange(value: number): void;
  keyActions?: KeyActions;
}

export function ParameterRow({ parameter, value, active, marks, onToggle, onChange, keyActions }: ParameterRowProps) {
  return (
    <div className={active ? 'parameter-row active' : 'parameter-row'} data-parameter-id={parameter.id}>
      <button
        type="button"
        className="parameter-row-head"
        aria-pressed={active}
        title={
          active
            ? '押すとこのパラメータの編集をやめる（値はデフォルト値に戻る）'
            : '押すとこのパラメータのキーを編集する。Ctrl+クリックで、編集中のパラメータに加える（組み合わせのキー）'
        }
        onClick={(e) => onToggle(e.ctrlKey || e.metaKey)}
      >
        <span className="parameter-name">{parameter.name}</span>
        <span className="parameter-result">{resultLabel(parameter, value)}</span>
      </button>
      <KeySlider
        label={parameter.name}
        min={parameter.min}
        max={parameter.max}
        value={value}
        defaultValue={parameter.default}
        marks={marks}
        showMarks={active}
        format={(v) => resultLabel(parameter, v)}
        onChange={onChange}
        keyActions={keyActions}
      />
    </div>
  );
}
