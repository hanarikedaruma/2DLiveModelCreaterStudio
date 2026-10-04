// 顔の推定と、外へ通信しないこと（カード24）。本物のカメラが無い PC（CI など）では飛ばす。
// - CSP で外への通信が止まる（試しに外へ fetch すると拒まれる）
// - CSP の下でも MediaPipe の推定が動き、フレームが届く
// - MediaPipe の利用状況の送信（60秒ごと）を含め、外のサーバーへの通信が1つも届かない
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { answerDialog, launchApp, sleep, type RunningApp } from './app';

const LOCAL_HOSTS = ['tauri.localhost', 'ipc.localhost', 'localhost', '127.0.0.1'];

let app: RunningApp | null = null;
const externalResponses: string[] = [];

beforeAll(async () => {
  app = await launchApp(9336);
  while ((await answerDialog(app.page, 'キャンセル', 2000)) !== null) {
    // 前の作業の残りは復元しない
  }
  // ページから外のサーバーへ実際に届いた通信（応答のあったもの）を記録する
  app.page.on('response', (res) => {
    const url = new URL(res.url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !LOCAL_HOSTS.includes(url.hostname)) {
      externalResponses.push(res.url());
    }
  });
  // CSP に止められた通信を記録する
  await app.page.evaluate(() => {
    const w = window as unknown as { __cspBlocked: string[] };
    w.__cspBlocked = [];
    document.addEventListener('securitypolicyviolation', (e) => w.__cspBlocked.push(e.blockedURI));
  });
}, 180_000);

afterAll(async () => {
  await app?.page.evaluate(() => window.__studio.services.tracking.stop()).catch(() => {});
  await app?.close();
});

describe('顔の推定と外への通信', () => {
  it('CSP で外への通信が拒まれる', async () => {
    const result = await app!.page.evaluate(() =>
      fetch('https://example.com/').then(
        () => 'ok',
        (e: unknown) => `blocked: ${String(e)}`,
      ),
    );
    expect(result).toMatch(/^blocked/);
    const blocked = await app!.page.evaluate(() => (window as unknown as { __cspBlocked: string[] }).__cspBlocked);
    expect(blocked.some((u) => u.includes('example.com'))).toBe(true);
  });

  it('カメラで推定が動き、65秒のあいだ外のサーバーへ何も届かない', async (ctx) => {
    const page = app!.page;
    const devices = await page.evaluate(() => window.__studio.services.tracking.listDevices());
    if (devices.length === 0) ctx.skip(); // カメラの無い PC

    await page.evaluate(async () => {
      const w = window as unknown as { __frames: { t: number; d: boolean }[] };
      w.__frames = [];
      window.__studio.services.tracking.onFrame((f) => w.__frames.push({ t: f.time, d: f.detected }));
      await window.__studio.services.tracking.start();
    });

    // MediaPipe は利用状況を60秒ごとに送ろうとするので、それより長く動かす
    await sleep(65_000);

    const stats = await page.evaluate(() => {
      const frames = (window as unknown as { __frames: { t: number; d: boolean }[] }).__frames;
      const last = frames.at(-1)?.t ?? 0;
      const recent = frames.filter((f) => f.t > last - 10_000);
      return {
        frames: frames.length,
        fpsLast10s: recent.length / 10,
        detected: frames.filter((f) => f.d).length,
        cspBlocked: (window as unknown as { __cspBlocked: string[] }).__cspBlocked,
      };
    });
    await page.evaluate(() => window.__studio.services.tracking.stop());
    console.log('[推定]', JSON.stringify({ ...stats, externalResponses }));

    // 推定が動いてフレームが届いている（顔が写っていなくても detected false のフレームは届く）
    expect(stats.frames).toBeGreaterThan(0);
    expect(stats.fpsLast10s).toBeGreaterThan(10);
    // 外のサーバーへは1つも届いていない
    expect(externalResponses).toEqual([]);
  }, 180_000);
});
