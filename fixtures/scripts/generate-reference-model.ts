// 計測用の基準モデル（カード25）を作る。`pnpm --filter @app/fixtures generate:reference` で実行する。
// キャンバス 2000×3000px、51レイヤー（標準パーツ29 + 自由パーツ22）。メッシュの自動生成とかんたんセットアップ済みの
// プロジェクトのフォルダ（project.json・assets/）を fixtures/reference-model/ に書き出す
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import { createAutoSetup, createMeshGenerator } from '@app/core';
import {
  STANDARD_PART_NAMES,
  createEmptyProject,
  validateProject,
  type Asset,
  type Mesh,
  type Part,
  type Project,
  type StandardPartType,
} from '@app/schema';

const WIDTH = 2000;
const HEIGHT = 3000;
const S = 2; // 下の図形は 1000×1500 の座標で書き、2倍にして描く
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'reference-model');

const SKIN = '#fbe3d1';
const SKIN_SHADE = '#efc9b0';
const HAIR = '#6b4a33';
const HAIR_DARK = '#4a3424';
const IRIS = '#2f7d6d';
const LASH = '#3a2a20';
const LIP = '#e39a90';
const CLOTH = '#3b5bdb';
const CLOTH_DARK = '#2f4ab8';
const WHITE = '#ffffff';

type Draw = (ctx: SKRSContext2D) => void;

const ellipse =
  (x: number, y: number, rx: number, ry: number, color: string, rot = 0): Draw =>
  (c) => {
    c.fillStyle = color;
    c.beginPath();
    c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    c.fill();
  };

const polygon =
  (points: [number, number][], color: string): Draw =>
  (c) => {
    c.fillStyle = color;
    c.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
    c.closePath();
    c.fill();
  };

const arc =
  (cx: number, cy: number, w: number, h: number, t: number, color: string): Draw =>
  (c) => {
    c.strokeStyle = color;
    c.lineWidth = t;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(cx - w / 2, cy);
    c.quadraticCurveTo(cx, cy - h, cx + w / 2, cy);
    c.stroke();
  };

const halfEllipse =
  (x: number, y: number, rx: number, ry: number, color: string, top: boolean): Draw =>
  (c) => {
    c.fillStyle = color;
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, top ? Math.PI : 0, top ? Math.PI * 2 : Math.PI);
    c.fill();
  };

const both =
  (...draws: Draw[]): Draw =>
  (c) => {
    for (const d of draws) d(c);
  };

// L はキャラクター自身の左 = 画面の右
const EYE = { L: { x: 595, y: 470 }, R: { x: 405, y: 470 } } as const;
const MOUTH = { x: 500, y: 612 };
const side = (s: 'L' | 'R') => (s === 'L' ? 1 : -1);

interface LayerDef {
  key: string; // 自由パーツの id とファイル名にも使う
  standardType: StandardPartType | null;
  name?: string; // 自由パーツの名前
  parent?: string; // 自由パーツの親（key）。かんたんセットアップは親のある自由パーツをそのままにする
  draw: Draw;
}

const std = (standardType: StandardPartType, draw: Draw): LayerDef => ({ key: standardType, standardType, draw });
const free = (key: string, name: string, parent: string, draw: Draw): LayerDef => ({
  key,
  standardType: null,
  name,
  parent,
  draw,
});

function eyeLayers(s: 'L' | 'R'): LayerDef[] {
  const { x, y } = EYE[s];
  return [
    std(`eyeWhite${s}`, ellipse(x, y, 58, 40, WHITE)),
    std(`iris${s}`, both(ellipse(x, y + 2, 30, 34, IRIS), ellipse(x, y + 4, 14, 16, '#1d4f45'))),
    std(`highlight${s}`, both(ellipse(x + 10, y - 12, 9, 9, WHITE), ellipse(x - 9, y + 14, 4, 4, WHITE))),
    std(`upperLid${s}`, arc(x, y - 18, 128, 46, 12, LASH)),
    std(`lowerLid${s}`, arc(x, y + 44, 90, -14, 5, '#c48a7a')),
    std(`brow${s}`, arc(x, y - 82, 110, 22, 12, '#5a3d2b')),
  ];
}

function armLayer(s: 'L' | 'R'): LayerDef {
  const k = side(s);
  const sx = 500 + k * 250;
  return std(
    `arm${s}`,
    polygon(
      [
        [sx - k * 30, 900],
        [sx + k * 50, 890],
        [sx + k * 95, 1360],
        [sx + k * 15, 1370],
      ],
      CLOTH_DARK,
    ),
  );
}

function sideHair(s: 'L' | 'R'): LayerDef {
  const k = side(s);
  const x0 = 500 + k * 205;
  const x1 = 500 + k * 290;
  return std(
    `sideHair${s}`,
    polygon(
      [
        [x0, 300],
        [x1, 320],
        [x1 + k * 10, 600],
        [x1 - k * 20, 780],
        [x0 + k * 10, 640],
      ],
      HAIR,
    ),
  );
}

const LAYERS: LayerDef[] = [
  // ---- 標準パーツ（29） ----
  std(
    'backHair',
    both(
      ellipse(500, 430, 275, 300, HAIR_DARK),
      polygon(
        [
          [235, 480],
          [765, 480],
          [790, 900],
          [210, 900],
        ],
        HAIR_DARK,
      ),
    ),
  ),
  std(
    'torso',
    polygon(
      [
        [400, 840],
        [600, 840],
        [770, 900],
        [800, 1500],
        [200, 1500],
        [230, 900],
      ],
      CLOTH,
    ),
  ),
  armLayer('L'),
  armLayer('R'),
  std(
    'neck',
    polygon(
      [
        [455, 640],
        [545, 640],
        [550, 870],
        [450, 870],
      ],
      SKIN_SHADE,
    ),
  ),
  std('earL', ellipse(735, 480, 30, 52, SKIN_SHADE)),
  std('earR', ellipse(265, 480, 30, 52, SKIN_SHADE)),
  std('face', ellipse(500, 450, 230, 260, SKIN)),
  std('cheek', both(ellipse(625, 545, 45, 22, '#f6b8b0'), ellipse(375, 545, 45, 22, '#f6b8b0'))),
  std('mouthInside', ellipse(MOUTH.x, MOUTH.y, 34, 12, '#7a1f2b')),
  std('teeth', (c) => {
    c.fillStyle = WHITE;
    c.fillRect(MOUTH.x - 28, MOUTH.y - 12, 56, 9);
  }),
  std('tongue', ellipse(MOUTH.x, MOUTH.y + 8, 22, 7, '#e57373')),
  std('upperLip', halfEllipse(MOUTH.x, MOUTH.y + 1, 44, 17, LIP, true)),
  std('lowerLip', halfEllipse(MOUTH.x, MOUTH.y - 1, 40, 16, LIP, false)),
  ...eyeLayers('L'),
  ...eyeLayers('R'),
  sideHair('L'),
  sideHair('R'),
  std(
    'frontHair',
    polygon(
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
  ),
  // ---- 自由パーツ（22） ----
  free('ahoge', 'アホ毛', 'frontHair', arc(520, 150, 70, 90, 10, HAIR)),
  free(
    'strandFL',
    '前髪の束 L',
    'frontHair',
    polygon(
      [
        [600, 280],
        [640, 300],
        [625, 420],
        [605, 400],
      ],
      HAIR_DARK,
    ),
  ),
  free(
    'strandFR',
    '前髪の束 R',
    'frontHair',
    polygon(
      [
        [400, 280],
        [360, 300],
        [375, 420],
        [395, 400],
      ],
      HAIR_DARK,
    ),
  ),
  free(
    'hairClip',
    'ヘアピン',
    'frontHair',
    polygon(
      [
        [660, 250],
        [710, 235],
        [715, 250],
        [665, 265],
      ],
      '#f2c94c',
    ),
  ),
  free(
    'backTipL',
    '後ろ髪の毛先 L',
    'backHair',
    polygon(
      [
        [700, 880],
        [790, 900],
        [760, 1000],
      ],
      HAIR_DARK,
    ),
  ),
  free(
    'backTipR',
    '後ろ髪の毛先 R',
    'backHair',
    polygon(
      [
        [300, 880],
        [210, 900],
        [240, 1000],
      ],
      HAIR_DARK,
    ),
  ),
  free(
    'lashL',
    'まつ毛 L',
    'upperLidL',
    polygon(
      [
        [650, 440],
        [672, 425],
        [668, 448],
      ],
      LASH,
    ),
  ),
  free(
    'lashR',
    'まつ毛 R',
    'upperLidR',
    polygon(
      [
        [350, 440],
        [328, 425],
        [332, 448],
      ],
      LASH,
    ),
  ),
  free('nose', '鼻の影', 'face', arc(500, 560, 18, -8, 4, '#e2b49b')),
  free('blushLineL', '頬の線 L', 'face', both(arc(610, 545, 14, 6, 3, '#e98f86'), arc(632, 545, 14, 6, 3, '#e98f86'))),
  free('blushLineR', '頬の線 R', 'face', both(arc(368, 545, 14, 6, 3, '#e98f86'), arc(390, 545, 14, 6, 3, '#e98f86'))),
  free('earringL', 'イヤリング L', 'earL', ellipse(740, 545, 10, 14, '#f2c94c')),
  free('earringR', 'イヤリング R', 'earR', ellipse(260, 545, 10, 14, '#f2c94c')),
  free(
    'collarL',
    '襟 L',
    'torso',
    polygon(
      [
        [505, 845],
        [610, 840],
        [580, 930],
      ],
      WHITE,
    ),
  ),
  free(
    'collarR',
    '襟 R',
    'torso',
    polygon(
      [
        [495, 845],
        [390, 840],
        [420, 930],
      ],
      WHITE,
    ),
  ),
  free(
    'ribbon',
    'リボン',
    'torso',
    both(
      polygon(
        [
          [500, 900],
          [440, 870],
          [445, 935],
        ],
        '#e03131',
      ),
      polygon(
        [
          [500, 900],
          [560, 870],
          [555, 935],
        ],
        '#e03131',
      ),
      ellipse(500, 902, 14, 14, '#c92a2a'),
    ),
  ),
  free('button1', 'ボタン 1', 'torso', ellipse(500, 1010, 12, 12, WHITE)),
  free('button2', 'ボタン 2', 'torso', ellipse(500, 1110, 12, 12, WHITE)),
  free('button3', 'ボタン 3', 'torso', ellipse(500, 1210, 12, 12, WHITE)),
  free(
    'pocket',
    'ポケット',
    'torso',
    polygon(
      [
        [580, 1060],
        [680, 1060],
        [675, 1150],
        [585, 1150],
      ],
      CLOTH_DARK,
    ),
  ),
  free(
    'cuffL',
    '袖口 L',
    'armL',
    polygon(
      [
        [825, 1300],
        [905, 1290],
        [912, 1350],
        [832, 1360],
      ],
      WHITE,
    ),
  ),
  free(
    'cuffR',
    '袖口 R',
    'armR',
    polygon(
      [
        [175, 1300],
        [95, 1290],
        [88, 1350],
        [168, 1360],
      ],
      WHITE,
    ),
  ),
];

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

async function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(join(OUT_DIR, 'assets'), { recursive: true });
  const meshGenerator = createMeshGenerator();
  const assets: Asset[] = [];
  const meshes: Mesh[] = [];
  const parts: Part[] = [];

  for (const layer of LAYERS) {
    const full = createCanvas(WIDTH, HEIGHT);
    const ctx = full.getContext('2d');
    ctx.scale(S, S);
    layer.draw(ctx);
    const b = alphaBounds(ctx.getImageData(0, 0, WIDTH, HEIGHT).data, WIDTH, HEIGHT);
    const trimmed = createCanvas(b.width, b.height);
    const tctx = trimmed.getContext('2d');
    tctx.drawImage(full, b.x, b.y, b.width, b.height, 0, 0, b.width, b.height);
    const png = trimmed.toBuffer('image/png');
    const assetId = `asset-${layer.key}`;
    const path = `assets/${assetId}.png`;
    writeFileSync(join(OUT_DIR, path), png);
    assets.push({
      id: assetId,
      path,
      hash: createHash('sha256').update(png).digest('hex'),
      width: b.width,
      height: b.height,
      offset: { x: b.x, y: b.y },
      canvasSize: { width: WIDTH, height: HEIGHT },
      source: { kind: 'psd', file: 'reference-model.psd', layerName: layer.key },
      sourceBlendMode: 'normal',
      sourceOpacity: 1,
    });
    const alpha = tctx.getImageData(0, 0, b.width, b.height) as unknown as ImageData;
    const mesh: Mesh = {
      id: `mesh-${layer.key}`,
      ...meshGenerator.generate(alpha, { x: b.x, y: b.y }, 'standard'),
      density: 'standard',
      edited: false,
    };
    meshes.push(mesh);
    parts.push({
      id: `part-${layer.key}`,
      name: layer.standardType ? STANDARD_PART_NAMES[layer.standardType] : (layer.name ?? layer.key),
      kind: 'image',
      standardType: layer.standardType,
      assetId,
      meshId: mesh.id,
      parentId: layer.parent ? `part-${layer.parent}` : null,
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      pivot: { x: b.x + b.width / 2, y: b.y + b.height / 2 },
      opacity: 1,
      blendMode: 'normal',
      depth: 0,
      mask: null,
      physicsId: null,
      visible: true,
      locked: false,
    });
  }

  const empty = createEmptyProject('基準モデル');
  const scene = { ...empty.studio.scenes[0]!, id: 'scene-1' };
  const assigned: Project = {
    ...empty,
    id: 'reference-model',
    assets,
    model: { ...empty.model, parts, meshes, drawOrder: parts.map((p) => p.id) },
    studio: { ...empty.studio, scenes: [scene], activeSceneId: scene.id },
  };
  // かんたんセットアップ（階層・ピボット・描画順・マスク・奥行き・バインディング）
  const { command, warnings } = createAutoSetup().plan(assigned);
  const project = validateProject(command.apply(assigned));
  writeFileSync(join(OUT_DIR, 'project.json'), JSON.stringify(project, null, 2) + '\n');

  // 描画順（かんたんセットアップの後）で重ねた見本の画像（確認用。半分の大きさ）
  const preview = createCanvas(WIDTH / 2, HEIGHT / 2);
  const pctx = preview.getContext('2d');
  pctx.fillStyle = '#ffffff';
  pctx.fillRect(0, 0, WIDTH / 2, HEIGHT / 2);
  pctx.scale(0.5, 0.5);
  for (const partId of project.model.drawOrder) {
    const part = project.model.parts.find((p) => p.id === partId);
    const asset = assets.find((a) => a.id === part?.assetId);
    if (!asset) continue;
    pctx.drawImage(await loadImage(join(OUT_DIR, asset.path)), asset.offset.x, asset.offset.y);
  }
  writeFileSync(join(OUT_DIR, 'preview.png'), preview.toBuffer('image/png'));

  const vertices = meshes.reduce((n, m) => n + m.vertices.length, 0);
  console.log(
    `reference-model: ${parts.length} レイヤー・頂点 ${vertices}・パーツ ${project.model.parts.length}（変形グループ込み）・バインディング ${project.model.bindings.length} を ${OUT_DIR} に書き出した`,
  );
  if (warnings.length) console.log(`かんたんセットアップの警告: ${warnings.join(' / ')}`);
}

await main();
