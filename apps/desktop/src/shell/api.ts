// アプリの枠の差し込み口（カード05）。各機能のカードはここから import して部品を差し込む。
// 形を変えるときは docs/contract-changes.md に記録すること。
import { createElement, useCallback, useMemo, useSyncExternalStore, type JSX } from 'react';
import type { Environment, ModeId, Project, Vec2 } from '@app/schema';
import type { Command, DeformedModel, EditorState, Services, ViewTransform } from '@app/contracts';
import { useShell } from './context';
import { byOrder, registry, visibleAt } from './registry';

export { emitAppEvent, onAppEvent } from './events';
// かんたん/詳細の部品（カード26）
export { presetOf } from './presets';
export { DetailDisclosure } from './DetailDisclosure';

// ---- パネル・セクション・中央・セットアップ画面・メニュー ----

// オブジェクトパレットを出すかを決めるときに渡すもの
export interface PanelContext {
  project: Project;
  editor: EditorState;
  activeToolId: string;
}

// 見出しの ⓘ で出す説明。何のためのものか（purpose）と、使う流れ（steps）
export interface PanelInfo {
  purpose: string;
  steps: string[];
}

export interface PanelDef {
  id: string;
  mode: ModeId;
  area: 'left' | 'right' | 'bottom';
  title: string;
  order?: number;
  level?: 'easy' | 'detail' | 'both';
  component: React.FC;
  // 指定すると「オブジェクトパレット」になり、when が true の間だけ列のいちばん上に色付きで出す。
  // kind は札（ツール / パーツ）。省略は常に出す「共通パレット」。when は描き直しのたびに呼ぶので軽くする
  object?: { kind: 'tool' | 'part'; when(context: PanelContext): boolean };
  info?: PanelInfo;
}
export function registerPanel(def: PanelDef): void {
  registry.addPanel(def);
}

export interface SectionDef {
  id: string;
  panelId: string;
  order?: number;
  level?: 'easy' | 'detail' | 'both';
  component: React.FC;
}
// パネルの中の <PanelSections panelId=… /> に入る
export function registerPanelSection(def: SectionDef): void {
  registry.addSection(def);
}

export function PanelSections(props: { panelId: string }): JSX.Element {
  const snapshot = useSyncExternalStore(registry.subscribe, registry.get);
  const [editor] = useEditor();
  const panel = snapshot.panels.find((p) => p.id === props.panelId);
  const uiLevel = editor.uiLevel[panel?.mode ?? editor.mode];
  const sections = byOrder(snapshot.sections.filter((s) => s.panelId === props.panelId && visibleAt(s.level, uiLevel)));
  return createElement(
    'div',
    { className: 'panel-sections' },
    sections.map((s) =>
      createElement(
        'section',
        { key: s.id, className: 'panel-section', 'data-section-id': s.id },
        createElement(s.component),
      ),
    ),
  );
}

export function registerCenter(mode: 'studio' | 'animation', component: React.FC): void {
  registry.setCenter(mode, component);
}

// 素材が1つも無いとき中央に出す
export function registerSetupScreen(component: React.FC): void {
  registry.setSetupScreen(component);
}

export interface MenuItem {
  id: string;
  label: string;
  shortcut?: string;
  run(): void;
}
export function registerMenuItem(item: MenuItem): void {
  registry.addMenuItem(item);
}

// ---- キャンバスのツール ----

export interface CanvasPointerEvent {
  canvasPoint: Vec2;
  screenPoint: Vec2;
  button: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
}
export interface CanvasToolTarget {
  prompt: string; // 対象が無いときにキャンバスに出す案内
  has(project: Project, editor: EditorState): boolean; // 対象を選んでいるか
  // キャンバスの点（キャンバス座標）を押したときに選ぶパーツ。その点の画像パーツから決める。null は選べない
  pick(project: Project, deformed: DeformedModel, point: Vec2): string | null;
}
export interface CanvasTool {
  id: string;
  label: string;
  cursor?: string;
  // かんたん/詳細のどちらでツールのボタンを出すか（パネル・セクションの level と同じ。省略は both）
  level?: 'easy' | 'detail' | 'both';
  // false ならツールバーにボタンを出さない（パーツ専用のツールなど、パレットのボタンから切り替えるもの）
  toolbar?: boolean;
  // 対象の要るツール。対象が無い間は、枠が案内の帯・選べるものの点線の囲み・クリックでの選択を受け持ち、
  // ツールへは押した操作を渡さない
  target?: CanvasToolTarget;
  onPointerDown?(e: CanvasPointerEvent): void;
  onPointerMove?(e: CanvasPointerEvent): void;
  onPointerUp?(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  // 右クリック（動かさずに離したとき）。省略するとパーツの選択を外す
  onContextClick?(e: CanvasPointerEvent): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, view: ViewTransform): void;
}
// 最初に登録したものが既定のツール
export function registerCanvasTool(tool: CanvasTool): void {
  registry.addTool(tool);
}
export function registerCanvasOverlay(
  id: string,
  draw: (ctx: CanvasRenderingContext2D, view: ViewTransform) => void,
): void {
  registry.addOverlay(id, draw);
}

export function useCanvas(): {
  motionPreview: ReturnType<import('./canvas/controller').CanvasController['getState']>['motionPreview'];
  view: ViewTransform;
  activeToolId: string;
  setActiveTool(id: string): void;
  requestRedraw(): void;
  lastDeformed(): DeformedModel | null;
  screenToCanvas(p: Vec2): Vec2;
} {
  const { canvas } = useShell();
  const state = useSyncExternalStore(canvas.subscribe, canvas.getState);
  const tools = useSyncExternalStore(registry.subscribe, () => registry.get().tools);
  const activeToolId = tools.some((t) => t.id === state.activeToolId) ? state.activeToolId : (tools[0]?.id ?? '');
  return useMemo(
    () => ({
      motionPreview: state.motionPreview,
      view: state.view,
      activeToolId,
      setActiveTool: canvas.setActiveTool,
      requestRedraw: canvas.requestRedraw,
      lastDeformed: canvas.lastDeformed,
      screenToCanvas: canvas.screenToCanvas,
    }),
    [state.view, state.motionPreview, activeToolId, canvas],
  );
}

// ---- サービス・状態 ----

export function useServices(): Services {
  return useShell().services;
}

export function useProject(): Project {
  const { store } = useShell().services;
  return useSyncExternalStore(store.subscribe, store.get);
}

export function useDispatch(): (c: Command) => void {
  const { store } = useShell().services;
  return useCallback((c: Command) => store.dispatch(c), [store]);
}

export function useEditor(): [EditorState, (patch: Partial<EditorState>) => void] {
  const { editor } = useShell().services;
  const state = useSyncExternalStore(editor.subscribe, editor.get);
  return [state, editor.set];
}

export function useEnvironment(): [Environment, (patch: Partial<Environment>) => void] {
  const { environment } = useShell();
  const env = useSyncExternalStore(environment.subscribe, environment.get);
  return [env, environment.set];
}

export function useDialogs(): {
  confirm(message: string): Promise<boolean>;
  notify(message: string): void;
  prompt(message: string, initial?: string): Promise<string | null>;
} {
  const { dialogs } = useShell();
  return useMemo(() => ({ confirm: dialogs.confirm, notify: dialogs.notify, prompt: dialogs.prompt }), [dialogs]);
}
