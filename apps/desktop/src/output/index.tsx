// 出力ウィンドウ（/output で開く）。UI なしでモデルだけを描く
import { isTauri } from '../platform/tauri';
import { createServices } from '../services';
import { createOutputApp } from './app';
import { createBrowserOutputClient } from './browserTransport';
import { createTauriOutputClient } from './tauriTransport';
import './output.css';

export function startOutputWindow(root: HTMLElement): void {
  document.documentElement.classList.add('output-window');
  document.title = '出力 - 2D Live Model Creator Studio';
  const client = isTauri() ? createTauriOutputClient() : createBrowserOutputClient();
  const app = createOutputApp(root, { services: createServices(), client });
  app.ready.catch((e: unknown) => console.error('出力ウィンドウの受け取りを始められない', e));
}
