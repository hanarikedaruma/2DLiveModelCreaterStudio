// カード98の分割パーツ見本。pnpm --filter @app/fixtures exec tsx scripts/generate-chest-model.ts
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { withChestPhysics } from '@app/core';
import {
  createEmptyProject,
  standardParametersFor,
  validateProject,
  type Binding,
  type Mesh,
  type Part,
  type TransformDelta,
} from '@app/schema';
type Rect = { x: number; y: number; width: number; height: number };

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'chest-model');
mkdirSync(join(out, 'assets'), { recursive: true });
const p = createEmptyProject('胸揺れの見本');
p.id = 'chest-model-c98';
p.studio.scenes[0]!.id = 'scene-chest';
p.studio.activeSceneId = 'scene-chest';
const part = (id: string, patch: Partial<Part> = {}): Part => ({
  id,
  name: id,
  kind: 'image',
  standardType: null,
  assetId: null,
  meshId: null,
  parentId: 'body',
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  pivot: { x: 256, y: 380 },
  opacity: 1,
  blendMode: 'normal',
  depth: 0,
  mask: null,
  physicsId: null,
  visible: true,
  locked: false,
  ...patch,
});
const delta = (position = { x: 0, y: 0 }, rotation = 0, scale = { x: 1, y: 1 }): TransformDelta => ({
  position,
  rotation,
  scale,
  opacity: 1,
});
const transform = (
  id: string,
  partId: string,
  parameterId: string,
  values: number[],
  deltas: TransformDelta[],
): Binding => ({
  id,
  target: { type: 'part', id: partId },
  channel: 'transform',
  parameterIds: [parameterId],
  keyValues: [values],
  keys: values.map((v, i) => ({ coords: [v], delta: deltas[i]!, source: 'auto', locked: false })),
  generation: 'linear',
  divisions: null,
});
const grid = (id: string, bounds: Rect, curved = false): Mesh => {
  const vertices = Array.from({ length: 81 }, (_, i) => {
    const row = Math.floor(i / 9),
      inset = curved ? Math.sin((row / 8) * Math.PI) * 12 : 0;
    return {
      x: bounds.x + inset + ((i % 9) / 8) * (bounds.width - inset * 2),
      y: bounds.y + (row / 8) * bounds.height,
    };
  });
  const triangles: Mesh['triangles'] = [];
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const a = y * 9 + x;
      triangles.push([a, a + 1, a + 9], [a + 1, a + 10, a + 9]);
    }
  return {
    id,
    vertices,
    uvs: vertices.map((v) => ({ x: (v.x - bounds.x) / bounds.width, y: (v.y - bounds.y) / bounds.height })),
    triangles,
    density: 'custom',
    edited: false,
  };
};
const paint = (id: string, bounds: Rect, draw: (c: SKRSContext2D) => void) => {
  const canvas = createCanvas(bounds.width, bounds.height),
    c = canvas.getContext('2d');
  c.translate(-bounds.x, -bounds.y);
  draw(c);
  const png = canvas.toBuffer('image/png');
  writeFileSync(join(out, 'assets', `${id}.png`), png);
  p.assets.push({
    id,
    path: `assets/${id}.png`,
    hash: createHash('sha256').update(png).digest('hex'),
    width: bounds.width,
    height: bounds.height,
    offset: { x: bounds.x, y: bounds.y },
    canvasSize: { width: 512, height: 512 },
    source: { kind: 'png', file: `${id}.png` },
    sourceBlendMode: 'normal',
    sourceOpacity: 1,
  });
};
const torsoBounds = { x: 92, y: 100, width: 328, height: 380 };
paint('asset-torso', torsoBounds, (c) => {
  c.fillStyle = '#ead5bc';
  c.beginPath();
  c.ellipse(256, 148, 40, 46, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#436f87';
  c.beginPath();
  c.moveTo(168, 192);
  c.quadraticCurveTo(256, 163, 344, 192);
  c.lineTo(366, 462);
  c.lineTo(146, 462);
  c.closePath();
  c.fill();
  c.strokeStyle = '#d0e0e5';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(208, 187);
  c.lineTo(256, 219);
  c.lineTo(304, 187);
  c.stroke();
  c.strokeStyle = '#62869b';
  c.lineWidth = 2;
  for (let y = 246; y < 462; y += 24) {
    c.beginPath();
    c.moveTo(152, y);
    c.lineTo(360, y);
    c.stroke();
  }
  c.strokeStyle = '#25475b';
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(150, 462);
  c.lineTo(364, 462);
  c.stroke();
});
const chestBounds = { x: 168, y: 222, width: 176, height: 120 };
paint('asset-chest', chestBounds, (c) => {
  const gradient = c.createLinearGradient(0, 222, 0, 342);
  gradient.addColorStop(0, '#436f87');
  gradient.addColorStop(0.6, '#6e95a9');
  gradient.addColorStop(1, '#436f87');
  c.fillStyle = gradient;
  c.fillRect(168, 222, 176, 120);
  c.strokeStyle = '#9fbccc';
  c.lineWidth = 2;
  for (let y = 246; y < 342; y += 24) {
    c.beginPath();
    c.moveTo(170, y);
    c.quadraticCurveTo(256, y + 10, 342, y);
    c.stroke();
  }
  c.strokeStyle = '#2b5269';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(205, 268);
  c.quadraticCurveTo(212, 295, 240, 288);
  c.moveTo(272, 288);
  c.quadraticCurveTo(300, 295, 307, 268);
  c.stroke();
});
for (const [id, x] of [
  ['L', 106],
  ['R', 366],
] as const) {
  paint(`asset-arm${id}`, { x, y: 192, width: 40, height: 270 }, (c) => {
    c.fillStyle = '#436f87';
    c.beginPath();
    c.roundRect(x, 192, 40, 244, 16);
    c.fill();
    c.fillStyle = '#ead5bc';
    c.beginPath();
    c.ellipse(x + 20, 444, 15, 17, 0, 0, Math.PI * 2);
    c.fill();
  });
}
p.model.parts = [
  part('body', { name: '体', kind: 'group', parentId: null, standardType: 'bodyRoot' }),
  part('torso', { name: '胴体', standardType: 'torso', assetId: 'asset-torso', meshId: 'mesh-torso' }),
  part('chest', { name: '胸', standardType: 'chest', assetId: 'asset-chest', meshId: 'mesh-chest', parentId: 'torso' }),
  ...(['L', 'R'] as const).map((id) =>
    part(`arm${id}`, {
      name: `腕 ${id}`,
      standardType: id === 'L' ? 'armL' : 'armR',
      assetId: `asset-arm${id}`,
      meshId: `mesh-arm${id}`,
    }),
  ),
];
p.model.meshes = [
  grid('mesh-torso', torsoBounds),
  grid('mesh-chest', chestBounds, true),
  grid('mesh-armL', { x: 106, y: 192, width: 40, height: 270 }),
  grid('mesh-armR', { x: 366, y: 192, width: 40, height: 270 }),
];
p.model.drawOrder = ['torso', 'chest', 'armL', 'armR'];
p.model.parameters = [
  ...standardParametersFor('step2').map((parameter) =>
    parameter.id === 'BodyAngleZ' ? { ...parameter, min: -90, max: 90 } : parameter,
  ),
  ...(['X', 'Y'] as const).map((axis) => ({
    id: `Move${axis}`,
    name: `体の移動 ${axis}`,
    groupId: 'body' as const,
    min: -24,
    max: 24,
    default: 0,
    standard: false,
  })),
];
p.model.bindings = [
  transform(
    'tilt',
    'body',
    'BodyAngleZ',
    [-90, 0, 90],
    [delta({ x: 0, y: 0 }, -90), delta(), delta({ x: 0, y: 0 }, 90)],
  ),
  transform('moveX', 'body', 'MoveX', [-24, 0, 24], [delta({ x: -24, y: 0 }), delta(), delta({ x: 24, y: 0 })]),
  transform('moveY', 'body', 'MoveY', [-24, 0, 24], [delta({ x: 0, y: -24 }), delta(), delta({ x: 0, y: 24 })]),
  transform('breath', 'torso', 'Breath', [0, 1], [delta(), delta({ x: 0, y: -3 }, 0, { x: 1.015, y: 1.02 })]),
];
p.animations = [
  {
    id: 'chest-demo',
    name: '体を動かして胸揺れを試す',
    duration: 3,
    speed: 1,
    loop: true,
    periodic: false,
    tracks: [
      {
        parameterId: 'MoveY',
        keyframes: [
          { time: 0, value: 0, curve: 'smooth' },
          { time: 0.3, value: -16, curve: 'smooth' },
          { time: 0.6, value: 0, curve: 'smooth' },
          { time: 3, value: 0, curve: 'smooth' },
        ],
      },
      {
        parameterId: 'BodyAngleZ',
        keyframes: [
          { time: 0, value: 0, curve: 'smooth' },
          { time: 1, value: 35, curve: 'smooth' },
          { time: 1.7, value: -35, curve: 'smooth' },
          { time: 2.3, value: 0, curve: 'smooth' },
          { time: 3, value: 0, curve: 'smooth' },
        ],
      },
    ],
    affectedGroups: ['body', 'sway'],
    restart: 'restart',
    transition: {
      preset: 'auto',
      blendIn: 0,
      blendOut: 0,
      curve: 'smooth',
      blendMode: 'override',
      keepLipSync: true,
      keepPhysics: true,
      returnToTracking: true,
    },
  },
];
const project = validateProject(
  withChestPhysics(p, 'chest', { physics: 'chest-physics', horizontal: 'chest-x', vertical: 'chest-y' }),
);
writeFileSync(join(out, 'project.json'), JSON.stringify(project, null, 2) + '\n');
console.log(`胸揺れの見本を ${out} に生成しました。`);
