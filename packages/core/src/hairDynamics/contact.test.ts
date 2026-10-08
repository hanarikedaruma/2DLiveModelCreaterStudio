import { describe, expect, it } from 'vitest';
import type { HairContacts } from '@app/contracts';
import { closestSegments, contactsFit, projectContacts, solveStaticContacts } from './contact';
import { meshContactsFit } from './colliders';

const shoulder: HairContacts = {
  radius: 3,
  colliders: [
    {
      id: 's',
      radius: 2,
      points: [
        { x: -40, y: 100 },
        { x: 40, y: 100 },
      ],
    },
  ],
};
describe('肩の接触', () => {
  it('区間同士と丸い端を判定する。点だけで見逃す交差も距離0になる', () => {
    expect(closestSegments({ x: 0, y: 0 }, { x: 0, y: 200 }, { x: -40, y: 100 }, { x: 40, y: 100 }).distance).toBe(0);
    expect(closestSegments({ x: 42, y: 95 }, { x: 42, y: 105 }, { x: -40, y: 100 }, { x: 40, y: 100 }).distance).toBe(
      2,
    );
    expect(
      contactsFit(
        [
          { x: 42, y: 95 },
          { x: 42, y: 105 },
        ],
        1,
        shoulder,
      ),
    ).toBe(false);
  });
  it('流れ揺れOFFの静的な接触で根元と長さを保ち、帯の外へ押し出す', () => {
    const curve = Array.from({ length: 14 }, (_, i) => ({ x: 45, y: i * 15 }));
    const result = solveStaticContacts(curve, 2, shoulder);
    expect(result.resolved).toBe(true);
    expect(result.curve.slice(0, 2)).toEqual(curve.slice(0, 2));
    expect(contactsFit(result.curve, 2, shoulder)).toBe(true);
    result.curve
      .slice(1)
      .forEach((p, i) => expect(Math.hypot(p.x - result.curve[i]!.x, p.y - result.curve[i]!.y)).toBeCloseTo(15, 0));
  });
  it('1フレーム中の髪と動く肩のすれ違いを検出し、元の側を保つ', () => {
    const before = {
      curve: [
        { x: -50, y: 0 },
        { x: -50, y: 80 },
        { x: -50, y: 120 },
      ],
      contacts: shoulder,
    };
    const curve = [
      { x: -50, y: 0 },
      { x: 50, y: 80 },
      { x: 50, y: 120 },
    ];
    const result = projectContacts(curve, 1, shoulder, before);
    expect(result.changed).toBe(true);
    expect(curve[2]!.x).toBeLessThan(50);
    const moving = {
      ...shoulder,
      colliders: [
        {
          ...shoulder.colliders[0]!,
          points: [
            { x: -40, y: 60 },
            { x: 40, y: 60 },
          ],
        },
      ],
    };
    const fixedHair = [
      { x: 0, y: 0 },
      { x: 0, y: 80 },
    ];
    expect(
      projectContacts(fixedHair, 1, moving, {
        curve: [
          { x: 0, y: 0 },
          { x: 0, y: 80 },
        ],
        contacts: shoulder,
      }).changed,
    ).toBe(true);
  });
  it('最終メッシュの辺・中にある帯も判定し、中心線だけの成功を通さない', () => {
    const v = new Float32Array([-10, 90, 10, 90, 0, 110]);
    const contacts: HairContacts = {
      radius: 0,
      colliders: [
        {
          id: 's',
          radius: 1,
          points: [
            { x: -1, y: 95 },
            { x: 1, y: 95 },
          ],
        },
      ],
    };
    expect(meshContactsFit(v, [[0, 1, 2]], contacts)).toBe(false);
    expect(
      meshContactsFit(v, [[0, 1, 2]], {
        radius: 0,
        colliders: [
          {
            id: 's',
            radius: 1,
            points: [
              { x: 20, y: 90 },
              { x: 20, y: 110 },
            ],
          },
        ],
      }),
    ).toBe(true);
  });
  it('余裕幅のすぐ外を接線方向に滑る毛束を、物理的な通過の未解決としない', () => {
    const before = [
      { x: 15.2501, y: -2 },
      { x: 15.2501, y: 2 },
    ];
    const curve = before.map((p) => ({ x: p.x, y: p.y + 0.5 }));
    const contacts: HairContacts = {
      radius: 10,
      colliders: [
        {
          id: 's',
          radius: 5,
          points: [
            { x: -48, y: 0 },
            { x: 0, y: 0 },
          ],
        },
      ],
    };
    const result = projectContacts(curve, 1, contacts, { curve: before, contacts });
    expect(result).toEqual({ changed: false, exhausted: false });
    expect(contactsFit(curve, 1, contacts)).toBe(true);
  });
  it('物理的な厚みのすぐ外を滑る毛束も、移動全体が帯の外にあると証明できる', () => {
    const before = [
      { x: 15.0001, y: -2 },
      { x: 15.0001, y: 2 },
    ];
    const curve = before.map((p) => ({ x: p.x, y: p.y + 0.5 }));
    const contacts: HairContacts = {
      radius: 10,
      margin: 0,
      colliders: [
        {
          id: 's',
          radius: 5,
          points: [
            { x: -48, y: 0 },
            { x: 0, y: 0 },
          ],
        },
      ],
    };
    expect(projectContacts(curve, 1, contacts, { curve: before, contacts })).toEqual({
      changed: false,
      exhausted: false,
    });
    expect(contactsFit(curve, 1, contacts)).toBe(true);
  });
  it('固定区間と帯が矛盾しても有限値を保ち、未解決を返す', () => {
    const curve = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 0, y: 110 },
    ];
    const out = solveStaticContacts(curve, 2, shoulder);
    expect(out.resolved).toBe(false);
    expect(out.curve.slice(0, 2)).toEqual(curve.slice(0, 2));
    expect(out.curve.every((p) => Number.isFinite(p.x + p.y))).toBe(true);
  });
  it('帯を横切る初期の静止線は有限の肩の端を回り込んで垂れる', () => {
    const rest = Array.from({ length: 49 }, (_, i) => ({ x: 0, y: (i * 200) / 48 }));
    const out = solveStaticContacts(rest, 8, shoulder);
    expect(out.resolved).toBe(true);
    expect(contactsFit(out.curve, 8, shoulder)).toBe(true);
    expect(out.curve.slice(0, 8)).toEqual(rest.slice(0, 8));
  });
});
