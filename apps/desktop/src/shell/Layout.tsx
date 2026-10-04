import { useState, useSyncExternalStore } from 'react';
import { useEditor, useProject, type PanelDef } from './api';
import { CanvasHost } from './canvas/CanvasHost';
import { Header } from './Header';
import { panelsFor, registry } from './registry';

function useRegistry() {
  return useSyncExternalStore(registry.subscribe, registry.get);
}

// たたんだパネルの id（見ている人ごとの好み。保存できない環境では覚えない）
const COLLAPSED_KEY = 'live2d-studio.collapsedPanels';

function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function useCollapsedPanels(): [Set<string>, (id: string) => void] {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // 覚えられなくても動作は続ける
      }
      return next;
    });
  return [collapsed, toggle];
}

function Area({ area }: { area: PanelDef['area'] }) {
  const snapshot = useRegistry();
  const [editor] = useEditor();
  const [collapsed, toggle] = useCollapsedPanels();
  const panels = panelsFor(snapshot, editor.mode, area, editor.uiLevel[editor.mode]);
  if (panels.length === 0) return null;
  return (
    <aside className={`shell-area shell-area-${area}`} data-area={area}>
      {panels.map((p) => {
        const isCollapsed = collapsed.has(p.id);
        return (
          <div key={p.id} className={isCollapsed ? 'panel collapsed' : 'panel'} data-panel-id={p.id}>
            <h2 className="panel-title">
              <button type="button" aria-expanded={!isCollapsed} onClick={() => toggle(p.id)}>
                <span className="panel-caret" aria-hidden="true">
                  {isCollapsed ? '▸' : '▾'}
                </span>
                {p.title}
              </button>
            </h2>
            {/* たたんでも中身は外さない（パネルが表示中のあいだツールに services を渡す部品があるため） */}
            <div className="panel-body" hidden={isCollapsed}>
              <p.component />
            </div>
          </div>
        );
      })}
    </aside>
  );
}

function Center() {
  const snapshot = useRegistry();
  const [editor] = useEditor();
  const project = useProject();
  const Setup = snapshot.setupScreen;
  if (project.assets.length === 0 && Setup) return <Setup />;
  if (editor.mode === 'modeling') return <CanvasHost />;
  const Component = snapshot.centers[editor.mode];
  if (Component) return <Component />;
  return (
    <div className="center-placeholder">{editor.mode === 'studio' ? 'スタジオ' : 'アニメーション'}の画面はまだ無い</div>
  );
}

export function Layout() {
  const [editor] = useEditor();
  return (
    <div className="shell" data-mode={editor.mode}>
      <Header />
      <div className="shell-body">
        <Area area="left" />
        <div className="shell-center-column">
          <main className="shell-center">
            <Center />
          </main>
          <Area area="bottom" />
        </div>
        <Area area="right" />
      </div>
    </div>
  );
}
