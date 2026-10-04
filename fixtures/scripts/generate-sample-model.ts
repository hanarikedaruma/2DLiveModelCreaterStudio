// テスト用の素材（sample-model）を作る。`pnpm --filter @app/fixtures generate` で実行する。
// 1000×1500px のキャンバスに、目を開け口を閉じた状態の標準パーツを単純な図形で描き、
// パーツごとにトリミングした PNG と、標準パーツへの割り当てだけ済んだ project.json を出力する。
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import {
  DEFAULT_DEPTH,
  STANDARD_DRAW_ORDER,
  STANDARD_PART_NAMES,
  createEmptyProject,
  validateProject,
  type Asset,
  type Part,
  type Project,
  type StandardPartType,
} from '@app/schema';

const WIDTH = 1000;
const HEIGHT = 1500;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'sample-model');

const SKIN = '#fbe3d1';
const SKIN_SHADE = '#efc9b0';
const HAIR = '#6b4a33';
const HAIR_BACK = '#4a3424';
const IRIS = '#3b82f6';
const LASH = '#3a2a20';
const LIP = '#e39a90';

type Draw = (ctx: SKRSContext2D) => void;

function ellipse(ctx: SKRSContext2D, x: number, y: number, rx: number, ry: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function polygon(ctx: SKRSContext2D, points: [number, number][], color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

// 中心 (cx, cy)・幅 w の上に凸の弧を太さ t で描く
function arc(ctx: SKRSContext2D, cx: number, cy: number, w: number, h: number, t: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = t;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy);
  ctx.quadraticCurveTo(cx, cy - h, cx + w / 2, cy);
  ctx.stroke();
}

// L はキャラクター自身の左 = 画面の右
const EYE = { L: { x: 595, y: 470 }, R: { x: 405, y: 470 } };
const MOUTH = { x: 500, y: 612 };

function eyeParts(side: 'L' | 'R'): [StandardPartType, Draw][] {
  const { x, y } = EYE[side];
  return [
    [`eyeWhite${side}`, (c) => ellipse(c, x, y, 58, 40, '#ffffff')],
    [`iris${side}`, (c) => ellipse(c, x, y + 2, 30, 34, IRIS)],
    [`highlight${side}`, (c) => ellipse(c, x + 10, y - 12, 9, 9, '#ffffff')],
    [`upperLid${side}`, (c) => arc(c, x, y - 18, 128, 46, 12, LASH)],
    [`lowerLid${side}`, (c) => arc(c, x, y + 44, 90, -14, 5, '#c48a7a')],
    [`brow${side}`, (c) => arc(c, x, y - 82, 110, 22, 12, '#5a3d2b')],
  ];
}

function hairStrand(side: 'L' | 'R'): Draw {
  const s = side === 'L' ? 1 : -1;
  const x0 = 500 + s * 205;
  const x1 = 500 + s * 290;
  return (c) =>
    polygon(
      c,
      [
        [x0, 300],
        [x1, 320],
        [x1 + s * 10, 600],
        [x1 - s * 20, 780],
        [x0 + s * 10, 640],
      ],
      HAIR,
    );
}

function arm(side: 'L' | 'R'): Draw {
  const s = side === 'L' ? 1 : -1;
  const sx = 500 + s * 250;
  return (c) =>
    polygon(
      c,
      [
        [sx - s * 30, 900],
        [sx + s * 50, 890],
        [sx + s * 95, 1360],
        [sx + s * 15, 1370],
      ],
      '#3f5fd8',
    );
}

const PARTS: [StandardPartType, Draw][] = [
  [
    'backHair',
    (c) => {
      ellipse(c, 500, 430, 275, 300, HAIR_BACK);
      polygon(
        c,
        [
          [235, 480],
          [765, 480],
          [790, 880],
          [210, 880],
        ],
        HAIR_BACK,
      );
    },
  ],
  [
    'torso',
    (c) =>
      polygon(
        c,
        [
          [400, 840],
          [600, 840],
          [770, 900],
          [800, 1500],
          [200, 1500],
          [230, 900],
        ],
        '#4c6ef5',
      ),
  ],
  ['armL', arm('L')],
  ['armR', arm('R')],
  [
    'neck',
    (c) =>
      polygon(
        c,
        [
          [455, 640],
          [545, 640],
          [550, 870],
          [450, 870],
        ],
        SKIN_SHADE,
      ),
  ],
  ['earL', (c) => ellipse(c, 735, 480, 30, 52, SKIN_SHADE)],
  ['earR', (c) => ellipse(c, 265, 480, 30, 52, SKIN_SHADE)],
  ['face', (c) => ellipse(c, 500, 450, 230, 260, SKIN)],
  ['mouthInside', (c) => ellipse(c, MOUTH.x, MOUTH.y, 34, 12, '#7a1f2b')],
  [
    'teeth',
    (c) => {
      c.fillStyle = '#ffffff';
      c.fillRect(MOUTH.x - 28, MOUTH.y - 12, 56, 9);
    },
  ],
  ['tongue', (c) => ellipse(c, MOUTH.x, MOUTH.y + 8, 22, 7, '#e57373')],
  // 口を閉じた状態。上下の唇で口の中を隠す
  [
    'upperLip',
    (c) => {
      c.fillStyle = LIP;
      c.beginPath();
      c.ellipse(MOUTH.x, MOUTH.y + 1, 44, 17, 0, Math.PI, Math.PI * 2);
      c.fill();
    },
  ],
  [
    'lowerLip',
    (c) => {
      c.fillStyle = LIP;
      c.beginPath();
      c.ellipse(MOUTH.x, MOUTH.y - 1, 40, 16, 0, 0, Math.PI);
      c.fill();
    },
  ],
  ...eyeParts('L'),
  ...eyeParts('R'),
  ['sideHairL', hairStrand('L')],
  ['sideHairR', hairStrand('R')],
  [
    'frontHair',
    (c) =>
      polygon(
        c,
        [
          [255, 380],
          [280, 230],
          [380, 165],
          [500, 150],
          [620, 165],
          [720, 230],
          [745, 380],
          [690, 300],
          [640, 360],
          [590, 290],
          [530, 370],
          [480, 290],
          [420, 360],
          [370, 290],
          [320, 350],
        ],
        HAIR,
      ),
  ],
];

// 不透明な画素を囲む矩形
function alphaBounds(data: Uint8ClampedArray, w: number, h: number) {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]! > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('何も描かれていない');
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(join(OUT_DIR, 'assets'), { recursive: true });

  const assets: Asset[] = [];
  const parts: Part[] = [];
  const preview = createCanvas(WIDTH, HEIGHT);
  const previewCtx = preview.getContext('2d');
  previewCtx.fillStyle = '#ffffff';
  previewCtx.fillRect(0, 0, WIDTH, HEIGHT);

  const byType = new Map(PARTS);
  for (const type of STANDARD_DRAW_ORDER) {
    const draw = byType.get(type);
    if (!draw) continue;
    const full = createCanvas(WIDTH, HEIGHT);
    const ctx = full.getContext('2d');
    draw(ctx);
    const b = alphaBounds(ctx.getImageData(0, 0, WIDTH, HEIGHT).data, WIDTH, HEIGHT);
    const trimmed = createCanvas(b.width, b.height);
    trimmed.getContext('2d').drawImage(full, b.x, b.y, b.width, b.height, 0, 0, b.width, b.height);
    const png = trimmed.toBuffer('image/png');

    const assetId = `asset-${type}`;
    const path = `assets/${assetId}.png`;
    writeFileSync(join(OUT_DIR, path), png);
    previewCtx.drawImage(trimmed, b.x, b.y);

    assets.push({
      id: assetId,
      path,
      hash: createHash('sha256').update(png).digest('hex'),
      width: b.width,
      height: b.height,
      offset: { x: b.x, y: b.y },
      canvasSize: { width: WIDTH, height: HEIGHT },
      source: { kind: 'png', file: `${type}.png` },
      sourceBlendMode: 'normal',
      sourceOpacity: 1,
    });
    parts.push({
      id: `part-${type}`,
      name: STANDARD_PART_NAMES[type],
      kind: 'image',
      standardType: type,
      assetId,
      meshId: null,
      parentId: null,
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      pivot: { x: b.x + b.width / 2, y: b.y + b.height / 2 },
      opacity: 1,
      blendMode: 'normal',
      depth: DEFAULT_DEPTH[type] ?? 0,
      mask: null,
      physicsId: null,
      visible: true,
      locked: false,
    });
  }

  const empty = createEmptyProject('サンプルモデル');
  const scene = { ...empty.studio.scenes[0]!, id: 'scene-1' };
  const project: Project = validateProject({
    ...empty,
    id: 'sample-model',
    assets,
    model: { ...empty.model, parts, drawOrder: parts.map((p) => p.id) },
    studio: { ...empty.studio, scenes: [scene], activeSceneId: scene.id },
  });
  writeFileSync(join(OUT_DIR, 'project.json'), JSON.stringify(project, null, 2) + '\n');
  writeFileSync(join(OUT_DIR, 'preview.png'), preview.toBuffer('image/png'));
  console.log(`sample-model: ${parts.length} パーツを ${OUT_DIR} に書き出した`);
}

main();
