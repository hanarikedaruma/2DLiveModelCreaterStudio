// 閉じた目の線をなぞるキャンバスのツール（カード42）。パネルで選んだ側の目に、ドラッグでなぞった線を
// Model.setupHints（closedLineL / closedLineR、キャンバス座標）に保存する（1回の Undo）。
// 目専用なのでツールバーには出さず、「閉じた目の線」のパレットのボタンから使う。1本保存するか、
// Esc・右クリックでやめると、パレットが決めた元のツールに戻る（finish）
import { mapMeshPoint, type ClosedEyeLine, type Vec2 } from '@app/schema';
import { eyeGuideEdges } from '@app/core';
import type { CanvasTool } from '../../../shell/api';
import { drawCanvasBanner } from '../../../shell/canvas/banner';
import { canvasToScreen } from '../../../shell/canvas/view';
import type { EnvSlot } from '../canvas/env';
import { distance } from '../canvas/geometry';
import {
  EYE_SIDES,
  SCREEN_SIDE,
  attachStroke,
  closedLineOf,
  eyeDisplay,
  lineOnScreen,
  selectedEyeSides,
  setClosedLine,
  type EyeSide,
} from './closedLine';

export const CLOSED_LINE_TOOL_ID = 'modeling.closedLine';
export const SHORT_LINE_MESSAGE = '線が短いので保存しなかった。目の端から端まで横になぞる';

const MIN_STEP = 2; // 点を足す間隔（画面のピクセル）

export interface SideStore {
  get(): EyeSide;
  set(side: EyeSide): void;
  subscribe(listener: () => void): () => void;
}

export interface ClosedLineTool {
  tool: CanvasTool;
  side: SideStore; // なぞる目（パネルで選ぶ）
  // なぞり終えた・やめたときに呼ぶもの（パレットが元のツールに戻す処理を入れる）
  setFinish(finish: (() => void) | null): void;
  setEditing(editing: boolean): void;
  isEditing(): boolean;
  drawSaved(ctx: CanvasRenderingContext2D, view: Parameters<NonNullable<CanvasTool['drawOverlay']>>[1]): void;
  stroke(): Vec2[] | null; // なぞっている途中の点（キャンバス座標）。テスト用
}

export const tracingHint = (side: EyeSide) =>
  `目 ${side}（画面の${SCREEN_SIDE[side]}）の閉じたときのまぶたの下の端を、目の端から端までドラッグでなぞる（Esc・右クリックでやめる）`;

function createSideStore(): SideStore {
  let side: EyeSide = 'L';
  const listeners = new Set<() => void>();
  return {
    get: () => side,
    set(next) {
      if (next === side) return;
      side = next;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function cssVar(name: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

export function createClosedLineTool(slot: EnvSlot): ClosedLineTool {
  const side = createSideStore();
  // なぞっている途中の点（キャンバス座標）と、最後に足した点の画面の位置
  let stroke: { points: Vec2[]; lastScreen: Vec2 } | null = null;
  let finish: (() => void) | null = null;
  let editing = false;
  let drag: { line: ClosedEyeLine; index: number; points: Vec2[]; start: Vec2 } | null = null;

  const polyline = (ctx: CanvasRenderingContext2D, points: Vec2[], toScreen: (p: Vec2) => Vec2) => {
    ctx.beginPath();
    points.map(toScreen).forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  };

  const tool: CanvasTool = {
    id: CLOSED_LINE_TOOL_ID,
    label: '閉じた目の線をなぞる',
    cursor: 'crosshair',
    toolbar: false,

    onPointerDown(e) {
      const env = slot.get();
      if (e.button !== 0 || !env) return;
      if (editing) {
        const line = closedLineOf(env.services.store.get().model, side.get());
        const points = line && lineOnScreen(env.services, line);
        const index = points?.findIndex((p) => distance(canvasToScreen(env.view(), p), e.screenPoint) <= 8) ?? -1;
        if (line && points && index >= 0) drag = { line, points, index, start: e.canvasPoint };
        return;
      }
      stroke = { points: [e.canvasPoint], lastScreen: e.screenPoint };
    },

    onPointerMove(e) {
      if (drag) {
        drag.points[drag.index] = e.canvasPoint;
        slot.get()?.requestRedraw();
        return;
      }
      if (!stroke || distance(e.screenPoint, stroke.lastScreen) < MIN_STEP) return;
      stroke.points.push(e.canvasPoint);
      stroke.lastScreen = e.screenPoint;
    },

    onPointerUp(e) {
      if (drag) {
        const current = drag;
        drag = null;
        const env = slot.get();
        if (!env || distance(current.start, e.canvasPoint) < 0.1) return;
        current.points[current.index] = e.canvasPoint;
        const line = attachStroke(env.services, side.get(), current.points, current.line.partId ?? undefined);
        if (line) env.services.store.dispatch(setClosedLine(side.get(), line));
        else env.dialogs.notify('この姿勢では線を画像へ付けられません。目を開いてから直してください。');
        env.requestRedraw();
        return;
      }
      const current = stroke;
      stroke = null;
      const env = slot.get();
      if (!current || !env) return;
      if (distance(e.screenPoint, current.lastScreen) > 0) current.points.push(e.canvasPoint);
      const line = attachStroke(env.services, side.get(), current.points);
      if (!line) {
        env.dialogs.notify(SHORT_LINE_MESSAGE);
        return;
      }
      env.services.store.dispatch(setClosedLine(side.get(), line));
      env.requestRedraw();
      finish?.();
    },

    // なぞりかけなら取り消す。なぞっていなければやめて元のツールに戻る
    onKeyDown(e) {
      if (e.key !== 'Escape') return;
      if (drag) drag = null;
      else if (stroke) stroke = null;
      else finish?.();
    },

    onContextClick() {
      stroke = null;
      drag = null;
      finish?.();
    },

    // 保存した両目の線（なぞる側を強調）と、なぞっている途中の線を描く
    drawOverlay(ctx, view) {
      const env = slot.get();
      if (!env) return;
      const model = env.services.store.get().model;
      if (!editing) {
        ctx.strokeStyle = '#9aa0a6';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        for (const type of [`eyeWhite${side.get()}`, `upperLid${side.get()}`]) {
          const part = model.parts.find((p) => p.standardType === type);
          const display = part && eyeDisplay(env.services, part.id);
          if (!part || !display) continue;
          for (const edge of eyeGuideEdges(model, part.id)) {
            const points = edge.map((uv) => mapMeshPoint(display.mesh, display.mesh.uvs, display.positions, uv));
            if (points.every((p): p is Vec2 => p !== null)) polyline(ctx, points, (p) => canvasToScreen(view, p));
          }
        }
        ctx.setLineDash([]);
      }
      const toScreen = (p: Vec2) => canvasToScreen(view, p);
      const accent = cssVar('--accent', '#5b8def');
      if (stroke && stroke.points.length > 1) {
        ctx.strokeStyle = accent;
        ctx.setLineDash([4, 3]);
        polyline(ctx, stroke.points, toScreen);
        ctx.setLineDash([]);
      }
      drawCanvasBanner(ctx, editing ? '線の点をドラッグして直す（Esc・右クリックで終了）' : tracingHint(side.get()));
    },
  };

  const drawSaved: ClosedLineTool['drawSaved'] = (ctx, view) => {
    const env = slot.get();
    if (!env) return;
    const model = env.services.store.get().model;
    const selected = selectedEyeSides(model, env.services.editor.get().selectedPartIds);
    ctx.lineWidth = 2;
    for (const s of EYE_SIDES.filter((s) => selected.includes(s))) {
      const line = closedLineOf(model, s);
      const points = drag && s === side.get() ? drag.points : line && lineOnScreen(env.services, line);
      if (!points || points.length < 2) continue;
      ctx.strokeStyle = cssVar('--accent', '#5b8def');
      polyline(ctx, points, (p) => canvasToScreen(view, p));
      ctx.fillStyle = ctx.strokeStyle;
      for (const point of points) {
        const p = canvasToScreen(view, point);
        ctx.beginPath();
        ctx.arc(p.x, p.y, editing ? 4 : 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  return {
    tool,
    side,
    setEditing(next) {
      editing = next;
      drag = null;
      stroke = null;
    },
    isEditing: () => editing,
    drawSaved,
    setFinish(next) {
      finish = next;
    },
    stroke: () => (stroke ? [...stroke.points] : null),
  };
}
