import { validateProject } from './validate';
import type { Project } from './types';

export const SCHEMA_VERSION = 1;

// { [版]: その版の json を次の版に変換する関数 }。v1 では空
export type Migrations = Record<number, (json: Record<string, unknown>) => Record<string, unknown>>;
export const MIGRATIONS: Migrations = {};

export class ProjectVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectVersionError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 変換表を指定できる版（テスト用）。現在の版なら受け取ったものをそのまま返す
export function migrateWith(json: unknown, migrations: Migrations, currentVersion: number): unknown {
  if (!isRecord(json)) throw new ProjectVersionError('プロジェクトがオブジェクトではない');
  const version = json.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ProjectVersionError(`schemaVersion: 1 以上の整数であるべきところが ${JSON.stringify(version)}`);
  }
  if (version > currentVersion) {
    throw new ProjectVersionError(
      `schemaVersion: このアプリより新しい版（${version}）のファイルは開けない。対応している版は ${currentVersion} まで`,
    );
  }
  let current = json;
  for (let v = version; v < currentVersion; v++) {
    const step = migrations[v];
    if (!step) throw new ProjectVersionError(`schemaVersion: 版 ${v} から ${v + 1} への変換が無い`);
    current = { ...step(current), schemaVersion: v + 1 };
  }
  return current;
}

// 古い版を現在の版へ変換する
export function migrate(json: unknown): unknown {
  return migrateWith(json, MIGRATIONS, SCHEMA_VERSION);
}

// 解析 → migrate → validate
export function loadProjectJson(text: string): Project {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new ProjectVersionError(`JSON として読めない: ${e instanceof Error ? e.message : String(e)}`);
  }
  return validateProject(migrate(json));
}
