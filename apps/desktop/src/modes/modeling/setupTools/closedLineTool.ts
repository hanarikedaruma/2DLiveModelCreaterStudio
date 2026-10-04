// 閉じた目の線をなぞるキャンバスのツール（カード42）。パネルで選んだ側の目に、ドラッグでなぞった線を
// Model.setupHints（closedLineL / closedLineR、キャンバス座標）に保存する（1回の Undo）
import type { Vec2 } from '@app/schema';
import type { CanvasTool } from '../../../shell/api';
import { canvasToScreen } from '../../../shell/canvas/view';
import type { EnvSlot } from '../canvas/env';
import { distance } from '../canvas/geometry';
import { EYE_SIDES, closedLineOf, setClosedLine, strokeToLine, type EyeSide } from './closedLine';

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
  stroke(): Vec2[] | null; // なぞっている途中の点（キャンバス座標）。テスト用
}

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

  const polyline = (ctx: CanvasRenderingContext2D, points: Vec2[], toScreen: (p: Vec2) => Vec2) => {
    ctx.beginPath();
    points.map(toScreen).forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  };

  const tool: CanvasTool = {
    id: CLOSED_LINE_TOOL_ID,
    label: '閉じた線のなぞり',
    cursor: 'crosshair',

    onPointerDown(e) {
      if (e.button !== 0 || !slot.get()) return;
      stroke = { points: [e.canvasPoint], lastScreen: e.screenPoint };
    },

    onPointerMove(e) {
      if (!stroke || distance(e.screenPoint, stroke.lastScreen) < MIN_STEP) return;
      stroke.points.push(e.canvasPoint);
      stroke.lastScreen = e.screenPoint;
    },

    onPointerUp(e) {
      const current = stroke;
      stroke = null;
      const env = slot.get();
      if (!current || !env) return;
      if (distance(e.screenPoint, current.lastScreen) > 0) current.points.push(e.canvasPoint);
      const line = strokeToLine(current.points);
      if (!line) {
        env.dialogs.notify(SHORT_LINE_MESSAGE);
        return;
      }
      env.services.store.dispatch(setClosedLine(side.get(), line));
      env.requestRedraw();
    },

    onKeyDown(e) {
      if (e.key === 'Escape') stroke = null;
    },

    // 保存した両目の線（なぞる側を強調）と、なぞっている途中の線を描く
    drawOverlay(ctx, view) {
      const env = slot.get();
      if (!env) return;
      const model = env.services.store.get().model;
      const toScreen = (p: Vec2) => canvasToScreen(view, p);
      const accent = cssVar('--accent', '#5b8def');
      ctx.lineWidth = 2;
      for (const s of EYE_SIDES) {
        const line = closedLineOf(model, s);
        if (!line || line.length === 0) continue;
        const current = s === side.get();
        ctx.strokeStyle = current ? accent : '#9aa0a6';
        ctx.globalAlpha = current ? 1 : 0.7;
        polyline(ctx, line, toScreen);
        ctx.fillStyle = ctx.strokeStyle;
        for (const end of [line[0]!, line[line.length - 1]!]) {
          const p = toScreen(end);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (stroke && stroke.points.length > 1) {
        ctx.strokeStyle = accent;
        ctx.setLineDash([4, 3]);
        polyline(ctx, stroke.points, toScreen);
        ctx.setLineDash([]);
      }
    },
  };

  return { tool, side, stroke: () => (stroke ? [...stroke.points] : null) };
}
