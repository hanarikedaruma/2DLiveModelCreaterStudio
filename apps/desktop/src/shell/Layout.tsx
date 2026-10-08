import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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

// 右の列で、境目のドラッグで高さを決めたパネルの中身の高さ（px。I-064）。決めていないパネルは中身に合わせる。
// たたみと同じく見ている人ごとの好みで、保存できない環境では覚えない
const HEIGHTS_KEY = 'live2d-studio.panelHeights';
const PANEL_MIN_HEIGHT = 60;
const PANEL_MAX_HEIGHT = 4000;
const PANEL_HEIGHT_STEP = 16;

const clampPanelHeight = (h: number) => Math.round(Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, h)));

function readHeights(): Record<string, number> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HEIGHTS_KEY) ?? '{}');
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const heights: Record<string, number> = {};
    for (const [id, h] of Object.entries(raw)) {
      if (typeof h === 'number' && Number.isFinite(h)) heights[id] = clampPanelHeight(h);
    }
    return heights;
  } catch {
    return {};
  }
}

// height が null なら決めた高さを外す（中身に合わせる）
function usePanelHeights(): [Record<string, number>, (id: string, height: number | null) => void] {
  const [heights, setHeights] = useState(readHeights);
  const setHeight = useCallback(
    (id: string, height: number | null) =>
      setHeights((prev) => {
        const next = { ...prev };
        if (height === null) delete next[id];
        else next[id] = clampPanelHeight(height);
        try {
          localStorage.setItem(HEIGHTS_KEY, JSON.stringify(next));
        } catch {
          // 覚えられなくても動作は続ける
        }
        return next;
      }),
    [],
  );
  return [heights, setHeight];
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

// パネルの下の境目。上下にドラッグすると中身の高さを決め、ダブルクリックで中身に合わせる（決めた高さを外す）。
// ドラッグ中は onDrag で見た目だけを変え、離したときに onResize で決める（押しただけでは高さを決めない）
function PanelResizer({
  title,
  height,
  bodyRef,
  onDrag,
  onResize,
}: {
  title: string;
  height: number | undefined;
  bodyRef: React.RefObject<HTMLDivElement | null>;
  onDrag(height: number | null): void;
  onResize(height: number | null): void;
}) {
  const [dragging, setDragging] = useState(false);
  const endDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => endDragRef.current?.(), []);
  // 今の中身の高さ。決めていなければ、中身に合わせた実際の高さから始める
  const current = () => height ?? bodyRef.current?.getBoundingClientRect().height ?? PANEL_MIN_HEIGHT;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    endDragRef.current?.();
    const drag = { pointerId: e.pointerId, startY: e.clientY, from: current(), to: null as number | null };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== drag.pointerId) return;
      // 押したときの小さなぶれ（ダブルクリックの途中など）では、まだ高さを決めない
      if (drag.to === null && Math.abs(ev.clientY - drag.startY) < 2) return;
      drag.to = clampPanelHeight(drag.from + ev.clientY - drag.startY);
      onDrag(drag.to);
    };
    const end = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      endDragRef.current = null;
      setDragging(false);
      onDrag(null);
      if (commit && drag.to !== null) onResize(drag.to);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId === drag.pointerId) end(true);
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId === drag.pointerId) end(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    endDragRef.current = () => end(false);
    setDragging(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const step = (e.key === 'ArrowUp' ? -1 : 1) * (e.shiftKey ? 4 : 1) * PANEL_HEIGHT_STEP;
    onResize(current() + step);
  };

  return (
    <div
      className={dragging ? 'panel-resize dragging' : 'panel-resize'}
      role="separator"
      aria-orientation="horizontal"
      aria-label={`「${title}」の高さ`}
      aria-valuemin={PANEL_MIN_HEIGHT}
      aria-valuemax={PANEL_MAX_HEIGHT}
      aria-valuenow={height}
      aria-valuetext={height === undefined ? '中身に合わせる' : `${height}px`}
      tabIndex={0}
      title="ドラッグか ↑↓ キーで高さを変える。ダブルクリックで中身に合わせる"
      onPointerDown={onPointerDown}
      onDoubleClick={() => onResize(null)}
      onKeyDown={onKeyDown}
    />
  );
}

function Panel({
  panel: p,
  collapsed,
  onToggle,
  height,
  onResize,
}: {
  panel: PanelDef;
  collapsed: boolean;
  onToggle(): void;
  // 右の列の共通パレットだけが渡す（オブジェクトパレット・左と下の列は高さを決めない）
  height?: number;
  onResize?(height: number | null): void;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // ドラッグ中に高さだけが変わるたびに中身まで描き直さないよう、中身の要素は作り直さない
  const content = useMemo(() => <p.component />, [p.component]);
  const infoId = `panel-info-${p.id}`;
  const bodyHeight = dragHeight ?? height;
  const sized = !collapsed && bodyHeight !== undefined;
  const className = ['panel', p.object ? 'object' : null, collapsed ? 'collapsed' : null, sized ? 'sized' : null]
    .filter(Boolean)
    .join(' ');
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
      <div className="panel-body" hidden={collapsed} ref={bodyRef} style={sized ? { height: bodyHeight } : undefined}>
        {content}
      </div>
      {onResize && !collapsed && (
        <PanelResizer title={p.title} height={height} bodyRef={bodyRef} onDrag={setDragHeight} onResize={onResize} />
      )}
    </div>
  );
}

function Area({ area }: { area: PanelDef['area'] }) {
  const snapshot = useRegistry();
  const [editor] = useEditor();
  const [collapsed, toggle] = useCollapsedPanels();
  const [heights, setHeight] = usePanelHeights();
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
      {ordered.map((p) => {
        // 右の列の共通パレットは、境目のドラッグで高さを決められる（I-064）
        const resizable = area === 'right' && !p.object;
        return (
          <Panel
            key={p.id}
            panel={p}
            collapsed={collapsed.has(p.id)}
            onToggle={() => toggle(p.id)}
            height={resizable ? heights[p.id] : undefined}
            onResize={resizable ? (h) => setHeight(p.id, h) : undefined}
          />
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
