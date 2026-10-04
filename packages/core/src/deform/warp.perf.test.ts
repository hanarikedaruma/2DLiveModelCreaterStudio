import type { TargetDeltas } from '@app/contracts';
import type { Mesh, Part, Warp } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { delta, medianMs, testModel } from '../eval/testModel';
import { createDeformPipeline } from './pipeline';
import { groupPart, imagePart, meshOf } from './testParts';
import { regularWarpPoints } from './warp';

// 変形パイプラインの性能の条件（pipeline.perf.test.ts）と同じ 5ms 未満を、ワープがあっても満たすか
const LIMIT_MS = 5;

function warpOn(id: string, partId: string, x: number, y: number, size: number): Warp {
  const bounds = { x, y, width: size, height: size };
  return { id, partId, columns: 8, rows: 8, bounds, points: regularWarpPoints(bounds, 8, 8) };
}

// 頂点の合計 5,000（200 × 25 パーツ）。ルート → 5 グループ → 各 5 パーツ。ルートと全グループに 8×8 のワープと差分がある
function heavy() {
  const parts: Part[] = [groupPart('root', { pivot: { x: 500, y: 500 } })];
  const meshes: Mesh[] = [];
  const warps: Warp[] = [warpOn('w-root', 'root', -100, -100, 1200)];
  const drawOrder: string[] = [];
  const wiggle = (n: number, k: number) => new Float32Array(n * 2).map((_, i) => Math.sin(i * k) * 4);
  const deltas: TargetDeltas = {
    transforms: { root: delta({ rot: 3, px: 2 }) },
    vertices: {},
    warpPoints: { 'w-root': wiggle(81, 0.3) },
  };
  for (let g = 0; g < 5; g++) {
    parts.push(groupPart(`g${g}`, { parentId: 'root', pivot: { x: g * 100, y: 300 } }));
    warps.push(warpOn(`w${g}`, `g${g}`, g * 100 - 10, -10, 420));
    deltas.warpPoints[`w${g}`] = wiggle(81, 0.7 + g);
    deltas.transforms[`g${g}`] = delta({ rot: -g, sx: 1.01 });
    for (let i = 0; i < 5; i++) {
      const id = `p${g}-${i}`;
      const mesh = meshOf(
        `m-${id}`,
        Array.from({ length: 200 }, (_, k) => ({ x: g * 100 + (k % 20) * 5, y: i * 80 + Math.floor(k / 20) * 8 })),
      );
      meshes.push(mesh);
      parts.push(imagePart(id, { parentId: `g${g}`, meshId: mesh.id, pivot: { x: g * 100 + 50, y: i * 80 + 40 } }));
      drawOrder.push(id);
      deltas.transforms[id] = delta({ px: i, rot: i * 2 });
    }
  }
  return { model: testModel({ parts, meshes, warps, drawOrder }), deltas };
}

describe('applyWarp: 性能', () => {
  it(`頂点 5,000・ワープ 2段で 1回 ${LIMIT_MS}ms 未満（中央値）`, () => {
    const { model, deltas } = heavy();
    const pipeline = createDeformPipeline();
    expect(pipeline.deform(model, deltas).items).toHaveLength(25);
    const ms = medianMs(() => {
      pipeline.deform(model, deltas);
    });
    console.info(`deform（ワープあり）: ${ms.toFixed(3)} ms（中央値）`);
    expect(ms).toBeLessThan(LIMIT_MS);
  });
});
