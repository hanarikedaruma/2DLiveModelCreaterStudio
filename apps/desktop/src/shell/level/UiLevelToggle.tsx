// ヘッダーのかんたん/詳細の切り替え（カード27）。押すと今のモードの uiLevel だけを変える
import type { JSX } from 'react';
import { UI_LEVELS, useUiLevel } from './uiLevel';

export function UiLevelToggle(): JSX.Element {
  const [level, setLevel] = useUiLevel();
  return (
    <div className="ui-level" role="group" aria-label="かんたん/詳細">
      {UI_LEVELS.map((l) => (
        <button key={l.id} type="button" aria-pressed={level === l.id} onClick={() => setLevel(l.id)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}
