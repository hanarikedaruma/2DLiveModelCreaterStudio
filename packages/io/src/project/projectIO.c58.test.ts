// カード58 の受け入れテスト（担当 CO）。欠け・中断・外部変更をファイル操作から起こす。
import { describe, expect, it } from 'vitest';
import { MemoryFileSystem, sha256Hex } from '@app/contracts';
import { createProjectIO } from './projectIO';
import { projectWithAssets } from './testing';
import { decodePng } from '../import/png';

const DIR = '/projects/c58';

class InterruptedFileSystem extends MemoryFileSystem {
  interruption: 'before' | 'afterRemoval' | null = null;
  override async rename(from: string, to: string): Promise<void> {
    if (this.interruption && to === `${DIR}/project.json`) {
      if (this.interruption === 'afterRemoval') await this.remove(to);
      throw new Error('置き換えの途中で停止');
    }
    return super.rename(from, to);
  }
}

describe('カード58: 欠けた素材と保存の中断からの復元', () => {
  it('複数の欠けを一覧にし、元の大きさの透明な代替を返す。残った PNG とモデルは変えない', async () => {
    const fs = new MemoryFileSystem();
    const io = createProjectIO(fs);
    const { project, pngs } = await projectWithAssets(3);
    await io.save(DIR, project, pngs);
    for (const asset of [project.assets[0]!, project.assets[2]!]) await fs.remove(`${DIR}/${asset.path}`);

    const loaded = await io.load(DIR);
    expect(loaded.project).toEqual(project);
    expect(loaded.report.missingAssetIds).toEqual([project.assets[0]!.id, project.assets[2]!.id]);
    expect(loaded.report.changedAssetIds).toEqual([]);
    expect(loaded.assetPngs[project.assets[1]!.id]).toEqual(pngs[project.assets[1]!.id]);
    for (const asset of [project.assets[0]!, project.assets[2]!]) {
      const image = decodePng(loaded.assetPngs[asset.id]!);
      expect([image.width, image.height]).toEqual([asset.width, asset.height]);
      expect(image.data.every((value) => value === 0)).toBe(true);
      expect(await fs.exists(`${DIR}/${asset.path}`)).toBe(false);
    }
  });

  it('欠けたまま保存しても代替画像で埋めない。実際の画像を差し替えて保存すると欠けが解消する', async () => {
    const fs = new MemoryFileSystem();
    const io = createProjectIO(fs);
    const { project, pngs } = await projectWithAssets(2);
    const missing = project.assets[0]!;
    await io.save(DIR, project, pngs);
    await fs.remove(`${DIR}/${missing.path}`);
    const loaded = await io.load(DIR);
    await io.save(DIR, loaded.project, loaded.assetPngs, { skipAssetIds: loaded.report.missingAssetIds });
    expect((await io.load(DIR)).report.missingAssetIds).toEqual([missing.id]);

    const replacement = pngs[missing.id]!;
    await io.save(DIR, loaded.project, { ...loaded.assetPngs, [missing.id]: replacement });
    const reopened = await io.load(DIR);
    expect(reopened.report.missingAssetIds).toEqual([]);
    expect(reopened.report.changedAssetIds).toEqual([]);
    expect(reopened.assetPngs[missing.id]).toEqual(replacement);
  });

  it('外で変わった PNG だけをハッシュの違いとして知らせ、その画像で開く', async () => {
    const fs = new MemoryFileSystem();
    const io = createProjectIO(fs);
    const { project, pngs } = await projectWithAssets(2);
    await io.save(DIR, project, pngs);
    const changed = project.assets[1]!;
    const replacement = new Uint8Array([71, 72, 73]);
    expect(await sha256Hex(replacement)).not.toBe(changed.hash);
    await fs.writeBinary(`${DIR}/${changed.path}`, replacement);
    const loaded = await io.load(DIR);
    expect(loaded.report.changedAssetIds).toEqual([changed.id]);
    expect(loaded.report.missingAssetIds).toEqual([]);
    expect(loaded.assetPngs[changed.id]).toEqual(replacement);
    expect(loaded.project.assets).toEqual(project.assets);
  });

  it.each(['before', 'afterRemoval'] as const)(
    '%s: 置き換えの失敗でも完成した project.json か .tmp から開ける',
    async (interruption) => {
      const fs = new InterruptedFileSystem();
      const io = createProjectIO(fs);
      const { project, pngs } = await projectWithAssets(1);
      await io.save(DIR, project, pngs);
      fs.interruption = interruption;
      await expect(io.save(DIR, { ...project, name: '中断された保存' }, pngs)).rejects.toThrow('途中で停止');
      expect(await fs.exists(`${DIR}/project.json.tmp`)).toBe(true);
      const loaded = await io.load(DIR);
      expect(loaded.project.name).toBe(interruption === 'before' ? project.name : '中断された保存');
      expect(loaded.report.openedFromTmp).toBe(interruption === 'afterRemoval');
      expect(loaded.assetPngs).toEqual(pngs);

      fs.interruption = null;
      await io.save(DIR, loaded.project, loaded.assetPngs);
      expect(await fs.exists(`${DIR}/project.json`)).toBe(true);
      expect(await fs.exists(`${DIR}/project.json.tmp`)).toBe(false);
      expect((await io.load(DIR)).report.openedFromTmp).toBe(false);
    },
  );

  it('素材の .tmp が残っていれば元の画素を読み、欠けた素材には数えない', async () => {
    const fs = new MemoryFileSystem();
    const io = createProjectIO(fs);
    const { project, pngs } = await projectWithAssets(1);
    const asset = project.assets[0]!;
    await io.save(DIR, project, pngs);
    await fs.rename(`${DIR}/${asset.path}`, `${DIR}/${asset.path}.tmp`);
    const loaded = await io.load(DIR);
    expect(loaded.assetPngs).toEqual(pngs);
    expect(loaded.report.missingAssetIds).toEqual([]);
    expect(loaded.report.repairs.join(' ')).toContain('.tmp');
  });

  it('壊れた JSON は保存データを書き換えずに名前付きのエラーを返す', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir(DIR);
    const broken = '{ "schemaVersion":';
    await fs.writeText(`${DIR}/project.json`, broken);
    await expect(createProjectIO(fs).load(DIR)).rejects.toThrow('project.json を JSON として読めない');
    expect(await fs.readText(`${DIR}/project.json`)).toBe(broken);
  });
});
