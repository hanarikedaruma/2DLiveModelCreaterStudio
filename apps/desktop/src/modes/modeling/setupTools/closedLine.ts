// 閉じた目の線（カード42）。なぞった点の列を自動セットアップ用のヒント（Model.setupHints）に保存するコマンドと、
// なぞった点を保存する形（x の昇順の折れ線）にする計算。どれも純粋関数
import { mapMeshPoint, type ClosedEyeLine, type Model, type Vec2 } from '@app/schema';
import type { Command, Services } from '@app/contracts';
import { modelCommand, normalizeClosedLine } from '@app/core';

export type EyeSide = 'L' | 'R';
export const EYE_SIDES: readonly EyeSide[] = ['L', 'R'];
// L / R はキャラクターから見た左右。画面では L が右側に描かれる
export const SCREEN_SIDE: Record<EyeSide, string> = { L: '右', R: '左' };

export const CLOSED_LINE_LABEL = '閉じた目の線';
export const CLEAR_CLOSED_LINE_LABEL = '閉じた目の線を消す';

const HINT_KEY = { L: 'closedLineL', R: 'closedLineR' } as const;

// 保存する座標の細かさ（キャンバスのピクセルの 1/100）
const round = (v: number) => Math.round(v * 100) / 100 + 0;

export function closedLineOf(model: Model, side: EyeSide): ClosedEyeLine | null {
  return model.setupHints[HINT_KEY[side]];
}

// 目の標準パーツ（白目・瞳・ハイライト・上まぶた・下まぶた・目（まとめて）・目のグループ）と、その側
const EYE_TYPE = /^(?:eyeWhite|iris|highlight|upperLid|lowerLid|eyeWhole|eyeGroup)([LR])$/;

// パーツが目のどちら側か。自身か祖先の標準パーツの種類で決める（目のグループの中の自由パーツも目）。目でなければ null
export function eyeSideOfPart(model: Model, partId: string): EyeSide | null {
  const byId = new Map(model.parts.map((p) => [p.id, p]));
  let part = byId.get(partId);
  for (let n = 0; part && n < 64; n++) {
    const side = part.standardType ? EYE_TYPE.exec(part.standardType)?.[1] : undefined;
    if (side === 'L' || side === 'R') return side;
    part = part.parentId ? byId.get(part.parentId) : undefined;
  }
  return null;
}

// 選んでいるパーツの目の側（L → R の順、重ねない）
export function selectedEyeSides(model: Model, selectedIds: readonly string[]): EyeSide[] {
  const sides = new Set(selectedIds.map((id) => eyeSideOfPart(model, id)));
  return EYE_SIDES.filter((s) => sides.has(s));
}

// なぞった点の列を保存する形にする: 座標を丸め、x の昇順に並べ、同じ x はまとめる。線にならなければ null
export function strokeToLine(points: readonly Vec2[]): Vec2[] | null {
  const line = normalizeClosedLine(points.map((p) => ({ x: round(p.x), y: round(p.y) })));
  return line ? line.map((p) => ({ x: p.x, y: round(p.y) })) : null;
}

const sameLine = (a: ClosedEyeLine | null, b: ClosedEyeLine | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.partId === b.partId &&
    a.points.length === b.points.length &&
    a.points.every((p, i) => p.x === b.points[i]!.x && p.y === b.points[i]!.y));

// 片目の閉じた線を line にする（null で消す）。同じなら何もしない（履歴に積まない）
export function setClosedLine(side: EyeSide, line: ClosedEyeLine | null): Command {
  return modelCommand(line ? CLOSED_LINE_LABEL : CLEAR_CLOSED_LINE_LABEL, (model) => {
    if (sameLine(closedLineOf(model, side), line)) return model;
    const points = line ? { partId: line.partId, points: line.points.map((p) => ({ x: p.x, y: p.y })) } : null;
    return { ...model, setupHints: { ...model.setupHints, [HINT_KEY[side]]: points } };
  });
}

export function eyeDisplay(services: Services, partId: string) {
  const model = services.store.get().model;
  const part = model.parts.find((p) => p.id === partId),
    mesh = model.meshes.find((m) => m.id === part?.meshId);
  if (!part || !mesh) return null;
  const deltas = services.evaluator.evaluate(model, services.editor.get().editorParamValues);
  const item = services.pipeline.deform(model, deltas).byPartId[partId];
  if (!item) return null;
  return {
    mesh,
    positions: mesh.vertices.map((_, i) => ({ x: item.positions[2 * i]!, y: item.positions[2 * i + 1]! })),
  };
}

export function lineOnScreen(services: Services, line: ClosedEyeLine): Vec2[] | null {
  if (line.partId === null) return line.points;
  const display = eyeDisplay(services, line.partId);
  if (!display) return null;
  const mapped = line.points.map((p) => mapMeshPoint(display.mesh, display.mesh.uvs, display.positions, p));
  return mapped.every((p): p is Vec2 => p !== null) ? mapped : null;
}

export function attachStroke(
  services: Services,
  side: EyeSide,
  points: readonly Vec2[],
  partId?: string,
): ClosedEyeLine | null {
  const model = services.store.get().model;
  const targets = partId
    ? [partId]
    : [`eyeWhite${side}`, `upperLid${side}`].flatMap((type) =>
        model.parts.filter((p) => p.standardType === type).map((p) => p.id),
      );
  for (const id of targets) {
    const display = eyeDisplay(services, id);
    if (!display) continue;
    const mapped = points.map((p) => mapMeshPoint(display.mesh, display.positions, display.mesh.uvs, p));
    if (!mapped.every((p): p is Vec2 => p !== null)) continue;
    const line = normalizeClosedLine(
      mapped.map((p) => ({ x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 })),
    );
    if (line) return { partId: id, points: line };
  }
  return null;
}
