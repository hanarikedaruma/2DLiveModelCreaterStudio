import type { BlendOp, Parameter } from '@app/schema';
import { LAYER_ORDER, type Layer, type ParamValues, type ParameterMixer } from '@app/contracts';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

// 値 v にレイヤーの値 t を重み w（0..1）で合わせる
export function blendValue(op: BlendOp, v: number, t: number, w: number): number {
  switch (op) {
    case 'add':
      return v + t * w;
    case 'multiply':
      return v * (1 + (t - 1) * w);
    case 'max':
      return v + (Math.max(v, t) - v) * w;
    case 'override':
    default:
      return v + (t - v) * w;
  }
}

// レイヤーを LAYER_ORDER の順に合成して、パラメータの値にする（カード09）。
// 引数の配列の順は使わない（同じ id のレイヤーが複数あれば、その中では配列の順）
export function createParameterMixer(): ParameterMixer {
  return {
    mix(parameters: Parameter[], layers: Layer[]): ParamValues {
      const index = new Map<string, number>();
      const values = new Float64Array(parameters.length);
      parameters.forEach((p, i) => {
        if (!index.has(p.id)) index.set(p.id, i);
        values[i] = p.default;
      });

      for (const layerId of LAYER_ORDER) {
        for (const layer of layers) {
          if (layer.id !== layerId) continue;
          const w = Number.isNaN(layer.weight) ? 0 : clamp(layer.weight, 0, 1);
          for (const id of Object.keys(layer.values)) {
            const i = index.get(id);
            const t = layer.values[id];
            // 知らない id と、数でない値は使わない
            if (i === undefined || typeof t !== 'number' || !Number.isFinite(t)) continue;
            const op = layer.blend && Object.hasOwn(layer.blend, id) ? layer.blend[id]! : 'override';
            values[i] = blendValue(op, values[i]!, t, w);
          }
        }
      }

      const out: ParamValues = {};
      for (const [id, i] of index) {
        const p = parameters[i]!;
        out[id] = clamp(values[i]!, p.min, p.max);
      }
      return out;
    },
  };
}
