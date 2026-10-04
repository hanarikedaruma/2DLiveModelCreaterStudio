// ヘッダー: モードの切り替え・メニュー・元に戻す/やり直す・プロジェクト名・かんたん/詳細の切り替え（カード27）
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ModeId } from '@app/schema';
import { useEditor, useProject, useServices } from './api';
import { UiLevelToggle } from './level';
import { registry } from './registry';

const MODES: { id: ModeId; label: string }[] = [
  { id: 'modeling', label: 'モデリング' },
  { id: 'animation', label: 'アニメーション' },
  { id: 'studio', label: 'スタジオ' },
];

function Menu() {
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
    ...menuItems.map((m) => ({ ...m, disabled: false })),
  ];
  return (
    <div className="menu" ref={ref}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        メニュー
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

export function Header() {
  const [editor, setEditor] = useEditor();
  const project = useProject();
  const { store } = useServices();
  return (
    <header className="shell-header">
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
      <Menu />
      <button type="button" title="元に戻す（Ctrl+Z）" disabled={!store.canUndo()} onClick={() => store.undo()}>
        ↶
      </button>
      <button type="button" title="やり直す（Ctrl+Shift+Z）" disabled={!store.canRedo()} onClick={() => store.redo()}>
        ↷
      </button>
      <span className="spacer" />
      <span className="project-name">{project.name}</span>
      <UiLevelToggle />
    </header>
  );
}
