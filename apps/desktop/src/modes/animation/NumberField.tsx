// 数値の入力欄。入力中は書きかけを持ち、Enter か欄を離れたときに確定する（1回の確定が1回の Undo）。
// 数でない入力は元の値に戻す。min・max の外は端の値にする
import { useEffect, useState } from 'react';

export function NumberField(props: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
  disabled?: boolean;
  className?: string;
  onCommit(value: number): void;
}) {
  const text = props.format ? props.format(props.value) : String(props.value);
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);

  const commit = () => {
    if (draft === text) return;
    const n = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(n)) {
      const v = Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, n));
      if (v !== props.value) props.onCommit(v);
    }
    // 確定した値は props から戻ってくる。変わらなかったときのために書きかけを消す
    setDraft(text);
  };

  return (
    <input
      type="number"
      className={props.className}
      aria-label={props.label}
      min={props.min}
      max={props.max}
      step={props.step}
      value={draft}
      disabled={props.disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(text);
      }}
    />
  );
}
