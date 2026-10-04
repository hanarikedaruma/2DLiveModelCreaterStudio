import type { TargetDeltas } from '@app/contracts';
import type { Mesh, Part } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { delta, medianMs, testModel } from '../eval/testModel';
import { createDeformPipeline } from './pipeline';
import { groupPart, imagePart, meshOf } from './testParts';

// 目安は 1ms 未満。CI のばらつきを見込んで 5ms 未満を条件にする
const LIMIT_MS = 5;

// 頂点の合計 5,000（200 × 25 パーツ）。ルート → 5 グループ → 各 5 パーツの3段で、すべてに変形の差分がある
function heavy() {
  const parts: Part[] = [groupPart('root', { pivot: { x: 500, y: 500 } })];
  const meshes: Mesh[] = [];
  const drawOrder: string[] = [];
  const deltas: TargetDeltas = { transforms: { root: delta({ rot: 3, px: 2 }) }, vertices: {}, warpPoints: {} };
  for (let g = 0; g < 5; g++) {
    parts.push(groupPart(`g${g}`, { parentId: 'root', pivot: { x: g * 100, y: 300 }, opacity: 0.9 }));
    deltas.transforms[`g${g}`] = delta({ rot: -g, sx: 1.01, op: 0.9 });
    for (let i = 0; i < 5; i++) {
      const id = `p${g}-${i}`;
      const mesh = meshOf(
        `m-${id}`,
        Array.from({ length: 200 }, (_, k) => ({ x: g * 100 + (k % 20) * 5, y: i * 80 + Math.floor(k / 20) * 8 })),
      );
      meshes.push(mesh);
      parts.push(imagePart(id, { parentId: `g${g}`, meshId: mesh.id, pivot: { x: g * 100 + 50, y: i * 80 + 40 } }));
      drawOrder.push(id);
      deltas.transforms[id] = delta({ px: i, py: -i, rot: i * 2, sy: 0.98 });
      deltas.vertices[mesh.id] = new Float32Array(400).map((_, k) => Math.sin(k));
    }
  }
  return { model: testModel({ parts, meshes, drawOrder }), deltas };
}

describe('createDeformPipeline: 性能', () => {
  it(`頂点 5,000 で 1回 ${LIMIT_MS}ms 未満（中央値）`, () => {
    const { model, deltas } = heavy();
    expect(model.meshes.reduce((n, m) => n + m.vertices.length, 0)).toBe(5000);
    const pipeline = createDeformPipeline();
    expect(pipeline.deform(model, deltas).items).toHaveLength(25);
    const ms = medianMs(() => {
      pipeline.deform(model, deltas);
    });
    console.info(`deform: ${ms.toFixed(3)} ms（中央値）`);
    expect(ms).toBeLessThan(LIMIT_MS);
  });
});
