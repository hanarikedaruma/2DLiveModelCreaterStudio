// CLの集計関数を呼ばず、保存した生時刻から分母・分位点を独立再計算する。
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const path = process.argv[2];
const run = JSON.parse(await readFile(path, 'utf8'));
const reports = [];
const quantile = (data, q) => {
  const a = [...data].sort((x, y) => x - y);
  if (!a.length) return null;
  const at = (a.length - 1) * q;
  return a[Math.floor(at)] * (1 - (at % 1)) + a[Math.ceil(at)] * (at % 1);
};
for (const r of run.results.filter((r) => r.window && r.timeline)) {
  const { start, end } = r.window;
  const inRange = (t) => t !== null && t >= start && t < end;
  const rows = (data, cols) => data.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
  const bodies = rows(r.timeline.bodies, r.timeline.bodiesColumns).filter((b) => !b.stale && inRange(b.arrivedAt));
  const frames = rows(r.timeline.frames, r.timeline.framesColumns);
  const report = { name: r.name, parts: {} };
  for (const [key, records] of [
    ['pose', bodies.filter((b) => b.poseEnd !== null)],
    ['hands', bodies.filter((b) => b.handEnd !== null)],
    ['face', frames.filter((f) => inRange(f.faceEnd))],
    ['camera', frames.filter((f) => inRange(f.now))],
  ]) {
    const fps = (records.length * 1000) / (end - start);
    assert.ok(Math.abs(fps - r.summary[key].fps) < 0.21, `${r.name}/${key} fps`); // 0.1ms丸めによる窓端1件を許す
    const latencies =
      key === 'pose' || key === 'hands'
        ? records.filter((b) => b.appliedAt !== null).map((b) => b.appliedAt - b.captureTime)
        : null;
    if (latencies?.length)
      for (const [name, q] of [
        ['p50', 0.5],
        ['p95', 0.95],
      ])
        assert.ok(
          Math.abs(quantile(latencies, q) - r.summary[key].captureToDisplayMs[name]) < 0.11,
          `${r.name}/${key}/${name}`,
        );
    report.parts[key] = {
      count: records.length,
      fps,
      ...(latencies ? { displayed: latencies.length, p95: quantile(latencies, 0.95) } : {}),
    };
  }
  reports.push(report);
}
const byName = Object.fromEntries(run.results.map((r) => [r.name, r]));
assert.ok(byName.normal.summary.pose.fps > 0 && byName.normal.summary.hands.fps > 0);
assert.ok(byName['gpu-fail'].summary.pose.fps > 0 && byName['gpu-fail'].summary.hands.fps > 0);
assert.ok(byName['gesture-fail'].summary.pose.fps > 0 && byName['gesture-fail'].summary.hands.fps === 0);
assert.ok(byName['worker-fail'].summary.face.fps > 0 && byName['worker-fail'].summary.pose.fps === 0);
assert.ok(byName['transfer-fail'].summary.worker.transferErrors > 0 && byName['transfer-fail'].summary.pose.fps > 0);
await writeFile(
  path.replace('run.json', 'co-verification.json'),
  JSON.stringify({ passed: true, reports }, null, 2) + '\n',
);
console.log(JSON.stringify(reports));
