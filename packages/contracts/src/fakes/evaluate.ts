import type { Model, Parameter, Part, Vec2 } from '@app/schema';
import type {
  BindingEvaluator,
  DeformPipeline,
  DeformedModel,
  DrawItem,
  Layer,
  ParamValues,
  ParameterMixer,
  TargetDeltas,
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

// デフォルト値に、各レイヤーの値を重みで上書きする
export class FakeMixer implements ParameterMixer {
  mix(parameters: Parameter[], layers: Layer[]): ParamValues {
    const out: ParamValues = {};
    for (const p of parameters) out[p.id] = p.default;
    for (const layer of layers) {
      for (const [id, v] of Object.entries(layer.values)) {
        if (!(id in out)) continue;
        const weight =
          layer.parameterWeights && Object.hasOwn(layer.parameterWeights, id)
            ? layer.parameterWeights[id]!
            : layer.weight;
        const w = Number.isNaN(weight) ? 0 : Math.min(1, Math.max(0, weight));
        out[id] = out[id]! * (1 - w) + v * w;
      }
    }
    return out;
  }
}
