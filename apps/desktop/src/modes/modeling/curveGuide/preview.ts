import type { ParamValues, Services } from '@app/contracts';
import { axisOutputsFor, createPhysicsEngine } from '@app/core';
import type { CanvasController } from '../../../shell/canvas/controller';

const previews = new WeakMap<CanvasController, () => void>();
export function stopFlowPreview(canvas: CanvasController): void {
  previews.get(canvas)?.();
}
export function startFlowPreview(services: Services, canvas: CanvasController, partId: string): boolean {
  stopFlowPreview(canvas);
  const project = services.store.get();
  const axes = new Set(axisOutputsFor(project, partId));
  const candidates = project.model.parameters
    .filter(
      (p) =>
        !axes.has(p.id) &&
        project.model.bindings.some((b) => b.parameterIds.includes(p.id)) &&
        (p.groupId === 'face' || p.groupId === 'body'),
    )
    .slice(0, 3);
  if (!candidates.length) return false;
  const defaults: ParamValues = Object.fromEntries(project.model.parameters.map((p) => [p.id, p.default]));
  const physics = createPhysicsEngine();
  const startedAt = performance.now();
  let previous = 0;
  let handle: ReturnType<typeof setTimeout> | number | null = null;
  let stopped = false;
  const offs: (() => void)[] = [];
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (handle !== null) {
      if (typeof handle === 'number' && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
      else clearTimeout(handle);
    }
    offs.forEach((off) => off());
    if (previews.get(canvas) === stop) {
      previews.delete(canvas);
      canvas.setMotionPreview(null);
    }
  };
  previews.set(canvas, stop);
  offs.push(
    services.store.subscribe((next) => {
      if (next !== project) stop();
    }),
  );
  offs.push(
    services.editor.subscribe((next) => {
      if (next.mode !== 'modeling') stop();
    }),
  );
  const tick = () => {
    if (stopped) return;
    const now = performance.now() - startedAt;
    if (now >= 4000) {
      stop();
      return;
    }
    const t = now / 1000;
    const ease = (v: number) => {
      const x = Math.min(1, Math.max(0, v));
      return x * x * (3 - 2 * x);
    };
    const swing = ease((t - 0.2) / 0.4) - ease((t - 1.4) / 0.4);
    const params = { ...defaults };
    for (const p of candidates) params[p.id] = p.default + Math.min(p.max - p.default, (p.max - p.min) / 3) * swing;
    const output = physics.produce({
      project,
      now,
      dt: now - previous,
      mixedSoFar: params,
      flags: { physicsActive: true, lipSyncWeight: 1 },
    });
    Object.assign(params, output?.values);
    canvas.setMotionPreview({ params, context: { now, dt: now - previous, frameId: now, active: true } });
    previous = now;
    handle = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(tick) : setTimeout(tick, 16);
  };
  tick();
  return true;
}
