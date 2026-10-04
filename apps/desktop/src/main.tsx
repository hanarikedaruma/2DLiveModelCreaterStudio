import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerDevParts } from './dev';
import { registerDiagnostics } from './diagnostics';
import { registerModes } from './modes';
import { studioRuntime } from './modes/studio/runtime';
import { assignAssets, importAssetFiles } from './modes/modeling/assets';
import { startOutputWindow } from './output';
import { bindSpoutOutput } from './output/spout/controller';
import { registerProject } from './project';
import { createEnvironment, createServices } from './services';
import { createDialogController } from './shell/dialogs';

const root = document.getElementById('root');
if (!root) throw new Error('#root が見つからない');

// 出力ウィンドウ（カード22）は同じ index.html を /output で開く
if (window.location.pathname.startsWith('/output')) {
  startOutputWindow(root);
} else {
  const services = createServices();
  const environment = createEnvironment(services);
  const dialogs = createDialogController();
  registerModes();
  const project = registerProject(services, environment, dialogs);
  const diagnostics = registerDiagnostics(services);
  if (import.meta.env.DEV) registerDevParts(services); // サンプルを開くメニュー・座標の確認など（開発中だけ）

  // 開発中と通しのテスト（VITE_E2E=1 でビルド）の確認用。ふだんの本番のビルドには入らない
  if (import.meta.env.DEV || import.meta.env.VITE_E2E === '1') {
    Object.assign(window, {
      __studio: {
        services,
        environment,
        project,
        diagnostics,
        modeling: { importAssetFiles, assignAssets },
        studio: { runtime: studioRuntime }, // 実際に描いたフレームのパラメータを読む（STEP2 の通しのテスト）
      },
    });
  }

  createRoot(root).render(
    <StrictMode>
      <App services={services} environment={environment} dialogs={dialogs} />
    </StrictMode>,
  );

  // 起動時: 環境設定で Spout2 を選んでいれば送り始める（カード41。設定のパネルを開かなくても）。
  // そのあと、異常終了で残った自動保存があれば復元を提案し、自動保存を始める
  void environment
    .load()
    .then(() => {
      bindSpoutOutput(services, environment);
      return project.recoverOnStartup();
    })
    .catch((e) => console.error('起動時の復元の確認に失敗した', e));
}
