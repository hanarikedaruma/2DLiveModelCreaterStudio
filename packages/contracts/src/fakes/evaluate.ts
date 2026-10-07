import type { BlendOp, Model, Parameter, Part, Vec2 } from '@app/schema';
import {
  LAYER_ORDER,
  type BindingEvaluator,
  type DeformPipeline,
  type DeformedModel,
  type DrawItem,
  type Layer,
  type ParamValues,
  type ParameterMixer,
  type TargetDeltas,
} from '../index';

export function emptyDeltas(): TargetDeltas {
  return { transforms: {}, vertices: {}, warpPoints: {} };
}

// 差分なし（すべて空）を返す
export class FakeEvaluator implements BindingEvaluator {
  evaluate(_model: Model, _params: ParamValues): TargetDeltas {
    return emptyDeltas();
  }
}

// パーツの基本の変形（pivot を中心に拡縮 → 回転、そのあと position だけ移動）。回転は画面上の時計回りが正
export function transformPoint(part: Pick<Part, 'position' | 'rotation' | 'scale' | 'pivot'>, p: Vec2): Vec2 {
  const rad = (part.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const x = (p.x - part.pivot.x) * part.scale.x;
  const y = (p.y - part.pivot.y) * part.scale.y;
  return {
    x: x * cos - y * sin + part.pivot.x + part.position.x,
    y: x * sin + y * cos + part.pivot.y + part.position.y,
  };
}

// 表示中の画像パーツを、素材の矩形（offset と幅・高さ）を覆う三角形2枚にし、自身のパーツの基本の変形だけを掛ける。順番は drawOrder
export class FakePipeline implements DeformPipeline {
  constructor(private readonly assetsOf: () => { id: string; offset: Vec2; width: number; height: number }[]) {}

  deform(model: Model, _deltas: TargetDeltas): DeformedModel {
    const assets = new Map(this.assetsOf().map((a) => [a.id, a]));
    const parts = new Map(model.parts.map((p) => [p.id, p]));
    const items: DrawItem[] = [];
    const byPartId: Record<string, DrawItem> = {};
    for (const partId of model.drawOrder) {
      const part = parts.get(partId);
      if (!part || part.kind !== 'image' || !part.visible || !part.assetId) continue;
      const asset = assets.get(part.assetId);
      if (!asset) continue;
      const { x, y } = asset.offset;
      const corners = [
        { x, y },
        { x: x + asset.width, y },
        { x: x + asset.width, y: y + asset.height },
        { x, y: y + asset.height },
      ].map((c) => transformPoint(part, c));
      const item: DrawItem = {
        partId: part.id,
        assetId: part.assetId,
        positions: new Float32Array(corners.flatMap((c) => [c.x, c.y])),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        opacity: part.opacity,
        blendMode: part.blendMode,
        mask: part.mask ? { sourcePartIds: [...part.mask.sourcePartIds], inverted: part.mask.inverted } : null,
      };
      items.push(item);
      byPartId[part.id] = item;
    }
    return { items, byPartId };
  }
}

// デフォルト値に、各レイヤーの値を重みで合わせる。順は本物と同じ LAYER_ORDER（同じ id の中は配列の順）。
// 合成の方法（add・multiply・max・override）・パラメータ別の重み・範囲への丸めも本物（core の mixer）と同じ規則にする。
// contracts は core に頼れないので写しを持つ（同じ値になることは core の mixer.c65.test.ts で確かめる。カード65）
function blend(op: BlendOp, v: number, t: number, w: number): number {
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

const unit = (w: number) => (Number.isNaN(w) ? 0 : Math.min(1, Math.max(0, w)));

export class FakeMixer implements ParameterMixer {
  mix(parameters: Parameter[], layers: Layer[]): ParamValues {
    const out: ParamValues = {};
    const first = new Map<string, Parameter>(); // 同じ id が2つあれば、本物と同じく最初のものを使う
    for (const p of parameters) {
      if (first.has(p.id)) continue;
      first.set(p.id, p);
      out[p.id] = p.default;
    }
    const ordered = LAYER_ORDER.flatMap((id) => layers.filter((l) => l.id === id));
    for (const layer of ordered) {
      for (const [id, t] of Object.entries(layer.values)) {
        if (!Object.hasOwn(out, id) || typeof t !== 'number' || !Number.isFinite(t)) continue;
        const weight =
          layer.parameterWeights && Object.hasOwn(layer.parameterWeights, id)
            ? layer.parameterWeights[id]!
            : unit(layer.weight);
        const op = layer.blend && Object.hasOwn(layer.blend, id) ? layer.blend[id]! : 'override';
        out[id] = blend(op, out[id]!, t, unit(weight));
      }
    }
    for (const [id, p] of first) out[id] = Math.min(p.max, Math.max(p.min, out[id]!));
    return out;
  }
}
