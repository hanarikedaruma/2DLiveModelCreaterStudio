// パラメータの1行。名前と結果の言葉（押すと編集中にする / やめる）と、キーの印つきのスライダー
import type { Parameter } from '@app/schema';
import { KeySlider, type KeyActions } from './KeySlider';
import { resultLabel } from './labels';
import type { KeyMark } from './marks';

export interface ParameterRowProps {
  parameter: Parameter;
  value: number;
  active: boolean;
  marks: KeyMark[];
  onToggle(): void;
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
        title={active ? '押すと編集をやめる（基準状態に戻る）' : '押すとこのパラメータのキーを編集する'}
        onClick={onToggle}
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
