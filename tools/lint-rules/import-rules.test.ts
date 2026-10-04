// 参照の規則（カード01）が ESLint で強制されていることを確かめる
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const eslint = new ESLint({ cwd: root });

async function errorsFor(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.ruleId ?? m.message);
}

const cases: { file: string; imports: string; ok: boolean }[] = [
  { file: 'packages/schema/src/probe.ts', imports: '@app/contracts', ok: false },
  { file: 'packages/contracts/src/probe.ts', imports: '@app/schema', ok: true },
  { file: 'packages/contracts/src/probe.ts', imports: '@app/core', ok: false },
  { file: 'packages/core/src/probe.ts', imports: '@app/schema', ok: true },
  { file: 'packages/core/src/probe.ts', imports: '@app/contracts', ok: true },
  { file: 'packages/core/src/probe.ts', imports: '@app/render', ok: false },
  { file: 'packages/render/src/probe.ts', imports: '@app/core', ok: false },
  { file: 'packages/io/src/probe.ts', imports: '@app/tracking', ok: false },
  { file: 'packages/tracking/src/probe.ts', imports: '@app/audio', ok: false },
  { file: 'packages/audio/src/probe.ts', imports: '@app/io', ok: false },
  { file: 'packages/core/src/probe.ts', imports: '../../render/src/index', ok: false },
  { file: 'apps/desktop/src/probe.ts', imports: '@app/core', ok: true },
  { file: 'apps/desktop/src/probe.ts', imports: '@app/render', ok: true },
];

describe('参照の規則', () => {
  for (const c of cases) {
    it(`${c.file} から ${c.imports} は${c.ok ? '許可' : '禁止'}`, async () => {
      const errors = await errorsFor(c.file, `import * as m from '${c.imports}';\nexport const x = m;\n`);
      const importErrors = errors.filter((e) => e === 'no-restricted-imports' || e === 'import-x/no-relative-packages');
      if (c.ok) expect(importErrors).toEqual([]);
      else expect(importErrors.length).toBeGreaterThan(0);
    });
  }
});
