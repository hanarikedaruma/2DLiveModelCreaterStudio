// モデリングのキャンバスの状態（表示の変換・アクティブなツール・直前の変形結果）。
// キャンバスの外のパネルからも useCanvas で触れるように、キャンバスとは別に持つ
import type { Vec2 } from '@app/schema';
import type { DeformedModel, HairFrameContext, ParamValues, ViewTransform } from '@app/contracts';
import { screenToCanvas } from './view';

export interface CanvasState {
  view: ViewTransform;
  activeToolId: string; // '' なら既定のツール（最初に登録したもの）
  motionPreview?: { params: ParamValues; context: HairFrameContext } | null;
}

export interface CanvasController {
  getState(): CanvasState;
  subscribe(listener: () => void): () => void;
  setView(view: ViewTransform): void;
  setActiveTool(id: string): void;
  setMotionPreview(value: CanvasState['motionPreview']): void;
  requestRedraw(): void;
  onRedrawRequest(listener: () => void): () => void;
  requestFit(): void;
  onFitRequest(listener: () => void): () => void;
  lastDeformed(): DeformedModel | null;
  setLastDeformed(model: DeformedModel | null): void;
  screenToCanvas(p: Vec2): Vec2;
}

function signal() {
  const listeners = new Set<() => void>();
  return {
    emit: () => {
      for (const l of [...listeners]) l();
    },
    on: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

export function createCanvasController(): CanvasController {
  let state: CanvasState = { view: { scale: 1, offset: { x: 0, y: 0 } }, activeToolId: '' };
  let deformed: DeformedModel | null = null;
  const changed = signal();
  const redraw = signal();
  const fit = signal();

  function set(next: CanvasState) {
    state = next;
    changed.emit();
  }

  return {
    getState: () => state,
    subscribe: changed.on,
    setView(view) {
      if (
        view.scale === state.view.scale &&
        view.offset.x === state.view.offset.x &&
        view.offset.y === state.view.offset.y
      )
        return;
      set({ ...state, view });
    },
    setActiveTool(id) {
      if (id !== state.activeToolId) set({ ...state, activeToolId: id });
    },
    setMotionPreview(motionPreview) {
      if (state.motionPreview !== motionPreview) set({ ...state, motionPreview });
    },
    requestRedraw: redraw.emit,
    onRedrawRequest: redraw.on,
    requestFit: fit.emit,
    onFitRequest: fit.on,
    lastDeformed: () => deformed,
    setLastDeformed(model) {
      deformed = model;
    },
    screenToCanvas: (p) => screenToCanvas(state.view, p),
  };
}
