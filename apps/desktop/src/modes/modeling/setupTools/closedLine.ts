// 閉じた目の線（カード42）。なぞった点の列をかんたんセットアップ用のヒント（Model.setupHints）に保存するコマンドと、
// なぞった点を保存する形（x の昇順の折れ線）にする計算。どれも純粋関数
import type { Model, Vec2 } from '@app/schema';
import type { Command } from '@app/contracts';
import { modelCommand, normalizeClosedLine } from '@app/core';

export type EyeSide = 'L' | 'R';
export const EYE_SIDES: readonly EyeSide[] = ['L', 'R'];

export const CLOSED_LINE_LABEL = '閉じた目の線';
export const CLEAR_CLOSED_LINE_LABEL = '閉じた目の線を消す';

const HINT_KEY = { L: 'closedLineL', R: 'closedLineR' } as const;

// 保存する座標の細かさ（キャンバスのピクセルの 1/100）
const round = (v: number) => Math.round(v * 100) / 100 + 0;

export function closedLineOf(model: Model, side: EyeSide): Vec2[] | null {
  return model.setupHints[HINT_KEY[side]];
}

// なぞった点の列を保存する形にする: 座標を丸め、x の昇順に並べ、同じ x はまとめる。線にならなければ null
export function strokeToLine(points: readonly Vec2[]): Vec2[] | null {
  const line = normalizeClosedLine(points.map((p) => ({ x: round(p.x), y: round(p.y) })));
  return line ? line.map((p) => ({ x: p.x, y: round(p.y) })) : null;
}

const sameLine = (a: Vec2[] | null, b: Vec2[] | null) =>
  a === b ||
  (a !== null && b !== null && a.length === b.length && a.every((p, i) => p.x === b[i]!.x && p.y === b[i]!.y));

// 片目の閉じた線を line にする（null で消す）。同じなら何もしない（履歴に積まない）
export function setClosedLine(side: EyeSide, line: Vec2[] | null): Command {
  return modelCommand(line ? CLOSED_LINE_LABEL : CLEAR_CLOSED_LINE_LABEL, (model) => {
    if (sameLine(closedLineOf(model, side), line)) return model;
    const points = line ? line.map((p) => ({ x: p.x, y: p.y })) : null;
    return { ...model, setupHints: { ...model.setupHints, [HINT_KEY[side]]: points } };
  });
}
