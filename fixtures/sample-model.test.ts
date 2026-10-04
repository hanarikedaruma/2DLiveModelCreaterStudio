import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STANDARD_DRAW_ORDER, loadProjectJson, type StandardPartType } from '@app/schema';
import { describe, expect, it } from 'vitest';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'sample-model');
const project = loadProjectJson(readFileSync(join(DIR, 'project.json'), 'utf8'));

// 顔・耳・白目・瞳・ハイライト・上下まぶた・眉・上下唇・口の中・歯・舌・前髪・横髪・後ろ髪・首・胴体・腕
const EXPECTED: StandardPartType[] = [
  'face',
  'earL',
  'earR',
  'eyeWhiteL',
  'eyeWhiteR',
  'irisL',
  'irisR',
  'highlightL',
  'highlightR',
  'upperLidL',
  'upperLidR',
  'lowerLidL',
  'lowerLidR',
  'browL',
  'browR',
  'upperLip',
  'lowerLip',
  'mouthInside',
  'teeth',
  'tongue',
  'frontHair',
  'sideHairL',
  'sideHairR',
  'backHair',
  'neck',
  'torso',
  'armL',
  'armR',
];

function pngSize(png: Buffer) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe('fixtures/sample-model', () => {
  it('project.json が validateProject を通る', () => {
    expect(project.id).toBe('sample-model');
  });

  it('標準パーツ一式が割り当て済み（階層・バインディングなし）', () => {
    const types = project.model.parts.map((p) => p.standardType);
    expect([...types].sort()).toEqual([...EXPECTED].sort());
    expect(project.model.parts.every((p) => p.kind === 'image' && p.parentId === null && p.meshId === null)).toBe(true);
    expect(project.model.bindings).toEqual([]);
    expect(project.model.meshes).toEqual([]);
  });

  it('描画順は標準の順番', () => {
    const order = project.model.drawOrder.map((id) => project.model.parts.find((p) => p.id === id)!.standardType);
    expect(order).toEqual(STANDARD_DRAW_ORDER.filter((t) => EXPECTED.includes(t)));
  });

  it('素材の PNG があり、大きさとハッシュが一致し、キャンバスに収まる', () => {
    for (const asset of project.assets) {
      const png = readFileSync(join(DIR, asset.path));
      expect(createHash('sha256').update(png).digest('hex'), asset.id).toBe(asset.hash);
      expect(pngSize(png), asset.id).toEqual({ width: asset.width, height: asset.height });
      expect(asset.canvasSize).toEqual({ width: 1000, height: 1500 });
      expect(asset.offset.x + asset.width).toBeLessThanOrEqual(1000);
      expect(asset.offset.y + asset.height).toBeLessThanOrEqual(1500);
    }
  });

  it('L はキャラクター自身の左 = 画面の右に描かれている', () => {
    const center = (type: StandardPartType) => {
      const part = project.model.parts.find((p) => p.standardType === type)!;
      const asset = project.assets.find((a) => a.id === part.assetId)!;
      return asset.offset.x + asset.width / 2;
    };
    for (const [l, r] of [
      ['irisL', 'irisR'],
      ['earL', 'earR'],
      ['armL', 'armR'],
    ] as const) {
      expect(center(l)).toBeGreaterThan(500);
      expect(center(r)).toBeLessThan(500);
    }
  });
});
