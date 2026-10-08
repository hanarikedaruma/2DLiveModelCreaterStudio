import { useCallback, useState, useSyncExternalStore } from 'react';
import { useEditor, useProject, type PanelContext, type PanelDef } from './api';
import { CanvasHost } from './canvas/CanvasHost';
import { useShell } from './context';
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

// 条件に合うオブジェクトパレットの id。プロジェクト・エディタ・キャンバス（ツール）のどれかが変わるたびに
// 決め直すが、組が変わったときだけ列を描き直す（ドラッグ中に列全体を描き直さないよう、文字列で比べる）
function useShownObjectPanels(panels: PanelDef[]): Set<string> {
  const { services, canvas } = useShell();
  const subscribe = useCallback(
    (listener: () => void) => {
      const offs = [
        services.store.subscribe(listener),
        services.editor.subscribe(listener),
        canvas.subscribe(listener),
      ];
      return () => offs.forEach((off) => off());
    },
    [services, canvas],
  );
  const key = useSyncExternalStore(subscribe, () => {
    const objects = panels.filter((p) => p.object);
    if (objects.length === 0) return '';
    const tools = registry.get().tools;
    const toolId = canvas.getState().activeToolId;
    const context: PanelContext = {
      project: services.store.get(),
      editor: services.editor.get(),
      activeToolId: tools.some((t) => t.id === toolId) ? toolId : (tools[0]?.id ?? ''),
    };
    return objects
      .filter((p) => p.object!.when(context))
      .map((p) => p.id)
      .join('\n');
  });
  return new Set(key === '' ? [] : key.split('\n'));
}

const OBJECT_TAG = { tool: 'ツール', part: 'パーツ' } as const;

function Panel({ panel: p, collapsed, onToggle }: { panel: PanelDef; collapsed: boolean; onToggle(): void }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const infoId = `panel-info-${p.id}`;
  const className = ['panel', p.object ? 'object' : null, collapsed ? 'collapsed' : null].filter(Boolean).join(' ');
  return (
    <div className={className} data-panel-id={p.id} data-object={p.object?.kind}>
      <h2 className="panel-title">
        <button type="button" className="panel-toggle" aria-expanded={!collapsed} onClick={onToggle}>
          <span className="panel-caret" aria-hidden="true">
            {collapsed ? '▸' : '▾'}
          </span>
          {p.title}
        </button>
        {p.object && <span className="panel-tag">{OBJECT_TAG[p.object.kind]}</span>}
        {p.info && (
          <button
            type="button"
            className="panel-info-button"
            aria-label={`「${p.title}」の説明`}
            aria-expanded={infoOpen}
            aria-controls={infoId}
            onClick={() => setInfoOpen((open) => !open)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && infoOpen) setInfoOpen(false);
            }}
          >
            ⓘ
          </button>
        )}
      </h2>
      {p.info && infoOpen && (
        <div className="panel-info" id={infoId} role="note" aria-label={`「${p.title}」の説明`}>
          <p className="panel-info-purpose">{p.info.purpose}</p>
          <ol className="panel-info-steps">
            {p.info.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      )}
      {/* たたんでも中身は外さない（パネルが表示中のあいだツールに services を渡す部品があるため） */}
      <div className="panel-body" hidden={collapsed}>
        <p.component />
      </div>
    </div>
  );
}

function Area({ area }: { area: PanelDef['area'] }) {
  const snapshot = useRegistry();
  const [editor] = useEditor();
  const [collapsed, toggle] = useCollapsedPanels();
  const panels = panelsFor(snapshot, editor.mode, area, editor.uiLevel[editor.mode]);
  const shown = useShownObjectPanels(panels);
  // オブジェクトパレット（ツール → パーツ）を上に、共通パレットをその下に並べる
  const ordered = [
    ...panels.filter((p) => p.object?.kind === 'tool' && shown.has(p.id)),
    ...panels.filter((p) => p.object?.kind === 'part' && shown.has(p.id)),
    ...panels.filter((p) => !p.object),
  ];
  if (ordered.length === 0) return null;
  return (
    <aside
      className={`shell-area shell-area-${area}`}
      data-area={area}
      aria-label={area === 'right' ? '右のパネル' : undefined}
      tabIndex={area === 'right' ? 0 : undefined}
    >
      {ordered.map((p) => (
        <Panel key={p.id} panel={p} collapsed={collapsed.has(p.id)} onToggle={() => toggle(p.id)} />
      ))}
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
