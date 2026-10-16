// 透かしの濃さと色（I-082）。透かしを出している間だけ［透かし］の横に出す
import type { CSSProperties } from 'react';
import { GHOST_COLORS, GHOST_OPACITY_MAX, GHOST_OPACITY_MIN, type GhostStyle } from './ghost';

export function GhostControls({ style, onChange }: { style: GhostStyle; onChange(style: GhostStyle): void }) {
  const percent = Math.round(style.opacity * 100);
  return (
    <span className="ghost-controls" role="group" aria-label="透かしの濃さと色">
      <input
        type="range"
        aria-label="透かしの濃さ"
        title="透かしの濃さ"
        min={Math.round(GHOST_OPACITY_MIN * 100)}
        max={Math.round(GHOST_OPACITY_MAX * 100)}
        step={5}
        value={percent}
        onChange={(e) => onChange({ ...style, opacity: Number(e.currentTarget.value) / 100 })}
      />
      <output className="ghost-opacity">{percent}%</output>
      {GHOST_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          className="ghost-color"
          aria-label={`透かしの色: ${c.label}`}
          aria-pressed={style.color === c.id}
          title={c.label}
          style={{ '--ghost-color': `rgb(${c.rgb})` } as CSSProperties}
          onClick={() => onChange({ ...style, color: c.id })}
        />
      ))}
    </span>
  );
}
