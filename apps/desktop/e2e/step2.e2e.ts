// STEP2 の結合（カード54）: 本物のアプリのスタジオで、STEP2 の producer が登録され、実際に描いたフレームに出ること。
// カメラ・マイクを使わずに確かめる:
// - シーンで有効にした標準の呼吸（周期アニメーション）で、Breath が時間とともに動く
// - 表情で顔を向けると、物理の producer（実行部の最後）が髪揺れのパラメータを動かす
// - アニメーションを再生すると、遷移しながらその値になり、止めると戻る
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { answerDialog, appDataDir, launchApp, removeTestAutosave, sleep, type RunningApp } from './app';

let appData = '';

let app: RunningApp | null = null;
let projectId = '';

beforeAll(async () => {
  app = await launchApp(9339);
  appData = await appDataDir(app.page);
  while ((await answerDialog(app.page, 'キャンセル', 2000)) !== null) {
    // 前の作業の残りは復元しない
  }
  // この新しいプロジェクトの自動保存を残さない
  await app.page.evaluate(() => window.__studio.services.autoSaver.stop());
  projectId = await app.page.evaluate(() => window.__studio.services.store.get().id);
}, 180_000);

afterAll(async () => {
  await app?.page
    .evaluate(() => {
      const s = window.__studio.services;
      s.animations.stopAll(performance.now());
      s.expressions.apply(null, performance.now());
      s.editor.set({ mode: 'modeling' });
    })
    .catch(() => {});
  await app?.close();
  removeTestAutosave(appData, projectId);
});

// 実行部が描いたフレームのパラメータを ms ごとに count 回読む
async function sample(id: string, count: number, ms: number): Promise<number[]> {
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    values.push(
      await app!.page.evaluate((p) => window.__studio.studio.runtime.lastFrame()?.params[p] ?? Number.NaN, id),
    );
    await sleep(ms);
  }
  return values;
}

describe('STEP2 の結合', () => {
  it('呼吸・物理・アニメーションが、スタジオで実際に描いたフレームに出る', async () => {
    const page = app!.page;
    const prepared = await page.evaluate(() => {
      const s = window.__studio.services;
      const project = s.store.get();
      const breath = project.animations.find((a) => a.periodic);
      const scene = project.studio.scenes.find((x) => x.id === project.studio.activeSceneId);
      const hasParams = ['Breath', 'HairFront', 'FaceAngleX'].every((id) =>
        project.model.parameters.some((p) => p.id === id),
      );
      if (!breath || !scene || !hasParams) return { ok: false, breath: !!breath, scene: !!scene, hasParams };
      s.store.dispatch({
        label: '通しのテストの準備',
        apply: (p) => ({
          ...p,
          // シーンで標準の呼吸を有効にする
          studio: {
            ...p.studio,
            scenes: p.studio.scenes.map((x) =>
              x.id === scene.id ? { ...x, periodicAnimationIds: [...x.periodicAnimationIds, breath.id] } : x,
            ),
          },
          // 髪の物理（入力は既定の顔・体の角度）
          physics: [
            ...p.physics,
            {
              id: 'e2e-hair',
              partId: 'e2e-root',
              preset: 'hair' as const,
              strength: 0.5,
              direction: 'horizontal' as const,
              length: 100,
              spring: 0.3,
              damping: 0.2,
              gravity: 0.5,
              inertia: 1,
              range: 1,
              inputs: [],
              outputParameterId: 'HairFront',
            },
          ],
          // 顔を向ける表情（物理より前のレイヤー）
          expressions: [
            ...p.expressions,
            {
              id: 'e2e-turn',
              name: '通しのテスト',
              entries: [{ parameterId: 'FaceAngleX', value: 30, blend: 'override' as const }],
              fadeIn: 0,
              fadeOut: 0,
            },
          ],
          // 顔を左へ向けるアニメーション
          animations: [
            ...p.animations,
            {
              ...breath,
              id: 'e2e-look',
              name: '通しのテスト',
              periodic: false,
              loop: true,
              duration: 2,
              tracks: [{ parameterId: 'FaceAngleX', keyframes: [{ time: 0, value: -20, curve: 'linear' as const }] }],
            },
          ],
        }),
      });
      s.editor.set({ mode: 'studio' });
      return { ok: true, breathId: breath.id };
    });
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);

    // スタジオの実行部が回り始めるのを待つ
    await page.waitForFunction(() => window.__studio.studio.runtime.lastFrame() !== null, null, { timeout: 30_000 });
    await sleep(500);

    // 呼吸: 4秒周期で Breath が動く
    const breath = await sample('Breath', 16, 150);
    expect(
      Math.max(...breath) - Math.min(...breath),
      `Breath ${breath.map((v) => v.toFixed(2)).join(' ')}`,
    ).toBeGreaterThan(0.2);

    // 物理: 止まっているときは揺れていない。顔を急に向けると髪揺れが動く
    const before = await sample('HairFront', 3, 100);
    expect(Math.max(...before.map(Math.abs))).toBeLessThan(0.05);
    await page.evaluate(() => window.__studio.services.expressions.apply('e2e-turn', performance.now()));
    const sway = await sample('HairFront', 15, 60);
    expect(Math.max(...sway.map(Math.abs)), `HairFront ${sway.map((v) => v.toFixed(2)).join(' ')}`).toBeGreaterThan(
      0.05,
    );
    const face = await sample('FaceAngleX', 1, 0);
    expect(face[0]).toBeCloseTo(30, 0);

    // アニメーション: 表情を外して再生すると -20 へ遷移し、止めると戻る（トラッキングは止めているのでデフォルト値 0）
    await page.evaluate(() => {
      const s = window.__studio.services;
      s.expressions.apply(null, performance.now());
      s.animations.play('e2e-look', performance.now());
    });
    await expect
      .poll(async () => (await sample('FaceAngleX', 1, 0))[0], { timeout: 5000, interval: 100 })
      .toBeLessThan(-19);
    expect(await page.evaluate(() => window.__studio.services.animations.playing())).toEqual(['e2e-look']);
    await page.evaluate(() => window.__studio.services.animations.stop('e2e-look', performance.now()));
    await expect
      .poll(async () => Math.abs((await sample('FaceAngleX', 1, 0))[0]!), { timeout: 5000, interval: 100 })
      .toBeLessThan(0.5);
  }, 120_000);
});
