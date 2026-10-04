// 複数のマスク元と反転のコマンド（カード33。純粋関数）。マスク元にできるのは maskSourceOptions の候補だけ
import { modelCommand } from '@app/core';
import type { Model, Part } from '@app/schema';
import type { Command } from '@app/contracts';
import { maskSourceOptions } from './commands';

type Mask = Part['mask'];

function sameMask(a: Mask, b: Mask): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.inverted === b.inverted &&
    a.sourcePartIds.length === b.sourcePartIds.length &&
    a.sourcePartIds.every((id, i) => id === b.sourcePartIds[i])
  );
}

// 候補にあるものだけを、重なりを除いて順に残す
function validSources(model: Model, partId: string, ids: readonly string[]): string[] {
  const allowed = new Set(maskSourceOptions(model, partId).map((p) => p.id));
  return [...new Set(ids)].filter((id) => allowed.has(id));
}

// partId のマスクを next(part) にする。パーツが無いか、変わらなければ同じ model を返す
function updateMask(model: Model, partId: string, next: (part: Part) => Mask | undefined): Model {
  const index = model.parts.findIndex((p) => p.id === partId);
  const part = model.parts[index];
  if (!part) return model;
  const mask = next(part);
  if (mask === undefined || sameMask(part.mask, mask)) return model;
  const parts = model.parts.slice();
  parts[index] = { ...part, mask };
  return { ...model, parts };
}

// マスク元が ids のマスク。空なら「なし」（null）。反転の設定は保つ
function maskWith(part: Part, ids: string[]): Mask {
  return ids.length === 0 ? null : { sourcePartIds: ids, inverted: part.mask?.inverted ?? false };
}

// マスク元をまとめて決める。候補に無いもの（自身と子孫・画像でないパーツ・無いパーツ）は除く
export function setMaskSources(partId: string, sourceIds: readonly string[]): Command {
  return modelCommand('マスクの設定', (model) =>
    updateMask(model, partId, (part) => maskWith(part, validSources(model, partId, sourceIds))),
  );
}

// マスク元を1つ足す（included）/ 外す。ほかのマスク元と反転はそのまま。最後の1つを外すと「なし」。
// 候補に無いものは足さない
export function setMaskSource(partId: string, sourceId: string, included: boolean): Command {
  return modelCommand(included ? 'マスク元の追加' : 'マスク元の解除', (model) =>
    updateMask(model, partId, (part) => {
      const current = part.mask?.sourcePartIds ?? [];
      if (current.includes(sourceId) === included) return undefined;
      const ids = included ? [...current, sourceId] : current.filter((id) => id !== sourceId);
      const next = validSources(model, partId, ids);
      if (included && !next.includes(sourceId)) return undefined;
      return maskWith(part, next);
    }),
  );
}

// 反転（範囲の外を表示）。マスクが無いときは何もしない
export function setMaskInverted(partId: string, inverted: boolean): Command {
  return modelCommand('マスクの反転', (model) =>
    updateMask(model, partId, (part) => (part.mask ? { ...part.mask, inverted } : undefined)),
  );
}

// 今のマスク元のうち候補にあるもの（候補の順。前面から）と、候補の一覧
export function maskSourceState(model: Model, part: Part): { options: Part[]; selected: Part[] } {
  const options = maskSourceOptions(model, part.id);
  const ids = new Set(part.mask?.sourcePartIds ?? []);
  return { options, selected: options.filter((p) => ids.has(p.id)) };
}
