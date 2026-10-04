import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './defaults';
import { ProjectVersionError, SCHEMA_VERSION, loadProjectJson, migrate, migrateWith } from './migrate';
import { ProjectValidationError } from './validate';

describe('migrate', () => {
  it('現在の版は 1', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('v1 は何も変えない', () => {
    const p = createEmptyProject('テスト');
    const before = JSON.stringify(p);
    expect(migrate(p)).toBe(p);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('v2 のファイルはエラーになる', () => {
    const p = { ...createEmptyProject('テスト'), schemaVersion: 2 };
    expect(() => migrate(p)).toThrow(ProjectVersionError);
    expect(() => migrate(p)).toThrow(/新しい版（2）/);
  });

  it('版が無い・数でないものはエラー', () => {
    expect(() => migrate({})).toThrow(/schemaVersion/);
    expect(() => migrate({ schemaVersion: '1' })).toThrow(/schemaVersion/);
    expect(() => migrate({ schemaVersion: 0 })).toThrow(/schemaVersion/);
    expect(() => migrate([])).toThrow(ProjectVersionError);
  });

  it('変換表で現在の版まで順に変換する', () => {
    const calls: number[] = [];
    const out = migrateWith(
      { schemaVersion: 1, a: 1 },
      {
        1: (j) => {
          calls.push(1);
          return { ...j, b: 2 };
        },
        2: (j) => {
          calls.push(2);
          return { ...j, c: 3 };
        },
      },
      3,
    );
    expect(calls).toEqual([1, 2]);
    expect(out).toEqual({ schemaVersion: 3, a: 1, b: 2, c: 3 });
  });

  it('途中の変換が無ければエラー', () => {
    expect(() => migrateWith({ schemaVersion: 1 }, {}, 2)).toThrow(/版 1 から 2/);
  });
});

describe('loadProjectJson', () => {
  it('解析 → migrate → validate', () => {
    const p = createEmptyProject('テスト');
    expect(loadProjectJson(JSON.stringify(p))).toEqual(p);
  });

  it('JSON でなければエラー', () => {
    expect(() => loadProjectJson('{')).toThrow(/JSON として読めない/);
  });

  it('形が違えば検証のエラー', () => {
    const p = { ...createEmptyProject('テスト'), name: 1 };
    expect(() => loadProjectJson(JSON.stringify(p))).toThrow(ProjectValidationError);
  });
});
