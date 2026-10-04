import { describe, expect, it } from 'vitest';
import { createEmptyProject, type Project } from '@app/schema';
import { CLEAR_CLOSED_LINE_LABEL, CLOSED_LINE_LABEL, closedLineOf, setClosedLine, strokeToLine } from './closedLine';

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
  const line = [
    { x: 1, y: 2 },
    { x: 3, y: 4 },
  ];

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
    expect(
      setClosedLine(
        'R',
        line.map((p) => ({ ...p })),
      ).apply(once),
    ).toBe(once);
    const clear = setClosedLine('R', null);
    expect(clear.label).toBe(CLEAR_CLOSED_LINE_LABEL);
    const cleared = clear.apply(once);
    expect(closedLineOf(cleared.model, 'R')).toBeNull();
    expect(clear.apply(cleared)).toBe(cleared);
  });
});
