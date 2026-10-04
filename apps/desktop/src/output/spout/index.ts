// Spout2 出力（カード41）。register() でスタジオの設定のパネルに「出力の方式」を入れる。
// 本物の OutputSink（createSpoutSink）は結合（カード44）で services.spout に入れる。それまでは仮実装（FakeSpout）で動く
import { registerPanelSection } from '../../shell/api';
import { OutputMethodSection } from './OutputMethodSection';

export { createSpoutSink, SPOUT_SENDER_NAME, type SpoutSink, type SpoutSinkOptions } from './sink';
export { bindSpoutOutput, spoutOutput, useSpoutStatus, type SpoutStatus } from './controller';

// スタジオの設定のパネル（modes/studio の STUDIO_SETTINGS_PANEL）
const STUDIO_SETTINGS_PANEL = 'studioSettings';

export function register(): void {
  // 「出力」（解像度・出力ウィンドウ、order 30）の前に置く
  registerPanelSection({
    id: 'studio.outputMethod',
    panelId: STUDIO_SETTINGS_PANEL,
    order: 29,
    component: OutputMethodSection,
  });
}
