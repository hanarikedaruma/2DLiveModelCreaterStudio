// モデリングの中央のキャンバス。services の evaluator → pipeline → renderer で
// EditorState.editorParamValues の状態を描き、拡大縮小・移動・ツールへの pointer の受け渡しをする
import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { Model, Project, Vec2 } from '@app/schema';
import type { DeformedModel, EditorState, ParamValues, Renderer, ViewTransform } from '@app/contracts';
import {
  useCanvas,
  useEditor,
  useProject,
  type CanvasPointerEvent,
  type CanvasTool,
  type CanvasToolTarget,
} from '../api';
import { useShell } from '../context';
import { isTypingTarget } from '../keys';
import { registry, visibleAt } from '../registry';
import { drawCanvasBanner, drawPickOutline } from './banner';
import { boundsOf, canvasToScreen, fitRect, pan, zoomAt, type Rect } from './view';

// 無いパラメータはデフォルト値
export function paramValuesFor(model: Model, editorValues: ParamValues): ParamValues {
  const out: ParamValues = {};
  for (const p of model.parameters) out[p.id] = editorValues[p.id] ?? p.default;
  return out;
}

const WHEEL_ZOOM = 0.0015;
const CONTEXT_CLICK_SLOP = 4; // 右ボタンをこれより動かして離したら、右クリックとみなさない（画面のピクセル）

// 対象の要るツールで、まだ対象を選んでいない（枠が「対象を選ぶ段」を受け持つ）
export function pickingTarget(
  tool: CanvasTool | undefined,
  project: Project,
  editor: EditorState,
): CanvasToolTarget | null {
  return tool?.target && !tool.target.has(project, editor) ? tool.target : null;
}

// パーツ自身と子孫の、変形後の頂点の外接矩形（画面座標）
function outlineOf(
  model: Model,
  deformed: DeformedModel,
  view: ViewTransform,
  partId: string,
): { min: Vec2; max: Vec2 } | null {
  const parentOf = new Map(model.parts.map((p) => [p.id, p.parentId]));
  const inside = (id: string) => {
    let at: string | null | undefined = id;
    for (let n = 0; at && n < 64; n++) {
      if (at === partId) return true;
      at = parentOf.get(at);
    }
    return false;
  };
  let min = { x: Infinity, y: Infinity };
  let max = { x: -Infinity, y: -Infinity };
  for (const item of deformed.items) {
    if (!inside(item.partId)) continue;
    for (let k = 0; k + 1 < item.positions.length; k += 2) {
      const p = canvasToScreen(view, { x: item.positions[k]!, y: item.positions[k + 1]! });
      min = { x: Math.min(min.x, p.x), y: Math.min(min.y, p.y) };
      max = { x: Math.max(max.x, p.x), y: Math.max(max.y, p.y) };
    }
  }
  return min.x <= max.x && min.y <= max.y ? { min, max } : null;
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

const schedule: (cb: () => void) => void =
  typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(cb) : (cb) => setTimeout(cb, 16);

export function CanvasHost() {
  const { services, canvas: controller } = useShell();
  const project = useProject();
  const [editor] = useEditor();
  const snapshot = useSyncExternalStore(registry.subscribe, registry.get);
  const { view, activeToolId, setActiveTool } = useCanvas();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const cacheRef = useRef<{ model: Model; values: ParamValues; deformed: DeformedModel } | null>(null);
  const scheduledRef = useRef(false);
  const spaceRef = useRef(false);
  const panRef = useRef<{ pointerId: number; start: Vec2; view: typeof view } | null>(null);
  const rightRef = useRef<{ pointerId: number; start: Vec2; moved: boolean } | null>(null);
  const pickRef = useRef<number | null>(null); // 対象を選ぶ段で押している pointer（ツールへは渡さない）
  const hoverRef = useRef<Vec2 | null>(null); // 最後のマウスの位置（キャンバス座標）
  const fittedRef = useRef<string | null>(null);

  const activeTool: CanvasTool | undefined = snapshot.tools.find((t) => t.id === activeToolId);
  // 今のかんたん/詳細で出すツール（I-008）
  const uiLevel = editor.uiLevel[editor.mode];
  const tools = snapshot.tools.filter((t) => visibleAt(t.level, uiLevel));
  // パーツ専用のツール（toolbar: false）はパレットのボタンから切り替えるので、ツールバーには出さない
  const toolbarTools = tools.filter((t) => t.toolbar !== false);
  const picking = pickingTarget(activeTool, project, editor) !== null;

  // 描くときは最新の値を使う
  const latest = useRef({ project, editor, snapshot, activeTool });
  latest.current = { project, editor, snapshot, activeTool };

  const drawNow = useCallback(() => {
    scheduledRef.current = false;
    const renderer = rendererRef.current;
    if (!renderer) return;
    const { project, editor, snapshot, activeTool } = latest.current;
    const currentView = controller.getState().view;
    let cache = cacheRef.current;
    if (!cache || cache.model !== project.model || cache.values !== editor.editorParamValues) {
      const params = paramValuesFor(project.model, editor.editorParamValues);
      const deltas = services.evaluator.evaluate(project.model, params);
      cache = {
        model: project.model,
        values: editor.editorParamValues,
        deformed: services.pipeline.deform(project.model, deltas),
      };
      cacheRef.current = cache;
      controller.setLastDeformed(cache.deformed);
    }
    renderer.render(cache.deformed, currentView, { type: 'transparent' });

    const overlay = overlayRef.current;
    const ctx = overlay?.getContext('2d');
    if (!overlay || !ctx) return;
    const dpr = overlay.clientWidth > 0 ? overlay.width / overlay.clientWidth : 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const o of snapshot.overlays) {
      ctx.save();
      o.draw(ctx, currentView);
      ctx.restore();
    }
    const target = pickingTarget(activeTool, project, editor);
    if (target) {
      // 対象を選ぶ段: マウスの下で選べるものを点線で囲み、次の手順の帯を出す。ツールの重ね描きはしない
      const hover = hoverRef.current;
      const picked = hover ? target.pick(project, cache.deformed, hover) : null;
      const outline = picked ? outlineOf(project.model, cache.deformed, currentView, picked) : null;
      const name = picked ? project.model.parts.find((p) => p.id === picked)?.name : undefined;
      if (outline && name !== undefined) drawPickOutline(ctx, outline.min, outline.max, name);
      drawCanvasBanner(ctx, target.prompt);
    } else if (activeTool?.drawOverlay) {
      ctx.save();
      activeTool.drawOverlay(ctx, currentView);
      ctx.restore();
    }
  }, [controller, services]);

  const requestDraw = useCallback(() => {
    if (scheduledRef.current) return;
    scheduledRef.current = true;
    schedule(drawNow);
  }, [drawNow]);

  // 描画の元になるものが変わったら描き直す
  useEffect(requestDraw, [requestDraw, project, editor, view, snapshot, activeTool]);
  // 使っているツールが今のかんたん/詳細で出ないものになったら、既定のツール（最初に出すもの）に戻す
  const fallbackToolId = tools[0]?.id;
  const activeHidden = activeTool !== undefined && !visibleAt(activeTool.level, uiLevel);
  useEffect(() => {
    if (activeHidden && fallbackToolId !== undefined) setActiveTool(fallbackToolId);
  }, [activeHidden, fallbackToolId, setActiveTool]);
  useEffect(() => controller.onRedrawRequest(requestDraw), [controller, requestDraw]);

  // レンダラー
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = services.createRenderer();
    renderer.init(canvas);
    rendererRef.current = renderer;
    cacheRef.current = null;
    requestDraw();
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [services, requestDraw]);

  // 割り当てている素材だけを渡す。取り込み直後の未使用の画像を一度にGPUへ上げない。
  useEffect(() => {
    const update = () => {
      const images: Record<string, ImageBitmap> = {};
      const ids = new Set(project.model.parts.flatMap((part) => (part.assetId ? [part.assetId] : [])));
      for (const id of ids) {
        const image = services.assets.getImage(id);
        if (image) images[id] = image;
      }
      rendererRef.current?.setTextures(images);
      requestDraw();
    };
    update();
    return services.assets.subscribe(update);
  }, [services, requestDraw, project.model.parts]);

  // [全体を表示]
  const fit = useCallback(() => {
    const { width, height } = sizeRef.current;
    if (width <= 0 || height <= 0) return;
    const { project } = latest.current;
    const canvasSize = project.assets[0]?.canvasSize;
    const deformed = controller.lastDeformed();
    const rect: Rect | null = canvasSize
      ? { x: 0, y: 0, width: canvasSize.width, height: canvasSize.height }
      : deformed
        ? boundsOf(deformed)
        : null;
    controller.setView(fitRect(rect ?? { x: 0, y: 0, width: 1000, height: 1000 }, width, height));
  }, [controller]);
  useEffect(() => controller.onFitRequest(fit), [controller, fit]);

  // プロジェクトを開いたら（素材が入ったら）全体を表示する
  const autoFit = useCallback(() => {
    const { project } = latest.current;
    const key = `${project.id}:${project.assets.length > 0}`;
    if (fittedRef.current === key || sizeRef.current.width <= 0) return;
    fittedRef.current = key;
    fit();
  }, [fit]);
  const hasAssets = project.assets.length > 0;
  useEffect(autoFit, [autoFit, project.id, hasAssets]);

  // 大きさ（CSS ピクセル × devicePixelRatio を実ピクセルにする）
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { width, height };
      for (const c of [canvasRef.current, overlayRef.current]) {
        if (!c) continue;
        c.width = Math.max(1, Math.round(width * dpr));
        c.height = Math.max(1, Math.round(height * dpr));
      }
      autoFit();
      requestDraw();
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [autoFit, requestDraw]);

  // ホイールで拡大縮小（スクロールを止めるため passive にしない）
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = overlay.getBoundingClientRect();
      const at = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      controller.setView(zoomAt(controller.getState().view, at, Math.exp(-delta * WHEEL_ZOOM)));
    };
    overlay.addEventListener('wheel', onWheel, { passive: false });
    return () => overlay.removeEventListener('wheel', onWheel);
  }, [controller]);

  // スペースを押している間はドラッグで移動
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTypingTarget(e.target)) return;
      spaceRef.current = true;
      if (containerRef.current?.contains(document.activeElement)) e.preventDefault();
      containerRef.current?.classList.add('space-pan');
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      spaceRef.current = false;
      containerRef.current?.classList.remove('space-pan');
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const toCanvasEvent = (e: React.PointerEvent): CanvasPointerEvent => {
    const rect = e.currentTarget.getBoundingClientRect();
    const screenPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    return {
      canvasPoint: controller.screenToCanvas(screenPoint),
      screenPoint,
      button: e.button,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey || e.metaKey,
    };
  };

  // 右クリック: ツールに任せる。任せる先が無ければパーツの選択を外す
  const contextClick = (e: CanvasPointerEvent) => {
    if (activeTool?.onContextClick) activeTool.onContextClick(e);
    else if (services.editor.get().selectedPartIds.length > 0) services.editor.set({ selectedPartIds: [] });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    containerRef.current?.focus({ preventScroll: true });
    capture(e.currentTarget, e.pointerId, true);
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      e.preventDefault();
      panRef.current = {
        pointerId: e.pointerId,
        start: { x: e.clientX, y: e.clientY },
        view: controller.getState().view,
      };
      return;
    }
    if (e.button === 2) {
      rightRef.current = { pointerId: e.pointerId, start: { x: e.clientX, y: e.clientY }, moved: false };
      return;
    }
    const event = toCanvasEvent(e);
    hoverRef.current = event.canvasPoint;
    const target = pickingTarget(activeTool, services.store.get(), services.editor.get());
    if (target) {
      // 対象を選ぶ段: 押した所の選べるものを選ぶ。離すまでの操作はツールへ渡さない
      pickRef.current = e.pointerId;
      const deformed = controller.lastDeformed();
      const picked = e.button === 0 && deformed ? target.pick(services.store.get(), deformed, event.canvasPoint) : null;
      if (picked) services.editor.set({ selectedPartIds: [picked] });
      requestDraw();
      return;
    }
    activeTool?.onPointerDown?.(event);
    requestDraw(); // ツールのオーバーレイが変わったかもしれない
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = panRef.current;
    if (p && p.pointerId === e.pointerId) {
      controller.setView(pan(p.view, { x: e.clientX - p.start.x, y: e.clientY - p.start.y }));
      return;
    }
    const r = rightRef.current;
    if (r && r.pointerId === e.pointerId) {
      if (Math.hypot(e.clientX - r.start.x, e.clientY - r.start.y) >= CONTEXT_CLICK_SLOP) r.moved = true;
      return;
    }
    const event = toCanvasEvent(e);
    hoverRef.current = event.canvasPoint;
    if (pickRef.current === e.pointerId) return;
    if (pickingTarget(activeTool, services.store.get(), services.editor.get())) {
      requestDraw(); // 点線の囲みを、マウスの下のものに合わせる
      return;
    }
    if (!activeTool?.onPointerMove) return;
    activeTool.onPointerMove(event);
    requestDraw();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    capture(e.currentTarget, e.pointerId, false);
    if (panRef.current?.pointerId === e.pointerId) {
      panRef.current = null;
      return;
    }
    const r = rightRef.current;
    if (r && r.pointerId === e.pointerId) {
      rightRef.current = null;
      if (!r.moved && e.type !== 'pointercancel') contextClick(toCanvasEvent(e));
      requestDraw();
      return;
    }
    if (pickRef.current === e.pointerId) {
      pickRef.current = null;
      requestDraw();
      return;
    }
    activeTool?.onPointerUp?.(toCanvasEvent(e));
    requestDraw();
  };

  return (
    <div className="canvas-host">
      <div className="canvas-toolbar" role="toolbar" aria-label="キャンバスのツール">
        {toolbarTools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={tool.id === activeToolId ? 'active' : undefined}
            aria-pressed={tool.id === activeToolId}
            onClick={() => setActiveTool(tool.id)}
          >
            {tool.label}
          </button>
        ))}
        <span className="spacer" />
        <span className="canvas-zoom" aria-label="倍率">
          {Math.round(view.scale * 100)}%
        </span>
        <button type="button" onClick={fit}>
          全体を表示
        </button>
      </div>
      <div
        ref={containerRef}
        className="canvas-stage"
        tabIndex={0}
        data-testid="canvas-stage"
        onKeyDown={(e) => {
          if (e.code === 'Space' || !activeTool?.onKeyDown) return;
          activeTool.onKeyDown(e.nativeEvent);
          requestDraw();
        }}
      >
        <canvas ref={canvasRef} className="canvas-main" data-testid="canvas-main" />
        <canvas
          ref={overlayRef}
          className="canvas-overlay"
          data-testid="canvas-overlay"
          style={{ cursor: picking ? 'pointer' : activeTool?.cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
          onAuxClick={(e) => e.preventDefault()}
        />
      </div>
    </div>
  );
}
