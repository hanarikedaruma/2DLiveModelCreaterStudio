// キーの印つきのスライダー。範囲の 2% 以内でキー（とデフォルト値）に吸い付く。
// 印を押すとその値へ移動し（そのキーを編集できる）、右クリックでキーの操作（ロック / ロック解除・消す・別の値へ動かす。
// STEP3 のカード63）。
// Shift＋ドラッグで値の範囲を選び、範囲のキーをまとめてロック / ロック解除 / 再補間する（カード31）
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { snapToKey, type KeyMark, type MarkKind } from './marks';

const SYMBOL: Record<MarkKind, string> = { key: '●', generated: '○', locked: '■' };
const KIND_NAME: Record<MarkKind, string> = { key: 'キー', generated: '生成したキー', locked: 'ロックしたキー' };

// 印はつまみの中心に合わせて左右を 7px ずつ狭めている（parameters.css の .key-slider-marks）。位置は .key-slider-track で測る
const MARK_INSET = 7;
// これより動かさずに離したら、範囲を選ばずに選択を解除する
const CLICK_PX = 3;
const NEAR = 1e-6;

export type ValueRange = [number, number];

// 印と範囲の操作。無ければ印を押して移動するだけ
export interface KeyActions {
  toggleLock(value: number): void;
  deleteKey(value: number): void; // その値のキーを消す（STEP3 のカード63）
  moveKey(value: number): void; // その値のキーを別の値へ動かす（動かす先は呼ばれた側で聞く）
  lockRange(range: ValueRange, locked: boolean): void;
  regenerateRange(range: ValueRange): void;
}

export interface KeySliderProps {
  label: string;
  min: number;
  max: number;
  value: number;
  defaultValue: number;
  marks: KeyMark[];
  showMarks: boolean;
  format(value: number): string;
  onChange(value: number): void;
  keyActions?: KeyActions;
}

interface Selection {
  range: ValueRange;
  dragging: boolean;
}

interface Drag {
  pointerId: number;
  startX: number;
  startValue: number;
}

// 押されていない pointer の id だと例外になる（合成したイベントなど）。取れなくても続ける
function capture(el: Element, pointerId: number, on: boolean) {
  try {
    if (on) el.setPointerCapture?.(pointerId);
    else if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId);
  } catch {
    // 捕まえられなくても操作は続ける
  }
}

const ordered = (a: number, b: number): ValueRange => (a <= b ? [a, b] : [b, a]);

export function KeySlider({
  label,
  min,
  max,
  value,
  defaultValue,
  marks,
  showMarks,
  format,
  onChange,
  keyActions,
}: KeySliderProps) {
  const range = max - min;
  const step = range > 10 ? 0.1 : 0.01;
  const snapValues = [defaultValue, ...marks.map((m) => m.value)];
  const percent = (v: number) => `${((v - min) / range) * 100}%`;
  const selectable = showMarks && keyActions !== undefined;

  const [selection, setSelection] = useState<Selection | null>(null);
  const [menu, setMenu] = useState<KeyMark | null>(null); // 右クリックした印のキーの操作
  const drag = useRef<Drag | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const firstMenuButton = useRef<HTMLButtonElement | null>(null);

  // 開いたキーの操作へフォーカスを移し、メニュー全体が見えるところまでスクロールする（小さいウィンドウでパネルの下に開くため）
  useEffect(() => {
    if (!menu) return;
    firstMenuButton.current?.focus({ preventScroll: true });
    menuRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [menu]);

  // 編集をやめたら選択も消す
  useEffect(() => {
    if (!showMarks) {
      drag.current = null;
      setSelection(null);
      setMenu(null);
    }
  }, [showMarks]);

  // 画面の x からパラメータの値（印の並ぶ幅の中で min..max）
  const valueAt = (el: HTMLElement, clientX: number) => {
    const rect = el.getBoundingClientRect();
    const width = rect.width - 2 * MARK_INSET;
    const t = width > 0 ? (clientX - rect.left - MARK_INSET) / width : 0;
    return min + Math.min(1, Math.max(0, t)) * range;
  };

  const startSelect = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!selectable || !e.shiftKey || e.button !== 0) return;
    // スライダーのつまみは動かさない
    e.preventDefault();
    e.stopPropagation();
    const v = valueAt(e.currentTarget, e.clientX);
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startValue: v };
    capture(e.currentTarget, e.pointerId, true);
    setSelection({ range: [v, v], dragging: true });
  };

  const moveSelect = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    setSelection({ range: ordered(d.startValue, valueAt(e.currentTarget, e.clientX)), dragging: true });
  };

  const endSelect = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    capture(e.currentTarget, e.pointerId, false);
    if (Math.abs(e.clientX - d.startX) < CLICK_PX) setSelection(null);
    else setSelection({ range: ordered(d.startValue, valueAt(e.currentTarget, e.clientX)), dragging: false });
  };

  const shown = showMarks ? selection : null;
  const inside = (v: number) => shown !== null && v >= shown.range[0] - NEAR && v <= shown.range[1] + NEAR;
  const count = shown ? marks.filter((m) => inside(m.value)).length : 0;

  return (
    <div className="key-slider">
      {/* スライダーと印。範囲の選択はこの中で行う */}
      <div
        className="key-slider-track"
        onPointerDownCapture={startSelect}
        onMouseDownCapture={(e) => {
          if (selectable && e.shiftKey) e.preventDefault();
        }}
        onPointerMove={moveSelect}
        onPointerUp={endSelect}
        onPointerCancel={endSelect}
      >
        <input
          type="range"
          className="key-slider-input"
          aria-label={label}
          aria-valuetext={format(value)}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(snapToKey(Number(e.currentTarget.value), snapValues, range))}
        />
        {showMarks && (
          <div className="key-slider-marks" data-testid="key-marks">
            {shown && (
              <div
                className="key-selection"
                data-testid="key-selection"
                style={{
                  left: percent(shown.range[0]),
                  width: `${((shown.range[1] - shown.range[0]) / range) * 100}%`,
                }}
              />
            )}
            {marks.map((m) => (
              <button
                type="button"
                key={m.value}
                className={`key-mark key-mark-${m.kind}${inside(m.value) ? ' in-selection' : ''}`}
                data-kind={m.kind}
                data-value={m.value}
                aria-label={`${KIND_NAME[m.kind]}: ${format(m.value)}`}
                title={
                  keyActions
                    ? `${KIND_NAME[m.kind]}: ${format(m.value)}（押すとこの値へ移動、右クリックでキーの操作）`
                    : `${KIND_NAME[m.kind]}: ${format(m.value)}（押すとこの値へ移動）`
                }
                style={{ left: percent(m.value) }}
                onClick={(e) => {
                  // Shift は範囲の選択に使う
                  if (!e.shiftKey) onChange(m.value);
                }}
                onContextMenu={(e) => {
                  if (!keyActions) return;
                  e.preventDefault();
                  setMenu(m);
                }}
              >
                {SYMBOL[m.kind]}
              </button>
            ))}
          </div>
        )}
      </div>
      {keyActions && showMarks && menu && (
        <div
          ref={menuRef}
          className="key-menu"
          role="group"
          aria-label={`キー ${format(menu.value)} の操作`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setMenu(null);
          }}
        >
          <span className="key-range-text">キー: {format(menu.value)}</span>
          <button
            type="button"
            ref={firstMenuButton}
            onClick={() => {
              setMenu(null);
              keyActions.toggleLock(menu.value);
            }}
          >
            {menu.kind === 'locked' ? 'ロックを解除' : 'ロックする'}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              keyActions.deleteKey(menu.value);
            }}
          >
            このキーを消す
          </button>
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              keyActions.moveKey(menu.value);
            }}
          >
            別の値へ動かす…
          </button>
          <button
            type="button"
            className="key-range-clear"
            aria-label="キーの操作を閉じる"
            title="閉じる"
            onClick={() => setMenu(null)}
          >
            ×
          </button>
        </div>
      )}
      {keyActions && shown && !shown.dragging && (
        <div className="key-range-actions" role="group" aria-label="選択範囲のキー">
          <span className="key-range-text">
            選択範囲: {format(shown.range[0])} 〜 {format(shown.range[1])}（キー {count} 個）
          </span>
          <button type="button" onClick={() => keyActions.lockRange(shown.range, true)}>
            選択範囲をロック
          </button>
          <button type="button" onClick={() => keyActions.lockRange(shown.range, false)}>
            選択範囲をロック解除
          </button>
          <button
            type="button"
            title="選んだ範囲の中の中間キーだけを、生成方式で作り直す（ロックしたキーは残る）"
            onClick={() => keyActions.regenerateRange(shown.range)}
          >
            選択範囲だけ再補間
          </button>
          <button
            type="button"
            className="key-range-clear"
            aria-label="選択を解除"
            title="選択を解除"
            onClick={() => setSelection(null)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
