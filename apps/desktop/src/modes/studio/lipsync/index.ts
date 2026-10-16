// 音量のリップシンク（カード37）。実行部のproducerと、マイク・音声パネルのセクションを登録する
import { registerPanelSection } from '../../../shell/api';
import { registerLayerProducer } from '../runtime';
import { STUDIO_AUDIO_PANEL } from '../sections';
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
    panelId: STUDIO_AUDIO_PANEL,
    order: 20,
    component: LipSyncSection,
  });
}
