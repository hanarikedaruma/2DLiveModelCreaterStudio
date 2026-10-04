// 合成モードの選択（カード32）。純粋関数
import type { BlendMode, Model, Part } from '@app/schema';
import type { Command } from '@app/contracts';
import { modelCommand } from '@app/core';

// 選べる合成モード（表示の順）
export const BLEND_MODE_OPTIONS: readonly { mode: BlendMode; label: string }[] = [
  { mode: 'normal', label: '通常' },
  { mode: 'multiply', label: '乗算' },
  { mode: 'screen', label: 'スクリーン' },
  { mode: 'add', label: '加算' },
];

export function isBlendMode(value: string): value is BlendMode {
  return BLEND_MODE_OPTIONS.some((o) => o.mode === value);
}

// 合成モードを持つのは画像パーツだけ（グループは描かないので使わない）
export function blendTargets(model: Model, partIds: readonly string[]): Part[] {
  const ids = new Set(partIds);
  return model.parts.filter((p) => ids.has(p.id) && p.kind === 'image');
}

// 対象の合成モード。ばらばらなら 'mixed'、対象が無ければ null
export function currentBlendMode(parts: readonly Part[]): BlendMode | 'mixed' | null {
  const first = parts[0];
  if (!first) return null;
  return parts.every((p) => p.blendMode === first.blendMode) ? first.blendMode : 'mixed';
}

// 選んだ画像パーツすべての合成モードを変える（1回の Undo）。変わるものが無ければ null
export function setBlendMode(model: Model, partIds: readonly string[], mode: BlendMode): Command | null {
  const ids = new Set(blendTargets(model, partIds).map((p) => p.id));
  if (!model.parts.some((p) => ids.has(p.id) && p.blendMode !== mode)) return null;
  return modelCommand('合成モードの変更', (m) => {
    let changed = false;
    const parts = m.parts.map((p) => {
      if (!ids.has(p.id) || p.kind !== 'image' || p.blendMode === mode) return p;
      changed = true;
      return { ...p, blendMode: mode };
    });
    return changed ? { ...m, parts } : m;
  });
}
