// スタジオの中央。出力画面と同じ見た目のライブプレビュー。ドラッグでモデルの位置、ホイールで大きさを変え、シーンに保存する
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Vec2 } from '@app/schema';
import type { Renderer } from '@app/contracts';
import { useDispatch, useServices } from '../../shell/api';
import { hairFrameWarning } from '../../services/hairFrame';
import { HairWarning } from '../../shell/canvas/HairWarning';
import { useStudioBinding } from './binding';
import {
  DEFAULT_MODEL_TRANSFORM,
  fitFrame,
  moveTransform,
  scaleView,
  zoomTransformAt,
  type ModelTransform,
} from './placement';
import { studioRuntime, useStudioOutputSize, useStudioRuntime } from './runtime';
import { activeScene, setModelTransformCommand } from './scene';

const WHEEL_ZOOM = 0.0015;
export const WHEEL_COMMIT_MS = 300; // ホイールが止まってからシーンに保存するまで

function capture(el: Element, pointerId: number, on: boolean) {
  try {
    if (on) el.setPointerCapture?.(pointerId);
    else if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId);
  } catch {
    // 捕まえられなくても操作は続ける
  }
}

export function StudioCenter() {
  useStudioBinding();
  const services = useServices();
  const dispatch = useDispatch();
  const { status } = useStudioRuntime();
  const outputSize = useStudioOutputSize();

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [warning, setWarning] = useState('');
  const warningRef = useRef('');
  const frame = fitFrame(outputSize, stage.width, stage.height);
  const scaleRef = useRef(frame.scale);
  scaleRef.current = frame.scale;
  const dragRef = useRef<{ pointerId: number; start: Vec2; from: ModelTransform } | null>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 途中の配置を確定してシーンに保存する
  const commit = useCallback(() => {
    if (wheelTimer.current !== null) clearTimeout(wheelTimer.current);
    wheelTimer.current = null;
    const t = studioRuntime.modelTransform();
    dispatch(setModelTransformCommand(t));
    studioRuntime.setModelTransformOverride(null);
  }, [dispatch]);

  // 切り替え前の操作が、確定のタイマーや pointerup で別のシーンへ保存されないようにする
  useEffect(() => {
    let sceneId = activeScene(services.store.get())?.id;
    return services.store.subscribe((project) => {
      const nextId = activeScene(project)?.id;
      if (nextId === sceneId) return;
      sceneId = nextId;
      if (wheelTimer.current !== null) clearTimeout(wheelTimer.current);
      wheelTimer.current = null;
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag && canvasRef.current) capture(canvasRef.current, drag.pointerId, false);
      studioRuntime.setModelTransformOverride(null);
    });
  }, [services]);

  // レンダラー
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = services.createRenderer();
    renderer.init(canvas);
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [services]);

  // 素材の画像
  useEffect(() => {
    const update = () => {
      const images: Record<string, ImageBitmap> = {};
      for (const id of Object.keys(services.assets.all())) {
        const image = services.assets.getImage(id);
        if (image) images[id] = image;
      }
      rendererRef.current?.setTextures(images);
    };
    update();
    return services.assets.subscribe(update);
  }, [services]);

  // 毎フレーム、実行部から描かれる
  useEffect(
    () =>
      studioRuntime.setPreview((f) => {
        const message = hairFrameWarning(services.store.get(), f.model);
        if (warningRef.current !== message) {
          warningRef.current = message;
          setWarning(message);
        }
        const renderer = rendererRef.current;
        const k = scaleRef.current;
        if (!renderer || k <= 0) return;
        renderer.render(f.model, scaleView(f.view, k), f.background);
      }),
    [services],
  );

  // 領域の大きさ
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // キャンバスの実ピクセル（CSS ピクセル × devicePixelRatio）
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(frame.width * dpr));
    canvas.height = Math.max(1, Math.round(frame.height * dpr));
  }, [frame.width, frame.height]);

  // ホイールで大きさ（スクロールを止めるため passive にしない）。止まってから保存する
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const k = scaleRef.current;
      if (k <= 0) return;
      const rect = canvas.getBoundingClientRect();
      const at = { x: (e.clientX - rect.left) / k, y: (e.clientY - rect.top) / k };
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const size = studioRuntime.getOutputSize();
      studioRuntime.setModelTransformOverride(
        zoomTransformAt(studioRuntime.modelTransform(), size, at, Math.exp(-delta * WHEEL_ZOOM)),
      );
      if (wheelTimer.current !== null) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(commit, WHEEL_COMMIT_MS);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [commit]);

  // 画面を離れるときに途中の配置を保存する
  useEffect(
    () => () => {
      if (wheelTimer.current !== null || dragRef.current) commit();
    },
    [commit],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    if (wheelTimer.current !== null) commit();
    capture(e.currentTarget, e.pointerId, true);
    dragRef.current = {
      pointerId: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      from: studioRuntime.modelTransform(),
    };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const k = scaleRef.current;
    if (!drag || drag.pointerId !== e.pointerId || k <= 0) return;
    const d = { x: (e.clientX - drag.start.x) / k, y: (e.clientY - drag.start.y) / k };
    studioRuntime.setModelTransformOverride(moveTransform(drag.from, d));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    capture(e.currentTarget, e.pointerId, false);
    dragRef.current = null;
    commit();
  };

  return (
    <div className="studio-center">
      <div className="studio-toolbar" role="toolbar" aria-label="プレビュー">
        <span className="studio-hint">ドラッグで位置、ホイールで大きさを変える</span>
        <span className="spacer" />
        <span className="studio-size" aria-label="出力の解像度">
          {outputSize.width}×{outputSize.height}
        </span>
        <button type="button" onClick={() => dispatch(setModelTransformCommand(DEFAULT_MODEL_TRANSFORM))}>
          配置を戻す
        </button>
      </div>
      <div ref={stageRef} className="studio-stage" data-testid="studio-stage">
        <canvas
          ref={canvasRef}
          className="studio-preview"
          data-testid="studio-preview"
          style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {status === 'lost' && (
          <div className="studio-lost" role="status">
            顔が外れている
          </div>
        )}
        <HairWarning message={warning} />
      </div>
    </div>
  );
}
