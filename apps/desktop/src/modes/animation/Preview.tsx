// アニメーション画面のプレビュー（カード46）。モデリングと同じ evaluator → pipeline → renderer で、
// 渡された値（時刻 t でトラックを補間した値）の状態を描く。モデルのキャンバス全体を領域に収めて表示する
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ParamValues, Renderer } from '@app/contracts';
import { HairDynamicsSession } from '@app/core';
import { hairFrames } from '../../services/hairFrame';
import { useAnimationEditor } from './state';
import { selectedAnimation } from './state';
import { sampleAnimation } from './keyframes';
import { useProject, useServices } from '../../shell/api';
import { boundsOf, fitRect } from '../../shell/canvas/view';

const FALLBACK_RECT = { x: 0, y: 0, width: 1000, height: 1000 };

export function AnimationPreview({ values }: { values: ParamValues }) {
  const services = useServices();
  const project = useProject();
  const [animationState] = useAnimationEditor();
  const session = useRef(new HairDynamicsSession());
  const lastMotion = useRef<{
    id: string | null;
    time: number;
    now: number;
    seek: number;
    project: typeof project;
  } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [textures, setTextures] = useState(0); // 素材の画像が変わったら描き直す

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
      setTextures((n) => n + 1);
    };
    update();
    return services.assets.subscribe(update);
  }, [services]);

  // 大きさ（CSS ピクセル × devicePixelRatio を実ピクセルにする）
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const resize = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
      }
      setSize({ width, height });
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // 値・モデル・大きさが変わったら描く
  const model = project.model;
  const canvasSize = project.assets[0]?.canvasSize;
  useEffect(() => {
    const now = performance.now();
    const previous = lastMotion.current;
    const playing = animationState.playback !== 'stopped';
    const animation = selectedAnimation(project, animationState);
    const continuousLoop =
      animationState.playback === 'loop' &&
      !!animation &&
      previous &&
      animationState.time < previous.time &&
      JSON.stringify(sampleAnimation(animation, model.parameters, 0)) ===
        JSON.stringify(sampleAnimation(animation, model.parameters, animation.duration));
    const discontinuous =
      !previous ||
      previous.project !== project ||
      previous.seek !== (animationState.seekRevision ?? 0) ||
      previous.id !== animationState.animationId ||
      (!continuousLoop && (animationState.time < previous.time || Math.abs(animationState.time - previous.time) > 0.1));
    if (!playing || discontinuous) session.current.reset();
    const deformed = hairFrames(services).evaluate(
      project,
      values,
      playing
        ? { now, dt: discontinuous ? 0 : now - previous!.now, frameId: animationState.time, active: true }
        : undefined,
      playing ? session.current : undefined,
    );
    lastMotion.current = {
      id: animationState.animationId,
      time: animationState.time,
      now,
      seek: animationState.seekRevision ?? 0,
      project,
    };
    const rect = canvasSize
      ? { x: 0, y: 0, width: canvasSize.width, height: canvasSize.height }
      : (boundsOf(deformed) ?? FALLBACK_RECT);
    rendererRef.current?.render(deformed, fitRect(rect, size.width, size.height), { type: 'transparent' });
  }, [services, project, model, values, canvasSize, size, textures, animationState]);

  return (
    <div ref={stageRef} className="anim-stage" data-testid="animation-preview">
      <canvas ref={canvasRef} className="anim-preview" />
    </div>
  );
}
