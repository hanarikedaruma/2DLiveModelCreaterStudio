// キャリブレーション・トラッキングの簡易設定（カード35）。register() でスタジオの設定にセクションを入れる
import { registerPanelSection } from '../../../shell/api';
import { STUDIO_SETTINGS_PANEL } from '../sections';
import { CalibrationSection } from './CalibrationSection';

export { CALIBRATION_STEPS, createCalibrationFlow, type CalibrationFlow, type CalibrationPhase } from './flow';
export { trackingOptions, type TrackingOptions } from './options';

export function register(): void {
  // トラッキング（order 10）のすぐ後
  registerPanelSection({
    id: 'studio.calibration',
    panelId: STUDIO_SETTINGS_PANEL,
    order: 12,
    component: CalibrationSection,
  });
}
