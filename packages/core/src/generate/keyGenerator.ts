import {
  newId,
  STANDARD_PARAMETERS,
  type Asset,
  type Binding,
  type Model,
  type Parameter,
  type Part,
} from '@app/schema';
import type { KeyGenerator } from '@app/contracts';
import { keySpan } from './between';
import { rectOfAsset, rectOfPoints, type Rect } from './bounds';
import { depthBindings, faceWidthOf } from './depth';
import { easeBinding } from './ease';
import { generateLinearKeys, linearStep } from './linear';
import { regenerateBinding } from './regenerate';
import { rotateBinding } from './rotate';
import { surfaceBinding } from './surface';

export interface KeyGeneratorOptions {
  // 素材の一覧（顔の幅を素材の幅から求める）。無いときや素材が見つからないときはメッシュの頂点の外接矩形を使う
  assets?: () => readonly Asset[];
  // パラメータの一覧（linear の刻みを決める範囲）。無いときは標準パラメータの表、それにも無ければキーの範囲を使う
  parameters?: () => readonly Parameter[];
}

export function createKeyGenerator(options: KeyGeneratorOptions = {}): KeyGenerator {
  function rangeOf(parameterId: string | undefined): number | null {
    if (parameterId === undefined) return null;
    const p =
      options.parameters?.().find((q) => q.id === parameterId) ?? STANDARD_PARAMETERS.find((q) => q.id === parameterId);
    return p ? p.max - p.min : null;
  }

  // 自動のときの中間キーの刻み。パラメータの範囲はモデル → options → 標準の表の順に探し、無ければキーの範囲
  function stepOf(binding: Binding, model?: Model): number {
    const id = binding.parameterIds[0];
    const p = model?.parameters.find((q) => q.id === id);
    return linearStep(p ? p.max - p.min : (rangeOf(id) ?? keySpan(binding)));
  }

  return {
    linear(binding, divisions) {
      return generateLinearKeys(binding, {
        divisions: divisions ?? binding.divisions,
        range: rangeOf(binding.parameterIds[0]),
      });
    },

    depthParallax(model, parameterId) {
      const faceWidth = faceWidthOf(model, partBounds(model, options.assets?.() ?? []));
      // 顔の幅が分からないときは何も作らない（既存のキーを 0 で上書きしない）
      if (!(faceWidth > 0)) return [];
      return depthBindings(model, parameterId, { faceWidth, keep: (k) => k.locked, newId });
    },

    // STEP1 の生成方式（カード31）。どれも1パラメータのバインディングだけが対象（2パラメータはそのまま返す）
    rotate(binding, model) {
      return rotateBinding(binding, model, stepOf(binding, model));
    },

    surface(binding, model) {
      return surfaceBinding(binding, model);
    },

    ease(binding) {
      return easeBinding(binding, stepOf(binding));
    },

    regenerate(binding, model, range) {
      return regenerateBinding(binding, model, stepOf(binding, model), range);
    },
  };
}

// 画像パーツの外接矩形。素材があれば素材、無ければメッシュの頂点から
function partBounds(model: Model, assets: readonly Asset[]): (part: Part) => Rect | null {
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const meshById = new Map(model.meshes.map((m) => [m.id, m]));
  return (part) => {
    const asset = part.assetId !== null ? assetById.get(part.assetId) : undefined;
    if (asset) return rectOfAsset(asset);
    const mesh = part.meshId !== null ? meshById.get(part.meshId) : undefined;
    return mesh ? rectOfPoints(mesh.vertices) : null;
  };
}
