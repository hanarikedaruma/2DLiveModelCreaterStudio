import { useCallback, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useEditor, useProject, type PanelContext, type PanelDef } from './api';
import { CanvasHost } from './canvas/CanvasHost';
import { useShell } from './context';
import { Header } from './Header';
import { panelsFor, registry } from './registry';
import { getInfoText } from '../help/infoTexts';
import { InfoContent } from '../help/InfoButton';
import {
  clampSize,
  fitColumnWidths,
  LayoutSizesProvider,
  useElementSize,
  useLayoutSizes,
  useResizableSize,
} from './layoutSizes';
import { Splitter } from './splitter';

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

function Panel({
  panel: p,
  collapsed,
  onToggle,
  height,
  onResize,
  width,
  children,
}: {
  panel: PanelDef;
  collapsed: boolean;
  onToggle(): void;
  height?: number;
  onResize?(height: number | null): void;
  width?: number;
  children?: ReactNode;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // ドラッグ中に高さだけが変わるたびに中身まで描き直さないよう、中身の要素は作り直さない
  const content = useMemo(() => <p.component />, [p.component]);
  const infoId = `panel-info-${p.id}`;
  const info = typeof p.info === 'string' ? getInfoText(p.info) : p.info;
  const bodyHeight = dragHeight ?? height;
  const sized = !collapsed && bodyHeight !== undefined;
  const className = ['panel', p.object ? 'object' : null, collapsed ? 'collapsed' : null, sized ? 'sized' : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={className}
      data-panel-id={p.id}
      data-object={p.object?.kind}
      style={width === undefined ? undefined : { width, flex: 'none' }}
    >
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
          <InfoContent info={info} />
        </div>
      )}
      {/* たたんでも中身は外さない（パネルが表示中のあいだツールに services を渡す部品があるため） */}
      <div className="panel-body" hidden={collapsed} ref={bodyRef} style={sized ? { height: bodyHeight } : undefined}>
        {content}
      </div>
      {onResize && !collapsed && (
        <Splitter
          label={`「${p.title}」の高さ`}
          axis="y"
          value={height}
          current={() => height ?? bodyRef.current?.getBoundingClientRect().height ?? 60}
          min={60}
          max={4000}
          className="panel-resize"
          onPreview={setDragHeight}
          onCommit={onResize}
        />
      )}
      {children}
    </div>
  );
}

function Area({
  area,
  panels,
  collapsed,
  toggle,
  width,
  height,
}: {
  area: PanelDef['area'];
  panels: PanelDef[];
  collapsed: ReadonlySet<string>;
  toggle(id: string): void;
  width?: number;
  height?: number;
}) {
  const [editor] = useEditor();
  const sizes = useLayoutSizes();
  const measured = useElementSize<HTMLElement>();
  if (panels.length === 0) return null;
  return (
    <aside
      className={`shell-area shell-area-${area}`}
      data-area={area}
      ref={measured.ref}
      style={area === 'bottom' ? { height } : { width }}
      aria-label={area === 'right' ? '右のパネル' : undefined}
      tabIndex={area === 'right' ? 0 : undefined}
    >
      {panels.map((p, index) => {
        const id = `${editor.mode}.panel.${p.id}`;
        if (area === 'bottom')
          return (
            <BottomPanel
              key={p.id}
              panel={p}
              collapsed={collapsed.has(p.id)}
              onToggle={() => toggle(p.id)}
              available={measured.width || 800}
              count={panels.length}
              last={index === panels.length - 1}
            />
          );
        return (
          <Panel
            key={p.id}
            panel={p}
            collapsed={collapsed.has(p.id)}
            onToggle={() => toggle(p.id)}
            height={sizes.values[id]}
            onResize={(h) => sizes.set(id, h)}
          />
        );
      })}
    </aside>
  );
}

function BottomPanel({
  panel,
  collapsed,
  onToggle,
  available,
  count,
  last,
}: {
  panel: PanelDef;
  collapsed: boolean;
  onToggle(): void;
  available: number;
  count: number;
  last: boolean;
}) {
  const size = useResizableSize(`${panel.mode}.bottom.${panel.id}.width`);
  const max = Math.max(200, available - (count - 1) * 200);
  const width = clampSize(size.value ?? available / count, 200, max);
  return (
    <Panel panel={panel} collapsed={collapsed} onToggle={onToggle} width={last ? undefined : width}>
      {!last && (
        <Splitter
          label={`「${panel.title}」の幅`}
          axis="x"
          value={width}
          current={() => width}
          min={200}
          max={max}
          className="bottom-panel-resize"
          onPreview={size.preview}
          onCommit={size.commit}
        />
      )}
    </Panel>
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

function LayoutBody() {
  const [editor] = useEditor();
  const snapshot = useRegistry();
  const shown = useShownObjectPanels(snapshot.panels.filter((p) => p.mode === editor.mode));
  const inArea = (area: PanelDef['area']) => {
    const panels = panelsFor(snapshot, editor.mode, area);
    return [
      ...panels.filter((p) => p.object?.kind === 'tool' && shown.has(p.id)),
      ...panels.filter((p) => p.object?.kind === 'part' && shown.has(p.id)),
      ...panels.filter((p) => !p.object),
    ];
  };
  const leftPanels = inArea('left');
  const rightPanels = inArea('right');
  const bottomPanels = inArea('bottom');
  const left = useResizableSize(`${editor.mode}.column.left`);
  const right = useResizableSize(`${editor.mode}.column.right`);
  const bottom = useResizableSize(`${editor.mode}.bottom.height`);
  const { reset } = useLayoutSizes();
  const measured = useElementSize<HTMLDivElement>();
  const width = measured.width || window.innerWidth;
  const height = measured.height || window.innerHeight - 42;
  const [leftWidth, rightWidth] = fitColumnWidths(
    width,
    leftPanels.length ? (left.value ?? 280) : 0,
    rightPanels.length ? (right.value ?? 280) : 0,
  );
  const leftMax = Math.max(200, Math.min(560, width - 320 - (rightPanels.length ? 200 : 0)));
  const rightMax = Math.max(200, Math.min(560, width - 320 - leftWidth));
  const bottomMax = Math.max(120, Math.min(Math.floor(height * 0.6), height - 200));
  const bottomHeight = clampSize(bottom.value ?? 220, 120, bottomMax);
  // 全列で1つの一覧を持つ。列ごとに保存すると他の列の変更を上書きしてしまう（I-066）。
  const [collapsed, toggle] = useCollapsedPanels();
  return (
    <div className="shell" data-mode={editor.mode}>
      <Header onResetLayout={reset} />
      <div className="shell-body" ref={measured.ref}>
        <Area
          key={`${editor.mode}.left`}
          area="left"
          panels={leftPanels}
          collapsed={collapsed}
          toggle={toggle}
          width={leftWidth}
        />
        {leftPanels.length > 0 && (
          <div className="column-boundary">
            <Splitter
              key={`${editor.mode}.left`}
              label="左の列の幅"
              axis="x"
              value={leftWidth}
              current={() => leftWidth}
              min={200}
              max={leftMax}
              onPreview={left.preview}
              onCommit={left.commit}
            />
          </div>
        )}
        <div className="shell-center-column">
          <main className="shell-center">
            <Center />
          </main>
          {bottomPanels.length > 0 && (
            <div className="row-boundary">
              <Splitter
                key={`${editor.mode}.bottom`}
                label="下の列の高さ"
                axis="y"
                direction={-1}
                value={bottomHeight}
                current={() => bottomHeight}
                min={120}
                max={bottomMax}
                onPreview={bottom.preview}
                onCommit={bottom.commit}
              />
            </div>
          )}
          <Area
            key={`${editor.mode}.bottom`}
            area="bottom"
            panels={bottomPanels}
            collapsed={collapsed}
            toggle={toggle}
            height={bottomHeight}
          />
        </div>
        {rightPanels.length > 0 && (
          <div className="column-boundary">
            <Splitter
              key={`${editor.mode}.right`}
              label="右の列の幅"
              axis="x"
              direction={-1}
              value={rightWidth}
              current={() => rightWidth}
              min={200}
              max={rightMax}
              onPreview={right.preview}
              onCommit={right.commit}
            />
          </div>
        )}
        <Area
          key={`${editor.mode}.right`}
          area="right"
          panels={rightPanels}
          collapsed={collapsed}
          toggle={toggle}
          width={rightWidth}
        />
      </div>
    </div>
  );
}

export function Layout() {
  return (
    <LayoutSizesProvider>
      <LayoutBody />
    </LayoutSizesProvider>
  );
}
