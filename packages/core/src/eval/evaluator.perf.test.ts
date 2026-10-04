import type { Binding, Mesh, Vec2 } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { createBindingEvaluator } from './evaluator';
import { delta, lineMesh, medianMs, pointsBinding, testModel, transformBinding } from './testModel';

// 目安は 1ms 未満。CI のばらつきを見込んで 5ms 未満を条件にする
const LIMIT_MS = 5;

function wave(n: number, k: number): Vec2[] {
  return Array.from({ length: n }, (_, i) => ({ x: Math.sin(i + k), y: Math.cos(i * 0.5 + k) }));
}

// 頂点の合計 5,000（200 × 25 メッシュ）・バインディング 200（頂点 150、transform 50）
function heavyModel() {
  const meshes: Mesh[] = [];
  const bindings: Binding[] = [];
  const axis = [-30, -15, 0, 15, 30];
  for (let m = 0; m < 25; m++) {
    const id = `m${m}`;
    meshes.push(lineMesh(id, 200));
    for (const param of ['FaceAngleX', 'FaceAngleY', 'FaceAngleZ', 'EyeBallX']) {
      const values = param === 'EyeBallX' ? [-1, -0.5, 0, 0.5, 1] : axis;
      bindings.push(
        pointsBinding(
          `${id}-${param}`,
          { type: 'mesh', id },
          [param],
          [values],
          values.map((v, k) => [[v], wave(200, k)]),
        ),
      );
    }
    for (let g = 0; g < 2; g++) {
      // 3×3 の格子で、角のキーが欠けている（代用が働く）
      const keys: [number[], Vec2[]][] = [];
      for (const x of [-30, 0, 30])
        for (const y of [-30, 0, 30]) if (x === 0 || y === 0) keys.push([[x, y], wave(200, x + y)]);
      bindings.push(
        pointsBinding(
          `${id}-2d${g}`,
          { type: 'mesh', id },
          ['FaceAngleX', 'FaceAngleY'],
          [
            [-30, 0, 30],
            [-30, 0, 30],
          ],
          keys,
        ),
      );
    }
    for (let t = 0; t < 2; t++) {
      bindings.push(
        transformBinding(
          `${id}-t${t}`,
          `part${m}`,
          [t === 0 ? 'FaceAngleX' : 'MouthOpen'],
          [t === 0 ? axis : [0, 1]],
          (t === 0 ? axis : [0, 1]).map((v) => [[v], delta({ px: v, rot: v / 3, sx: 1 + v / 100 })]),
        ),
      );
    }
  }
  return testModel({ meshes, bindings });
}

describe('createBindingEvaluator: 性能', () => {
  it(`頂点 5,000・バインディング 200 で 1回 ${LIMIT_MS}ms 未満（中央値）`, () => {
    const model = heavyModel();
    expect(model.bindings).toHaveLength(200);
    expect(model.meshes.reduce((n, m) => n + m.vertices.length, 0)).toBe(5000);
    const evaluator = createBindingEvaluator();
    const frames = Array.from({ length: 16 }, (_, i) => ({
      FaceAngleX: -30 + i * 4.1,
      FaceAngleY: 20 - i * 3.3,
      FaceAngleZ: i,
      EyeBallX: Math.sin(i),
      MouthOpen: (i % 5) / 4,
    }));
    let f = 0;
    const ms = medianMs(() => {
      evaluator.evaluate(model, frames[f++ % frames.length]!);
    });
    console.info(`evaluate: ${ms.toFixed(3)} ms（中央値）`);
    expect(ms).toBeLessThan(LIMIT_MS);
  });
});
