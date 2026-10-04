import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectJson } from '@app/schema';
import { describe, expect, it } from 'vitest';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'reference-model');
const project = loadProjectJson(readFileSync(join(DIR, 'project.json'), 'utf8'));

describe('fixtures/reference-model（計測用の基準モデル）', () => {
  it('キャンバス 2000×3000px・約50レイヤー・メッシュ付き', () => {
    const images = project.model.parts.filter((p) => p.kind === 'image');
    expect(images.length).toBeGreaterThanOrEqual(45);
    expect(images.length).toBeLessThanOrEqual(55);
    expect(project.assets.every((a) => a.canvasSize.width === 2000 && a.canvasSize.height === 3000)).toBe(true);
    expect(images.every((p) => p.meshId && project.model.meshes.some((m) => m.id === p.meshId))).toBe(true);
  });

  it('かんたんセットアップ済み（変形グループ・バインディング・描画順）', () => {
    const groups = project.model.parts.filter((p) => p.kind === 'group').map((p) => p.standardType);
    expect(groups).toEqual(expect.arrayContaining(['bodyRoot', 'neckRoot', 'headRoot', 'faceGroup']));
    const params = new Set(project.model.bindings.flatMap((b) => b.parameterIds));
    expect([...params]).toEqual(
      expect.arrayContaining([
        'FaceAngleX',
        'FaceAngleY',
        'FaceAngleZ',
        'EyeOpenL',
        'EyeOpenR',
        'EyeBallX',
        'MouthOpen',
      ]),
    );
    const images = project.model.parts.filter((p) => p.kind === 'image').map((p) => p.id);
    expect([...project.model.drawOrder].sort()).toEqual([...images].sort());
  });

  it('素材の PNG のハッシュが一致する', () => {
    for (const asset of project.assets) {
      const png = readFileSync(join(DIR, asset.path));
      expect(createHash('sha256').update(png).digest('hex'), asset.id).toBe(asset.hash);
    }
  });
});
