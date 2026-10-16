// スタジオ（カード22）。register() で枠（shell/api.ts）に中央とパネルを登録する
import { registerCenter, registerPanel, registerPanelSection } from '../../shell/api';
import {
  OutputSection,
  STUDIO_AUDIO_PANEL,
  STUDIO_SETTINGS_PANEL,
  StudioAudioPanel,
  StudioSettingsPanel,
  TrackingSection,
} from './sections';
import { StudioCenter } from './StudioCenter';
import { studioRuntime } from './runtime';
import type { ProjectDirResolver } from './backgrounds';
import './studio.css';

export { registerLayerProducer, registerFrameSink, useStudioRuntime, type StudioFrame } from './runtime';

export function register(): void {
  registerCenter('studio', StudioCenter);
  registerPanel({
    id: STUDIO_AUDIO_PANEL,
    mode: 'studio',
    area: 'right',
    title: 'マイク・音声',
    order: -10,
    component: StudioAudioPanel,
  });
  registerPanel({
    id: STUDIO_SETTINGS_PANEL,
    mode: 'studio',
    area: 'right',
    title: 'スタジオの設定',
    component: StudioSettingsPanel,
  });
  registerPanelSection({
    id: 'studio.tracking',
    panelId: STUDIO_SETTINGS_PANEL,
    order: 10,
    component: TrackingSection,
  });
  // 背景は選んだシーンの編集（scenes/、カード39）へ移した
  registerPanelSection({ id: 'studio.output', panelId: STUDIO_SETTINGS_PANEL, order: 30, component: OutputSection });
}

// 保存の結合（カード23・24）で使う。開いているプロジェクトのフォルダを教えると、背景の画像をそこへ写し、そこから読む
export function setProjectDirResolver(resolve: ProjectDirResolver): void {
  studioRuntime.backgroundFiles.setProjectDirResolver(resolve);
}

// フォルダがまだ無かったときに選んだ背景の画像を、保存したフォルダの backgrounds/ に写す
export function writePendingBackgrounds(dir: string): Promise<string[]> {
  return studioRuntime.backgroundFiles.writePending(dir);
}
