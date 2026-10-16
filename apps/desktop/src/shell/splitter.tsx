import { useEffect, useRef, useState } from 'react';
import { clampSize } from './layoutSizes';

interface SplitterProps {
  label: string;
  axis: 'x' | 'y';
  value?: number;
  current(): number;
  min: number;
  max: number;
  direction?: 1 | -1;
  className?: string;
  onPreview(value: number | null): void;
  onCommit(value: number | null): void;
}

export function Splitter({
  label,
  axis,
  value,
  current,
  min,
  max,
  direction = 1,
  className = '',
  onPreview,
  onCommit,
}: SplitterProps) {
  const [dragging, setDragging] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelRef.current?.(), []);
  // 大きさや向きが変わったら、新しい制約で動かす。モード切替・窓の縮小中のドラッグは取り消す。
  useEffect(() => {
    cancelRef.current?.();
  }, [axis, min, max]);

  return (
    <div
      className={`splitter splitter-${axis} ${className}${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={value === undefined ? '中身に合わせる' : `${value}px`}
      tabIndex={0}
      title={`ドラッグか ${axis === 'x' ? '←→' : '↑↓'} キーで大きさを変える。ダブルクリックで元に戻す`}
      onDoubleClick={() => {
        cancelRef.current?.();
        onCommit(null);
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
        const decrease = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
        const increase = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
        if (e.key !== decrease && e.key !== increase) return;
        e.preventDefault();
        cancelRef.current?.();
        onCommit(clampSize(current() + (e.key === decrease ? -1 : 1) * direction * (e.shiftKey ? 64 : 16), min, max));
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.focus();
        cancelRef.current?.();
        const start = axis === 'x' ? e.clientX : e.clientY;
        const from = current();
        const pointerId = e.pointerId;
        let to: number | null = null;
        const move = (ev: PointerEvent) => {
          if (ev.pointerId !== pointerId) return;
          const delta = (axis === 'x' ? ev.clientX : ev.clientY) - start;
          if (to === null && Math.abs(delta) < 2) return;
          to = clampSize(from + delta * direction, min, max);
          onPreview(to);
        };
        const end = (commit: boolean) => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', cancel);
          window.removeEventListener('keydown', escape);
          window.removeEventListener('blur', blur);
          cancelRef.current = null;
          setDragging(false);
          onPreview(null);
          if (commit && to !== null) onCommit(to);
        };
        const up = (ev: PointerEvent) => {
          if (ev.pointerId === pointerId) end(true);
        };
        const cancel = (ev: PointerEvent) => {
          if (ev.pointerId === pointerId) end(false);
        };
        const escape = (ev: KeyboardEvent) => {
          if (ev.key === 'Escape') {
            ev.preventDefault();
            end(false);
          }
        };
        const blur = () => end(false);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        window.addEventListener('keydown', escape);
        window.addEventListener('blur', blur);
        cancelRef.current = () => end(false);
        setDragging(true);
      }}
    />
  );
}
