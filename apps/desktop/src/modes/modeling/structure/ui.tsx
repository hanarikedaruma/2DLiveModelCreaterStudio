// パーツ構造の画面で使う小さな部品（アイコン・右クリックのメニュー・選ぶダイアログ）
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './structure.css';

export function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
      {off && <path d="M2 2l12 12" />}
    </svg>
  );
}

export function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="7" width="10" height="7" rx="1" />
      <path d={locked ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 6 0'} />
    </svg>
  );
}

// 設定の目印。値が0でも残し、押しただけでは物理のON/OFFを変更しない。
export function AxisSwayBadge({ name }: { name: string }) {
  const label = `${name}：軸揺れ：ON`;
  return (
    <span className="part-sway-badge" role="img" aria-label={label} title={label}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        aria-hidden
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 2h8M8 2v2l-3 6" />
        <circle cx="4" cy="12" r="2" />
      </svg>
    </span>
  );
}

export function FlowSwayBadge({ name, reason }: { name: string; reason?: string }) {
  const label = `${name}：流れ揺れ：ON${reason ? `（停止中：${reason}）` : ''}`;
  return (
    <span className={`part-sway-badge${reason ? ' is-paused' : ''}`} role="img" aria-label={label} title={label}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        aria-hidden
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 1v2M3 8a5 5 0 0 1 10 0H3zM8 8v3" />
        <path d="M6.5 11h3v4h-3z" />
      </svg>
    </span>
  );
}

export interface MenuEntry {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  run(): void;
}

// 右クリックのメニュー。外を押すか Escape で閉じる
export function ContextMenu({
  x,
  y,
  entries,
  onClose,
}: {
  x: number;
  y: number;
  entries: MenuEntry[];
  onClose(): void;
}) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return createPortal(
    <ul ref={ref} className="structure-menu" role="menu" style={{ left: x, top: y }}>
      {entries.map((entry) => (
        <li key={entry.label} role="none">
          <button
            type="button"
            role="menuitem"
            className={entry.danger ? 'danger' : undefined}
            disabled={entry.disabled}
            onClick={() => {
              onClose();
              entry.run();
            }}
          >
            {entry.label}
          </button>
        </li>
      ))}
    </ul>,
    document.body,
  );
}

// 一覧から選ぶダイアログ
export function PickerDialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  return createPortal(
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="dialog structure-picker"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <p className="dialog-message">{title}</p>
        <div className="structure-picker-body">{children}</div>
        <div className="dialog-buttons">
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
