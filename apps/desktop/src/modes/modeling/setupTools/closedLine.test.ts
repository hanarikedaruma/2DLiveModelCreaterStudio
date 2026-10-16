import { describe, expect, it } from 'vitest';
import { createEmptyProject, type Model, type Part, type Project, type StandardPartType } from '@app/schema';
import {
  CLEAR_CLOSED_LINE_LABEL,
  CLOSED_LINE_LABEL,
  closedLineOf,
  eyeSideOfPart,
  selectedEyeSides,
  setClosedLine,
  strokeToLine,
} from './closedLine';

const project = (): Project => createEmptyProject('閉じた目の線のテスト');

describe('strokeToLine', () => {
  it('なぞった点を x の昇順にし、同じ x はまとめ、座標を 1/100 に丸める', () => {
    expect(
      strokeToLine([
        { x: 30.004, y: 10.006 },
        { x: 10, y: 20 },
        { x: 10, y: 24 },
        { x: 20.5, y: 15.25 },
      ]),
    ).toEqual([
      { x: 10, y: 22 },
      { x: 20.5, y: 15.25 },
      { x: 30, y: 10.01 },
    ]);
  });

  it('横の幅が無ければ null', () => {
    expect(strokeToLine([])).toBeNull();
    expect(strokeToLine([{ x: 5, y: 5 }])).toBeNull();
    expect(
      strokeToLine([
        { x: 5, y: 5 },
        { x: 5.001, y: 50 },
      ]),
    ).toBeNull();
  });
});

describe('setClosedLine', () => {
  const line = {
    partId: null,
    points: [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ],
  };

  it('片目の線だけを変え、もう片方と入力のプロジェクトはそのまま', () => {
    const p = project();
    const command = setClosedLine('L', line);
    expect(command.label).toBe(CLOSED_LINE_LABEL);
    const out = command.apply(p);
    expect(closedLineOf(out.model, 'L')).toEqual(line);
    expect(closedLineOf(out.model, 'R')).toBeNull();
    expect(closedLineOf(p.model, 'L')).toBeNull();
    // 渡した配列とは別のものを保存する
    expect(closedLineOf(out.model, 'L')).not.toBe(line);
  });

  it('同じ線なら同じプロジェクトを返し（履歴に積まない）、null で消す', () => {
    const once = setClosedLine('R', line).apply(project());
    expect(setClosedLine('R', { ...line, points: line.points.map((p) => ({ ...p })) }).apply(once)).toBe(once);
    const clear = setClosedLine('R', null);
    expect(clear.label).toBe(CLEAR_CLOSED_LINE_LABEL);
    const cleared = clear.apply(once);
    expect(closedLineOf(cleared.model, 'R')).toBeNull();
    expect(clear.apply(cleared)).toBe(cleared);
  });
});

describe('目のパーツの見分け', () => {
  const part = (id: string, standardType: StandardPartType | null, parentId: string | null = null) =>
    ({ id, standardType, parentId }) as Part;
  const model = {
    parts: [
      part('white', 'eyeWhiteR'),
      part('lid', 'upperLidL'),
      part('group', 'eyeGroupL'),
      part('lash', null, 'group'), // 目のグループの中の自由パーツ
      part('face', 'face'),
      part('free', null),
      part('loopA', null, 'loopB'),
      part('loopB', null, 'loopA'),
    ],
  } as Model;

  it('自身か祖先の標準パーツの種類から、目の側を決める。目でなければ null', () => {
    expect(eyeSideOfPart(model, 'white')).toBe('R');
    expect(eyeSideOfPart(model, 'lid')).toBe('L');
    expect(eyeSideOfPart(model, 'group')).toBe('L');
    expect(eyeSideOfPart(model, 'lash')).toBe('L');
    expect(eyeSideOfPart(model, 'face')).toBeNull();
    expect(eyeSideOfPart(model, 'free')).toBeNull();
    expect(eyeSideOfPart(model, 'missing')).toBeNull();
    // 親が輪になっていても止まる
    expect(eyeSideOfPart(model, 'loopA')).toBeNull();
  });

  it('選んでいるパーツの目の側を L → R の順に重ねずに返す', () => {
    expect(selectedEyeSides(model, ['white', 'face', 'lash', 'lid'])).toEqual(['L', 'R']);
    expect(selectedEyeSides(model, ['face'])).toEqual([]);
  });
});
