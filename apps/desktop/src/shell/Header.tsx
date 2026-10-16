// ヘッダー: メニュー（左上の ☰）・モードの切り替え・元に戻す/やり直す・プロジェクト名
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ModeId } from '@app/schema';
import { useEditor, useProject, useServices } from './api';
import { registry } from './registry';

const MODES: { id: ModeId; label: string }[] = [
  { id: 'modeling', label: 'モデリング' },
  { id: 'animation', label: 'アニメーション' },
  { id: 'studio', label: 'スタジオ' },
];

function Menu({ onResetLayout }: { onResetLayout(): void }) {
  const { menuItems } = useSyncExternalStore(registry.subscribe, registry.get);
  const { store } = useServices();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const items = [
    { id: 'shell.undo', label: '元に戻す', shortcut: 'Ctrl+Z', run: () => store.undo(), disabled: !store.canUndo() },
    {
      id: 'shell.redo',
      label: 'やり直す',
      shortcut: 'Ctrl+Shift+Z',
      run: () => store.redo(),
      disabled: !store.canRedo(),
    },
    {
      id: 'shell.resetLayout',
      label: 'パネルの配置を元に戻す',
      run: onResetLayout,
      disabled: false,
      shortcut: undefined,
    },
    ...menuItems.map((m) => ({ ...m, disabled: false })),
  ];
  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="menu-button"
        aria-label="メニュー"
        title="メニュー"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {/* 横棒3本のアイコン */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <rect x="2" y="3" width="12" height="1.6" rx="0.8" fill="currentColor" />
          <rect x="2" y="7.2" width="12" height="1.6" rx="0.8" fill="currentColor" />
          <rect x="2" y="11.4" width="12" height="1.6" rx="0.8" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <ul className="menu-list" role="menu">
          {items.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.run();
                }}
              >
                <span>{item.label}</span>
                {item.shortcut && <kbd>{item.shortcut}</kbd>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Header({ onResetLayout }: { onResetLayout(): void }) {
  const [editor, setEditor] = useEditor();
  const project = useProject();
  const { store } = useServices();
  return (
    <header className="shell-header">
      {/* メニューはモードの並びに混ぜず、左上に置く */}
      <Menu onResetLayout={onResetLayout} />
      <span className="app-title">2D Live Model Creator Studio</span>
      <nav className="mode-tabs" role="tablist" aria-label="モード">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={editor.mode === m.id}
            className={editor.mode === m.id ? 'active' : undefined}
            onClick={() => setEditor({ mode: m.id })}
          >
            {m.label}
          </button>
        ))}
      </nav>
      <button type="button" title="元に戻す（Ctrl+Z）" disabled={!store.canUndo()} onClick={() => store.undo()}>
        ↶
      </button>
      <button type="button" title="やり直す（Ctrl+Shift+Z）" disabled={!store.canRedo()} onClick={() => store.redo()}>
        ↷
      </button>
      <span className="spacer" />
      <span className="project-name">{project.name}</span>
    </header>
  );
}
