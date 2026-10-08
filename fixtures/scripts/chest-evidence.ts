// 方式Aと開発用の面積補助案Bの比較。アプリの設定・モデルは変更しない。
// pnpm --filter @app/fixtures exec tsx scripts/chest-evidence.ts [出力先]
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import {
  bounceFrame,
  chestEquilibrium,
  chestStaticParams,
  ChestDynamicsSession,
  createBindingEvaluator,
  createDeformPipeline,
  chestDeformBindingIds,
} from '@app/core';
import { validateProject, type Mesh, type Vec2 } from '@app/schema';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const font = join(process.env.WINDIR ?? 'C:/Windows', 'Fonts', 'meiryo.ttc');
if (existsSync(font)) GlobalFonts.registerFromPath(font, 'C98Japanese');
const out = resolve(root, process.argv[2] ?? 'docs/evidence/i061-chest-2026-10-09');
mkdirSync(out, { recursive: true });
const p = validateProject(JSON.parse(readFileSync(join(root, 'fixtures/chest-model/project.json'), 'utf8')));
const images = new Map(
  await Promise.all(
    p.assets.map(async (a) => [a.id, await loadImage(join(root, 'fixtures/chest-model', a.path))] as const),
  ),
);
const ev = createBindingEvaluator(),
  pipeline = createDeformPipeline(),
  item = p.physics[0]!,
  mesh = p.model.meshes.find((m) => m.id === item.bounce!.meshId)!;
const baseModel = { ...p.model, bindings: p.model.bindings.filter((b) => !chestDeformBindingIds(p).has(b.id)) };
const area = (positions: Float32Array, t: [number, number, number]) => {
  const [a, b, c] = t;
  return (
    ((positions[b * 2]! - positions[a * 2]!) * (positions[c * 2 + 1]! - positions[a * 2 + 1]!) -
      (positions[b * 2 + 1]! - positions[a * 2 + 1]!) * (positions[c * 2]! - positions[a * 2]!)) /
    2
  );
};
const sum = (positions: Float32Array, m: Mesh) => m.triangles.reduce((n, t) => n + Math.abs(area(positions, t)), 0);
const candidate = (base: Float32Array, a: Float32Array) => {
  // Bの試作: 重み付きの小さな拡縮で総面積との差を抑える。各三角形も別に検査する。
  const center = item.bounce!.weights.indexOf(1),
    cx = base[center * 2]!,
    cy = base[center * 2 + 1]!;
  let best = a,
    error = Math.abs(sum(a, mesh) - sum(base, mesh)),
    alpha = 0;
  for (let step = -60; step <= 60; step++) {
    const v = step * 0.002,
      points = Float32Array.from(
        a,
        (n, i) => n + v * item.bounce!.weights[Math.floor(i / 2)]! * (base[i]! - (i % 2 === 0 ? cx : cy)),
      );
    const safe = mesh.triangles.every((t) => area(points, t) / area(base, t) >= 0.1);
    const diff = Math.abs(sum(points, mesh) - sum(base, mesh));
    if (safe && diff < error) {
      best = points;
      error = diff;
      alpha = v;
    }
  }
  return { positions: best, alpha };
};
const draw = (
  c: SKRSContext2D,
  positions: Record<string, Float32Array>,
  tx: number,
  ty: number,
  scale: number,
  wire = false,
) => {
  c.save();
  c.translate(tx, ty);
  c.scale(scale, scale);
  for (const id of p.model.drawOrder) {
    const part = p.model.parts.find((v) => v.id === id)!,
      m = p.model.meshes.find((v) => v.id === part.meshId)!,
      image = images.get(part.assetId!)!,
      dest = positions[id]!;
    for (const [i, j, k] of m.triangles) {
      const points = [i, j, k].map((v) => ({ x: dest[v * 2]!, y: dest[v * 2 + 1]! })),
        uv = [i, j, k].map((v) => ({ x: m.uvs[v]!.x * image.width, y: m.uvs[v]!.y * image.height }));
      const x1 = uv[1]!.x - uv[0]!.x,
        y1 = uv[1]!.y - uv[0]!.y,
        x2 = uv[2]!.x - uv[0]!.x,
        y2 = uv[2]!.y - uv[0]!.y,
        det = x1 * y2 - x2 * y1;
      if (Math.abs(det) < 1e-8) continue;
      const dx1 = points[1]!.x - points[0]!.x,
        dy1 = points[1]!.y - points[0]!.y,
        dx2 = points[2]!.x - points[0]!.x,
        dy2 = points[2]!.y - points[0]!.y;
      const a = (dx1 * y2 - dx2 * y1) / det,
        b = (dy1 * y2 - dy2 * y1) / det,
        cc = (dx2 * x1 - dx1 * x2) / det,
        d = (dy2 * x1 - dy1 * x2) / det;
      const center = { x: points.reduce((n, v) => n + v.x, 0) / 3, y: points.reduce((n, v) => n + v.y, 0) / 3 };
      const clip = points.map((v) => {
        const length = Math.hypot(v.x - center.x, v.y - center.y) || 1;
        return {
          x: v.x + (((v.x - center.x) / length) * 0.4) / scale,
          y: v.y + (((v.y - center.y) / length) * 0.4) / scale,
        };
      });
      c.save();
      c.beginPath();
      clip.forEach((v, n) => (n ? c.lineTo(v.x, v.y) : c.moveTo(v.x, v.y)));
      c.closePath();
      c.clip();
      c.transform(a, b, cc, d, points[0]!.x - a * uv[0]!.x - cc * uv[0]!.y, points[0]!.y - b * uv[0]!.x - d * uv[0]!.y);
      c.drawImage(image, 0, 0);
      c.restore();
    }
    if (wire && id === 'chest') {
      c.lineWidth = 0.7 / scale;
      c.strokeStyle = '#21354477';
      for (const t of m.triangles) {
        c.beginPath();
        t.forEach((v, n) => (n ? c.lineTo(dest[v * 2]!, dest[v * 2 + 1]!) : c.moveTo(dest[v * 2]!, dest[v * 2 + 1]!)));
        c.closePath();
        c.stroke();
      }
      m.vertices.forEach((_, i) => {
        c.fillStyle = item.bounce!.weights[i] === 0 ? '#ffffff' : '#242c36';
        c.beginPath();
        c.arc(dest[i * 2]!, dest[i * 2 + 1]!, 2 / scale, 0, Math.PI * 2);
        c.fill();
      });
    }
  }
  c.restore();
};
const record: unknown[] = [];
const canvas = createCanvas(1500, 970),
  c = canvas.getContext('2d');
c.fillStyle = '#fafbfc';
c.fillRect(0, 0, 1500, 970);
c.font = '20px C98Japanese, sans-serif';
c.fillStyle = '#182534';
c.fillText('胸揺れ：傾いた静止姿勢 / 白い点は体に固定', 24, 30);
for (const [col, angle] of [-90, -45, 0, 45, 90].entries()) {
  const params = { BodyAngleZ: angle },
    base = pipeline.deform(baseModel, ev.evaluate(baseModel, params)),
    actual = pipeline.deform(p.model, ev.evaluate(p.model, chestStaticParams(p, params)));
  const b = candidate(base.byPartId.chest!.positions, actual.byPartId.chest!.positions);
  const modes = [
    base,
    actual,
    { ...actual, byPartId: { ...actual.byPartId, chest: { ...actual.byPartId.chest!, positions: b.positions } } },
  ];
  modes.forEach((model, row) => {
    const x = col * 300,
      y = 48 + row * 300;
    c.fillStyle = '#e1e7ee';
    c.fillRect(x + 6, y, 288, 294);
    c.fillStyle = '#ffffff';
    c.fillRect(x + 7, y + 1, 286, 292);
    draw(
      c,
      Object.fromEntries(Object.entries(model.byPartId).map(([id, m]) => [id, m.positions])),
      x + 38,
      y - 5,
      0.44,
      true,
    );
    c.fillStyle = '#182534';
    c.font = '15px C98Japanese, sans-serif';
    c.fillText(`${['物理なし', 'A：平行移動の場', 'B：面積の補助（試作）'][row]} / ${angle}°`, x + 14, y + 278);
    c.strokeStyle = '#263d50';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x + 272, y + 20);
    c.lineTo(x + 272, y + 58);
    c.lineTo(x + 267, y + 51);
    c.moveTo(x + 272, y + 58);
    c.lineTo(x + 277, y + 51);
    c.stroke();
  });
  record.push({
    angle,
    params: chestStaticParams(p, params),
    areaBase: sum(base.byPartId.chest!.positions, mesh),
    areaA: sum(actual.byPartId.chest!.positions, mesh),
    areaB: sum(b.positions, mesh),
    bAlpha: b.alpha,
  });
}
writeFileSync(join(out, 'gravity-comparison.png'), canvas.toBuffer('image/png'));
const keys = createCanvas(1320, 760),
  kc = keys.getContext('2d');
kc.fillStyle = '#fafbfc';
kc.fillRect(0, 0, 1320, 760);
const poses = [
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 1, y: 1 },
];
poses.forEach((q, col) => {
  const base = pipeline.deform(baseModel, ev.evaluate(baseModel, {})),
    actual = pipeline.deform(p.model, ev.evaluate(p.model, { BustX: q.x, BustY: q.y })),
    b = candidate(base.byPartId.chest!.positions, actual.byPartId.chest!.positions);
  for (let row = 0; row < 2; row++) {
    const x = col * 264,
      y = 30 + row * 360,
      positions = Object.fromEntries(
        Object.entries(actual.byPartId).map(([id, m]) => [id, id === 'chest' && row === 1 ? b.positions : m.positions]),
      );
    kc.save();
    kc.beginPath();
    kc.rect(x + 4, y, 256, 300);
    kc.clip();
    draw(kc, positions, x - 252, y - 308, 1.5, true);
    kc.restore();
    kc.fillStyle = '#fafbfc';
    kc.fillRect(x, y + 305, 264, 54);
    kc.font = '16px C98Japanese, sans-serif';
    kc.fillStyle = '#182534';
    kc.fillText(`${row ? 'B（試作）' : 'A（製品）'}  X ${q.x} / Y ${q.y}`, x + 12, y + 331);
  }
});
writeFileSync(join(out, 'keys-comparison.png'), keys.toBuffer('image/png'));
const frame = bounceFrame(p, item, ev.evaluate(baseModel, { BodyAngleZ: 30 }))!,
  runs = [];
for (const fps of [30, 60, 120]) {
  const session = new ChestDynamicsSession(),
    samples: Vec2[] = [];
  for (let i = 0; i <= 4 * fps; i++) {
    const t = i / fps,
      u = Math.max(0, Math.min(1, (t - 0.2) / 0.3)),
      x = 4 * u * u * (3 - 2 * u);
    const q = session.advance(
      item,
      { ...frame, center: { x: frame.center.x + x, y: frame.center.y } },
      { now: t * 1000, dt: i ? 1000 / fps : 0 },
    );
    samples.push({ x: q.x / item.bounce!.amplitudes.x, y: q.y / item.bounce!.amplitudes.y });
  }
  const eq = chestEquilibrium(item.bounce!, frame.basis).x / item.bounce!.amplitudes.x;
  let lastOutside = 0;
  samples.forEach((q, i) => {
    if (Math.abs(q.x - eq) > 0.02) lastOutside = i / fps;
  });
  runs.push({
    fps,
    settledAfterStop: Math.max(0, lastOutside - 0.5),
    peakRelative: Math.max(...samples.map((q) => Math.abs(q.x - eq))),
    samples,
  });
}
const plot = createCanvas(1100, 390),
  pc = plot.getContext('2d');
pc.fillStyle = '#fff';
pc.fillRect(0, 0, 1100, 390);
pc.strokeStyle = '#adb7c3';
pc.strokeRect(70, 50, 960, 260);
pc.font = '16px C98Japanese, sans-serif';
pc.fillStyle = '#182534';
pc.fillText('横に4px動かして停止 / 重力の釣り合いからの左右出力', 70, 30);
runs.forEach((run, j) => {
  const eq = chestEquilibrium(item.bounce!, frame.basis).x / item.bounce!.amplitudes.x;
  pc.strokeStyle = ['#245b9e', '#b55a31', '#348262'][j]!;
  pc.lineWidth = 2;
  pc.beginPath();
  run.samples.forEach((q, i) => {
    const x = 70 + (i / run.fps / 4) * 960,
      y = 180 - (q.x - eq) * 120;
    if (i) pc.lineTo(x, y);
    else pc.moveTo(x, y);
  });
  pc.stroke();
  pc.fillStyle = pc.strokeStyle;
  pc.fillText(`${run.fps}fps：停止後 ${run.settledAfterStop.toFixed(2)}秒で±0.02以内`, 70 + j * 325, 354);
});
for (let i = 0; i <= 4; i++) {
  pc.fillStyle = '#182534';
  pc.fillText(`${i}s`, 64 + i * 240, 332);
}
writeFileSync(join(out, 'dynamics.png'), plot.toBuffer('image/png'));
writeFileSync(
  join(out, 'measurements.json'),
  JSON.stringify(
    {
      gravity: record,
      dynamics: runs.map(({ samples: _samples, ...rest }) => rest),
      prototypeB:
        'w * alpha * (baseVertex - center), alpha=-0.12..0.12; total area error minimized subject to signed triangle ratio >=0.1; not a volume guarantee',
    },
    null,
    2,
  ) + '\n',
);
console.log(`胸揺れの比較画像と波形を ${out} に保存しました。`);
