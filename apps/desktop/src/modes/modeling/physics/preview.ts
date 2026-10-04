// 揺れのお試し（カード50）。物理演算の本物（@app/core の createPhysicsEngine）に、頭を振る動きを入力として与え、
// フレームごとの入力のパラメータの値と揺れパラメータの値を前もって計算する。画面はこれを順に再生する
import type { ParamValues } from '@app/contracts';
import type { Physics, Project } from '@app/schema';
import { createPhysicsEngine, PHYSICS_DEFAULT_INPUTS, physicsAxesOf } from '@app/core';

export const PREVIEW_FPS = 60;
export const PREVIEW_DURATION = 3.2; // 秒
// 頭を振る動き（秒）: 振り始め・振り終わり・戻し始め・戻し終わり
const SWING = { start: 0.2, end: 0.5, backStart: 1.5, backEnd: 1.8 };
// 振る大きさ（入力を −1..1 に直した値で）。顔 左右（−30..30）なら 20°
export const PREVIEW_SWING = 2 / 3;

export interface SwayPreview {
  fps: number;
  frames: ParamValues[]; // フレームごとの値（入力のパラメータと揺れパラメータ）
}

// 振る量（0..1）。始めと終わりがゆっくりの動き
function swingAt(t: number): number {
  const ease = (x: number) => {
    const c = Math.min(1, Math.max(0, x));
    return c * c * (3 - 2 * c);
  };
  if (t < SWING.backStart) return ease((t - SWING.start) / (SWING.end - SWING.start));
  return 1 - ease((t - SWING.backStart) / (SWING.backEnd - SWING.backStart));
}

// 物理の項目が実際に使う入力（空なら物理演算の既定の入力。振り子の最初の向きのもの）
export function effectiveInputs(item: Physics): readonly { parameterId: string; weight: number }[] {
  return item.inputs.length > 0 ? item.inputs : PHYSICS_DEFAULT_INPUTS[physicsAxesOf(item.direction)[0]!];
}

// item の揺れを、頭を振ったときの動きで計算する。入力のパラメータはデフォルト値から PREVIEW_SWING だけ振って戻す
// （端に近くて振れなければ逆へ振る）。計算するのはこの項目だけ。項目が無ければ null
export function simulateSwayPreview(
  project: Project,
  physicsId: string,
  duration = PREVIEW_DURATION,
): SwayPreview | null {
  const item = project.physics.find((ph) => ph.id === physicsId);
  if (!item) return null;
  const params = project.model.parameters;
  const driven = effectiveInputs(item).flatMap(({ parameterId }) => {
    const p = params.find((q) => q.id === parameterId);
    if (!p || !(p.max > p.min)) return [];
    const u0 = ((p.default - p.min) / (p.max - p.min)) * 2 - 1;
    const sign = u0 + PREVIEW_SWING <= 1 ? 1 : -1;
    const valueAt = (s: number) => p.min + ((u0 + sign * PREVIEW_SWING * s + 1) / 2) * (p.max - p.min);
    return [{ id: p.id, valueAt }];
  });

  const engine = createPhysicsEngine();
  const only: Project = { ...project, physics: [item] };
  const dt = 1000 / PREVIEW_FPS;
  const count = Math.max(1, Math.round(duration * PREVIEW_FPS));
  const frames: ParamValues[] = [];
  for (let i = 0; i < count; i++) {
    const s = swingAt(i / PREVIEW_FPS);
    const values: ParamValues = {};
    for (const d of driven) values[d.id] = d.valueAt(s);
    const layer = engine.produce({
      now: i * dt,
      dt: i === 0 ? 0 : dt,
      project: only,
      mixedSoFar: values,
      flags: { lipSyncWeight: 1, physicsActive: true },
    });
    values[item.outputParameterId] = layer?.values[item.outputParameterId] ?? 0;
    frames.push(values);
  }
  return { fps: PREVIEW_FPS, frames };
}
