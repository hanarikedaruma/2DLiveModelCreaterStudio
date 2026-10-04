// 音量のリップシンク（カード37）。register() で実行部に producer を、スタジオの設定にセクションを入れる
import { registerPanelSection } from '../../../shell/api';
import { registerLayerProducer } from '../runtime';
import { STUDIO_SETTINGS_PANEL } from '../sections';
import { lipSyncBinding } from './lipSync';
import { LipSyncSection } from './LipSyncSection';

export { lipSyncBinding, setLipSyncCommand, type LipSyncBinding, type MicrophoneStatus } from './lipSync';

let unregisterLipSync: (() => void) | null = null;

export function register(): void {
  // 何度呼んでも実行部には1つだけ入れる（テストや開発中の読み込み直しで二重にしない）
  unregisterLipSync?.();
  unregisterLipSync = registerLayerProducer(lipSyncBinding.producer);
  registerPanelSection({
    id: 'studio.lipSync',
    panelId: STUDIO_SETTINGS_PANEL,
    order: 16,
    component: LipSyncSection,
  });
}
