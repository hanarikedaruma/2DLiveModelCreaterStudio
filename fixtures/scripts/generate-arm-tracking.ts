// AT-08。幾何だけの技術fixture（キャラクター素材ではない）。削除やユーザーモデルの再構築はしない。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { validateProject } from '@app/schema';
import { createArmTrackingFixture as makeArmFixture, createBindingEvaluator, createDeformPipeline } from '@app/core';

const folder = resolve(import.meta.dirname, '../arm-tracking');
mkdirSync(resolve(folder, 'assets'), { recursive: true });
const texture = createCanvas(16, 16),
  ctx = texture.getContext('2d');
ctx.fillStyle = '#379a9b';
ctx.fillRect(0, 0, 16, 16);
ctx.fillStyle = '#f6c95d';
ctx.fillRect(0, 0, 4, 16);
const png = texture.toBuffer('image/png');
writeFileSync(resolve(folder, 'assets/arm-tech.png'), png);
const variants = {
  project: makeArmFixture(),
  'bent-reference': makeArmFixture({ shoulder: 25, elbow: 65, wrist: 10 }),
  'no-rig': makeArmFixture(),
  'missing-left': makeArmFixture(),
};
delete variants['no-rig'].model.armRigs;
variants['missing-left'].model.armRigs![0]!.hands.open!.partIds = ['missing'];
for (const [name, project] of Object.entries(variants)) {
  project.id = `arm-tracking-${name}`;
  project.studio.scenes[0]!.id = 'scene';
  project.studio.activeSceneId = 'scene';
  project.assets = [
    {
      id: 'arm-tech',
      path: 'assets/arm-tech.png',
      hash: createHash('sha256').update(png).digest('hex'),
      width: 16,
      height: 16,
      offset: { x: 0, y: 0 },
      canvasSize: { width: 600, height: 600 },
      source: { kind: 'png', file: 'arm-tech.png' },
      sourceBlendMode: 'normal',
      sourceOpacity: 1,
    },
  ];
  writeFileSync(resolve(folder, `${name}.json`), JSON.stringify(validateProject(project), null, 2) + '\n');
}
// 実際の共通経路を画像化し、基準角あり・顔の前の腕・固定の左右を確認できるようにする。
const canvas = createCanvas(1200, 600),
  c = canvas.getContext('2d');
c.fillStyle = '#f5f8fa';
c.fillRect(0, 0, 1200, 600);
const evaluator = createBindingEvaluator(),
  pipeline = createDeformPipeline();
const poses: Record<string, number>[] = [
  { ArmShoulderL: 65, ArmElbowL: 100, HandAngleL: 25, HandOpenL: 1, ArmShoulderR: 55, ArmElbowR: 0, HandPointR: 1 },
  {
    ArmShoulderL: 140,
    ArmElbowL: 130,
    HandAngleL: -30,
    HandPeaceL: 1,
    ArmShoulderR: 140,
    ArmElbowR: 130,
    HandAngleR: -30,
    HandPeaceR: 1,
  },
];
for (const [i, values] of poses.entries()) {
  const model = pipeline.deform(
    variants['bent-reference'].model,
    evaluator.evaluate(variants['bent-reference'].model, values),
  );
  for (const item of model.items) {
    if (!item.opacity) continue;
    c.globalAlpha = item.opacity;
    c.fillStyle = item.partId === 'face' ? '#edc7b7' : item.partId.endsWith('L') ? '#379a9b' : '#8761ad';
    c.beginPath();
    for (let j = 0; j < item.positions.length; j += 2) {
      const x = item.positions[j]! + i * 600,
        y = item.positions[j + 1]!;
      if (!j) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    c.fill();
  }
  c.fillStyle = '#20344a';
  c.font = '18px Meiryo';
  c.fillText(i ? '曲がった基準画像 → 顔の前でピース' : '共通評価：手振り・指さし', i * 600 + 30, 40);
}
writeFileSync(resolve(folder, 'preview.png'), canvas.toBuffer('image/png'));
console.log('fixtures/arm-tracking: 4種類の保存形式と共通評価の画像を生成した');
