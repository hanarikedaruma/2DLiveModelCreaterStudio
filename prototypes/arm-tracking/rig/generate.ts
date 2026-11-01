import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  POSES,
  RIG,
  REST,
  constrain,
  distance,
  forward,
  handPoint,
  solveTarget,
  toWorld,
  transitionAt,
  waveAt,
  type ScenePose,
} from './kinematics';
import { sceneContent, svgDocument } from './render';

const source = dirname(fileURLToPath(import.meta.url));
const root = resolve(source, '../../..');
const output = resolve(root, 'docs/arm-tracking/evidence/AT-02');
const fixtureRequire = createRequire(resolve(root, 'fixtures/package.json'));
const canvas = fixtureRequire('@napi-rs/canvas') as {
  loadImage(input: Buffer): Promise<unknown>;
  convertSVGTextToPath(input: string): Buffer;
  createCanvas(
    width: number,
    height: number,
  ): {
    getContext(kind: '2d'): { drawImage(image: unknown, x: number, y: number): void };
    toBuffer(format: 'image/png'): Buffer;
  };
};
const tsxRequire = createRequire(fixtureRequire.resolve('tsx/package.json'));
const esbuild = tsxRequire('esbuild') as {
  buildSync(options: {
    entryPoints: string[];
    bundle: boolean;
    write: boolean;
    format: string;
    platform: string;
    target: string;
  }): { outputFiles: { text: string }[] };
};
const rootRequire = createRequire(resolve(root, 'package.json'));
const prettier = rootRequire('prettier') as {
  format(input: string, options: { parser: string; [key: string]: unknown }): Promise<string>;
  resolveConfig(path: string): Promise<Record<string, unknown> | null>;
};
const formatOptions = (await prettier.resolveConfig(resolve(source, 'viewer.html'))) ?? {};
await mkdir(output, { recursive: true });
const generated: string[] = [];
async function write(name: string, value: string | Buffer): Promise<void> {
  await writeFile(resolve(output, name), value);
  generated.push(name);
}
async function json(name: string, value: unknown): Promise<void> {
  await write(name, await prettier.format(JSON.stringify(value), { ...formatOptions, parser: 'json' }));
}
async function raster(name: string, svg: string, width: number, height: number): Promise<void> {
  await write(`${name}.svg`, await prettier.format(svg, { ...formatOptions, parser: 'html' }));
  const surface = canvas.createCanvas(width, height);
  surface.getContext('2d').drawImage(await canvas.loadImage(canvas.convertSVGTextToPath(svg)), 0, 0);
  await write(`${name}.png`, surface.toBuffer('image/png'));
}
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function sheet(title: string, scenes: ScenePose[], columns: number): { svg: string; width: number; height: number } {
  const width = columns * 360,
    height = 100 + Math.ceil(scenes.length / columns) * 350;
  const cells = scenes
    .map((scene, index) => {
      const x = (index % columns) * 360,
        y = 100 + Math.floor(index / columns) * 350;
      const l = constrain(scene.left).pose,
        r = constrain(scene.right).pose;
      const angles = (p: typeof l) => [p.shoulder, p.elbow, p.wrist].map((v) => Number(v.toFixed(1))).join(' / ');
      return `<g transform="translate(${x} ${y})"><rect x="6" y="2" width="348" height="338" rx="12" fill="#f7fafb" stroke="#cbd8e0"/><text x="20" y="30" font-size="16" font-weight="bold">${index + 1}. ${escape(scene.name)}</text><svg x="8" y="38" width="344" height="272" viewBox="-430 -120 860 680">${sceneContent(scene)}</svg><text x="18" y="325" font-size="12">L ${angles(l)}°  R ${angles(r)}°</text></g>`;
    })
    .join('');
  return {
    width,
    height,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><g font-family="Meiryo" fill="#183346"><text x="20" y="38" font-size="24" font-weight="bold">${title}</text><text x="20" y="68" font-size="14">AT-02 技術見本 / 緑=L、橙=R（モデル自身の左右） / 値=肩・肘・手首 / 掌と親指の印は固定</text>${cells}</g></svg>`,
  };
}
const poseSheet = sheet('腕・手の16姿勢と関節の制限', POSES, 4);
await raster('poses', poseSheet.svg, poseSheet.width, poseSheet.height);
const waveScenes = Array.from({ length: 9 }, (_, index) => ({ ...waveAt(index / 8), name: `手振り ${index / 8}s` }));
const waveSheet = sheet('連続手振り・1周期', waveScenes, 3);
await raster('wave', waveSheet.svg, waveSheet.width, waveSheet.height);
const transitionScenes = [0, 0.25, 0.5, 0.75, 1].flatMap((t) => [
  { ...transitionAt(POSES[0]!, POSES[6]!, t), name: `休止→指さし ${t * 100}%` },
  { ...transitionAt(POSES[6]!, POSES[8]!, t), name: `指さし→顔の前 ${t * 100}%` },
]);
const transitions = sheet('角度の遷移と手形の切替', transitionScenes, 2);
await raster('transitions', transitions.svg, transitions.width, transitions.height);
await raster('face-peace', svgDocument(POSES[8]!), 860, 680);

const positions = POSES.map((scene) => ({
  ...scene,
  applied: (['L', 'R'] as const).map((side) => {
    const { pose, reasons } = constrain(side === 'L' ? scene.left : scene.right);
    const arm = forward(pose, side);
    return {
      side,
      pose,
      reasons,
      model: arm,
      world: {
        shoulder: toWorld(arm.shoulder, scene.parent),
        elbow: toWorld(arm.elbow, scene.parent),
        wrist: toWorld(arm.wrist, scene.parent),
      },
    };
  }),
}));
await json('poses.json', {
  convention: 'モデル自身のLが画面右。y下向き、肩0°=下、正角=外側へ上げる。肘0°=伸展。手の原点=手首、指方向=(0,-1)。',
  rig: RIG,
  rest: REST,
  // ここだけは座標式から独立した手計算の照合値。残りは試作の出力記録。
  manualReferences: [
    { side: 'L', pose: { shoulder: 0, elbow: 0, wrist: 0 }, elbow: { x: 78, y: 358 }, wrist: { x: 78, y: 466 } },
    { side: 'L', pose: { shoulder: 90, elbow: 90, wrist: 0 }, elbow: { x: 196, y: 240 }, wrist: { x: 196, y: 132 } },
    {
      side: 'L',
      pose: { shoulder: 45, elbow: 45, wrist: 0 },
      elbow: { x: 161.4386001800126, y: 323.4386001800126 },
      wrist: { x: 269.4386001800126, y: 323.4386001800126 },
    },
  ],
  poses: positions,
});

let maxBoneError = 0,
  maxAttachmentError = 0,
  minHandDeterminant = Infinity;
for (const scene of [...POSES, ...waveScenes, ...transitionScenes])
  for (const side of ['L', 'R'] as const) {
    const pose = constrain(side === 'L' ? scene.left : scene.right).pose,
      a = forward(pose, side);
    const s = toWorld(a.shoulder, scene.parent),
      e = toWorld(a.elbow, scene.parent),
      w = toWorld(a.wrist, scene.parent);
    maxBoneError = Math.max(
      maxBoneError,
      Math.abs(distance(s, e) - RIG.upperLength * scene.parent.scale),
      Math.abs(distance(e, w) - RIG.lowerLength * scene.parent.scale),
    );
    const o = handPoint({ x: 0, y: 0 }, pose, side, scene.parent),
      x = handPoint({ x: 1, y: 0 }, pose, side, scene.parent),
      y = handPoint({ x: 0, y: 1 }, pose, side, scene.parent);
    maxAttachmentError = Math.max(maxAttachmentError, distance(o, w));
    minHandDeterminant = Math.min(minHandDeterminant, (x.x - o.x) * (y.y - o.y) - (x.y - o.y) * (y.x - o.x));
  }
function continuity(scenes: ScenePose[]) {
  const maxStep = { shoulder: 0, elbow: 0, wrist: 0, handRotation: 0 };
  for (let i = 1; i < scenes.length; i++)
    for (const side of ['L', 'R'] as const) {
      const key = side === 'L' ? 'left' : 'right';
      const previous = constrain(scenes[i - 1]![key]).pose,
        current = constrain(scenes[i]![key]).pose;
      for (const angle of ['shoulder', 'elbow', 'wrist'] as const)
        maxStep[angle] = Math.max(maxStep[angle], Math.abs(current[angle] - previous[angle]));
      maxStep.handRotation = Math.max(
        maxStep.handRotation,
        Math.abs(forward(current, side).handRotation - forward(previous, side).handRotation),
      );
    }
  return { frames: scenes.length, fps: 60, maxDegreesPerFrame: maxStep };
}
await json('measurements.json', {
  kind: 'CO実装者の補助測定。CLの独立確認・実機性能・実素材の評価を含まない。',
  units: { length: 'px in prototype model space; world lengths include parent scale', angle: 'degrees' },
  maxBoneLengthErrorPx: maxBoneError,
  maxWristAttachmentErrorPx: maxAttachmentError,
  minHandTransformDeterminant: minHandDeterminant,
  wave: continuity(Array.from({ length: 601 }, (_, i) => waveAt(i / 60))),
  restToPoint: continuity(Array.from({ length: 121 }, (_, i) => transitionAt(POSES[0]!, POSES[6]!, i / 120))),
  pointToFacePeace: continuity(Array.from({ length: 121 }, (_, i) => transitionAt(POSES[6]!, POSES[8]!, i / 120))),
  targetExamples: [
    { x: 1000, y: -1000 },
    { x: -1000, y: 1000 },
    { x: 78, y: 240 },
    forward(POSES[8]!.left, 'L').wrist,
  ].map((target) => ({ target, ...solveTarget(target, 'L') })),
});

const compiled = esbuild.buildSync({
  entryPoints: [resolve(source, 'viewer.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
}).outputFiles[0]!.text;
const template = await readFile(resolve(source, 'viewer.html'), 'utf8');
await write(
  'preview.html',
  await prettier.format(
    template.replace('<!-- AT02_SCRIPT -->', `<script>${compiled.replace(/<\/script/gi, '<\\/script')}</script>`),
    { ...formatOptions, parser: 'html' },
  ),
);
const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const sources = [
  'kinematics.ts',
  'render.ts',
  'viewer.ts',
  'viewer.html',
  'generate.ts',
  'kinematics.co.test.ts',
  'check-preview.mjs',
  'tsconfig.json',
];
await json('manifest.json', {
  version: 'AT-02 CO prototype v1',
  sources: Object.fromEntries(
    await Promise.all(sources.map(async (path) => [path, sha256(await readFile(resolve(source, path)))])),
  ),
  outputs: Object.fromEntries(
    await Promise.all(generated.map(async (path) => [path, sha256(await readFile(resolve(output, path)))])),
  ),
});
console.log(`AT-02: ${generated.length} artifacts generated in ${output}`);
