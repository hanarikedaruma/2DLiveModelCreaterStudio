import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MemoryFileSystem } from '@app/contracts';
import { validateProject } from '@app/schema';
import { createProjectIO } from './projectIO';

const fixture = () => {
  const p = validateProject(
    JSON.parse(readFileSync(new URL('../../../../fixtures/chest-model/project.json', import.meta.url), 'utf8')),
  );
  p.assets = [];
  p.model.parts = p.model.parts.map((part) => ({ ...part, assetId: null }));
  return p;
};
describe('胸の保存・再読込と2出力の修復', () => {
  it('固定点・手編集キー・重力の基準・2出力をプロジェクトとして往復する', async () => {
    const p = fixture();
    p.model.bindings.find((b) => b.id === 'chest-x')!.keys[2]!.locked = true;
    const fs = new MemoryFileSystem(),
      io = createProjectIO(fs);
    await io.save('/chest', p, {});
    const loaded = await io.load('/chest');
    expect(loaded.project).toEqual(p);
    expect(loaded.report.repairs).toEqual([]);
    expect(JSON.stringify(loaded.project)).not.toMatch(/velocity|frameId|simulated/);
  });
  it('上下の出力先が欠けたら指定を外して知らせ、主出力と手編集キーを消さない', async () => {
    const p = fixture(),
      io = createProjectIO(new MemoryFileSystem());
    p.model.parameters = p.model.parameters.filter((p) => p.id !== 'BustY');
    await io.save('/missing', p, {});
    const loaded = await io.load('/missing');
    expect(loaded.project.physics[0]!.verticalOutputParameterId).toBeNull();
    expect(loaded.project.physics[0]!.outputParameterId).toBe('BustX');
    expect(loaded.project.model.bindings).toEqual(p.model.bindings);
    expect(loaded.report.repairs.join(' ')).toMatch(/上下の出力先/);
  });
});
