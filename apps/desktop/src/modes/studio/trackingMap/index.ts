// トラッキングの割り当て（I-042）。register() でスタジオの設定（詳細）にセクションを入れる
import { registerPanelSection } from '../../../shell/api';
import { STUDIO_SETTINGS_PANEL } from '../sections';
import { TrackingMapSection } from './TrackingMapSection';

export { TRACKING_MAP_LABEL } from './commands';

export function register(): void {
  // トラッキング（order 10）・キャリブレーション（12）の後、体の動き（15）の前
  registerPanelSection({
    id: 'studio.trackingMap',
    panelId: STUDIO_SETTINGS_PANEL,
    order: 13,

    component: TrackingMapSection,
  });
}
