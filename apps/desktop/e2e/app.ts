// 通しのテストの道具: VITE_E2E=1 でビルドしたアプリを起動し、WebView2 のリモートデバッグ（CDP）で Playwright からつなぐ
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import type { Services } from '@app/contracts';
import type { EnvironmentStore } from '../src/shell/environment';
import type { ProjectActions } from '../src/project';
import type { Diagnostics } from '../src/diagnostics';
import type { StudioRuntime } from '../src/modes/studio/runtime';

export interface StudioHook {
  startup: Promise<unknown>;
  services: Services;
  environment: EnvironmentStore;
  project: ProjectActions;
  diagnostics: Diagnostics;
  studio: { runtime: StudioRuntime };
  modeling: {
    importAssetFiles(services: Services, files: { name: string; data: Uint8Array }[]): Promise<unknown>;
    assignAssets(
      services: Services,
      target: { kind: 'standard'; type: string } | { kind: 'free'; partId: string | null; name: string },
      assetIds: readonly string[],
    ): void;
  };
}
declare global {
  interface Window {
    __studio: StudioHook;
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..', '..');
export const EXE = join(HERE, '..', 'src-tauri', 'target', 'debug', 'live2d-studio.exe');
export const RESULTS = join(HERE, 'results');

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const slash = (p: string) => p.replace(/\\/g, '/');

export interface RunningApp {
  process: ChildProcess;
  browser: Browser;
  page: Page;
  close(): Promise<void>; // ふつうに閉じる
  kill(): void; // 異常終了の代わりに強制終了する
}

// extraBrowserArgs は WebView2（Chromium）に渡す追加の引数（例: '--force_low_power_gpu'）
export async function launchApp(port = 9333, extraBrowserArgs: string[] = []): Promise<RunningApp> {
  if (!existsSync(EXE)) throw new Error(`アプリが無い: ${EXE}（pnpm e2e でビルドする）`);
  const child = spawn(EXE, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: [`--remote-debugging-port=${port}`, ...extraBrowserArgs].join(' '),
    },
    stdio: 'ignore',
  });
  // ビルドした直後の初回の起動は、ウイルス対策の検査などで遅いことがあるので長めに待つ
  let exitCode: number | null = null;
  child.once('exit', (code) => {
    exitCode = code ?? -1;
  });
  let endpoint: string | null = null;
  const endpoints = [`http://127.0.0.1:${port}`, `http://[::1]:${port}`];
  const deadline = Date.now() + 120_000;
  while (!endpoint && exitCode === null && Date.now() < deadline) {
    for (const candidate of endpoints) {
      try {
        if ((await fetch(`${candidate}/json/version`, { signal: AbortSignal.timeout(1000) })).ok) {
          endpoint = candidate;
          break;
        }
      } catch {
        // WebView2 は IPv4 または IPv6 の片方だけで待ち受けることがある。
      }
    }
    if (!endpoint) await sleep(250);
  }
  if (!endpoint) {
    child.kill();
    throw new Error(
      exitCode !== null ? `アプリが終了した（終了コード ${exitCode}）` : 'アプリの WebView2 に120秒つながらない',
    );
  }
  const browser = await chromium.connectOverCDP(endpoint);
  const pages = browser.contexts().flatMap((c) => c.pages());
  const page = pages.find((p) => !p.url().includes('/output')) ?? pages[0];
  if (!page) throw new Error('アプリの画面が見つからない');
  await page.waitForFunction(() => '__studio' in window, null, { timeout: 30_000 });
  await page.evaluate(() => window.__studio.environment.load());
  const kill = () => {
    // WebView2 の子プロセスごと止める
    if (child.pid) spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
  };
  return {
    process: child,
    browser,
    page,
    async close() {
      await browser.close().catch(() => {});
      kill();
    },
    kill,
  };
}

// 確認のダイアログが出ていれば、その中のボタン（OK かキャンセル）を押す。出ていなければ false
export async function answerDialog(page: Page, button: 'OK' | 'キャンセル', timeoutMs = 3000): Promise<string | null> {
  const dialog = page.getByRole('dialog');
  try {
    await dialog.waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    return null;
  }
  const message = await dialog.locator('.dialog-message').textContent();
  await dialog.getByRole('button', { name: button }).click();
  return message;
}

// 復元を試すテストでは呼ばない。利用者の自動保存を承認せず、起動処理そのものの完了を待つ。
export async function waitForStartup(page: Page): Promise<void> {
  let done = false;
  const ready = page
    .evaluate(async () => {
      await window.__studio.startup;
    })
    .finally(() => {
      done = true;
    });
  while (!done) await answerDialog(page, 'キャンセル', 1000);
  await ready;
}

// アプリ（live2d-studio.exe と、その WebView2 のプロセス）の使っているメモリ（ワーキングセット、MB）
export function appMemoryMb(): number {
  const script = [
    '$ids = @(Get-Process live2d-studio -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })',
    "$web = Get-CimInstance Win32_Process -Filter \"Name='msedgewebview2.exe'\" | Where-Object { $_.CommandLine -match 'jp.co.globalsystems.live2dstudio' }",
    '$sum = 0',
    'foreach ($id in $ids) { $sum += (Get-Process -Id $id).WorkingSet64 }',
    'foreach ($p in $web) { $sum += $p.WorkingSetSize }',
    '[math]::Round($sum / 1MB, 1)',
  ].join('; ');
  const out = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  return Number.parseFloat(out.stdout.trim());
}
