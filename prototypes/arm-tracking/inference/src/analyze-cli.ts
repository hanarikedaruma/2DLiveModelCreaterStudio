// 収録した点列を照合し、結果の JSON・表と、回帰用の短い点列の例を書き出す。
//   node fixtures/node_modules/tsx/dist/cli.mjs prototypes/arm-tracking/inference/src/analyze-cli.ts <収録.json> <出力先>
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { analyze, directionBin } from './analyze';
import { clip, type Recording } from './record';

// 回帰用に残す区間（左右・遮蔽・指さし・交差）。各区間の先頭 2 秒だけにして小さくする
const CLIPS: Record<string, string[]> = {
  'sides-wave': ['wave-right', 'wave-left', 'wave-both'],
  pointing: ['point-up-right', 'point-side-right', 'point-diag-right', 'point-side-left', 'point-diag-left'],
  'occlusion-cross': ['cross', 'cover-face', 'out-and-back'],
  shapes: ['peace-face-right', 'fist-right', 'flip-right'],
};

const pct = (v: number | null | undefined): string => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '—');

async function main(): Promise<void> {
  const [input, outDir] = process.argv.slice(2);
  if (!input || !outDir) throw new Error('使い方: analyze-cli.ts <収録.json> <出力先>');
  const recording = JSON.parse(await readFile(input, 'utf8')) as Recording;
  const result = analyze(recording);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'analysis.json'), JSON.stringify(result, null, 1));
  const rows = result.steps.map((s) =>
    [
      s.id,
      s.followed ? '○' : '×',
      s.retries,
      s.frames,
      s.truthHandRate === null ? '—' : `${pct(s.truthHandRate)} / ${pct(s.otherHandRate)}`,
      pct(s.poseRate),
      `${pct(s.visibility.left.elbow)} / ${pct(s.visibility.right.elbow)}`,
      `${pct(s.visibility.left.wrist)} / ${pct(s.visibility.right.wrist)}`,
      pct(s.hands?.sdkSameNameAsTruth),
      pct(s.handRate),
      pct(s.sdkGestureMatch),
      pct(s.geometricMatch),
      s.indexDirectionDeg === null
        ? '—'
        : `${Math.round(s.indexDirectionDeg)}°（${directionBin(s.indexDirectionDeg)}）`,
      pct(s.faceRate),
    ].join(' | '),
  );
  const free = result.truthFree;
  const table = [
    `案内どおりに動けた区間（○）: ${result.followedSteps}/${result.steps.length}。× の区間は精度の集計に使わない。` +
      '片手の区間は、案内の側の Pose の手首に近い手だけを照合する。',
    '',
    '| 区間 | 案内どおり | やり直し | 件数 | 案内の手/反対の手 | Pose | 肘 左/右 | 手首 左/右 | SDK手の左右名＝演者 | 手 | SDK手形一致 | 幾何の手形一致 | 人さし指の向き | 顔 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r} |`),
    '',
    '案内の正解を使わない集計（全フレーム）:',
    '',
    `- 手の左右候補＝近い Pose の手首の名前: ${pct(free.sdkSideMatchesNearestPoseWrist.rate)}（${free.sdkSideMatchesNearestPoseWrist.frames}件）、交差中 ${pct(free.whileCrossed.rate)}（${free.whileCrossed.frames}件）`,
    `- 指の曲がりで指さしのフレームの SDK Pointing_Up: ${Object.entries(free.pointingByDirection)
      .map(([bin, v]) => `${bin} ${pct(v.sdkPointingUp / v.frames)}（${v.frames}件）`)
      .join('、')}`,
    `- 顔を見失ったフレーム ${free.faceLost.frames}件で Pose ${pct(free.faceLost.poseRate)}・手 ${pct(free.faceLost.handRate)}`,
    `- 肘が見える: 左 ${pct(free.elbowVisible.left)}・右 ${pct(free.elbowVisible.right)}`,
    `- 指の曲がりの判定 × SDK の既成手形: ${JSON.stringify(free.geometricShapeVsSdk)}`,
  ].join('\n');
  await writeFile(join(outDir, 'analysis.md'), table + '\n');
  // 案内どおりに動けなかった区間は、正解が実際の動きと合わないので回帰用の点列に入れない
  const followed = new Set(result.steps.filter((s) => s.followed).map((s) => s.id));
  for (const [name, ids] of Object.entries(CLIPS)) {
    const part = clip(
      recording,
      ids.filter((id) => followed.has(id)),
    );
    const starts = new Map(part.steps.map((s) => [s.id, s.start]));
    part.frames = part.frames.filter((f) => f.t - (starts.get(f.step!) ?? 0) < 2000);
    await writeFile(join(outDir, `points-${name}.json`), JSON.stringify(part));
  }
  // 証跡はリポジトリの整形規則に合わせる（ルートから実行する前提）
  execFileSync(process.execPath, [resolve('node_modules/prettier/bin/prettier.cjs'), '--write', outDir], {
    stdio: 'ignore',
  });
  console.log(table);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
