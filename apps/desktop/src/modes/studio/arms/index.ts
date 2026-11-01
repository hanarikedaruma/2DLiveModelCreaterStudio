// スタジオの腕・手（AT-11）。register() でスタジオの設定に「腕・手」のセクションを入れる。
// 呼ぶのは本物のサービスをつなぐ AT-12（開発中は dev/ の確認の入口から仮サービスで呼ぶ）
import { registerPanelSection } from '../../../shell/api';
import { STUDIO_SETTINGS_PANEL } from '../sections';
import { ArmsSection } from './ArmsSection';

export { ArmsSection } from './ArmsSection';
export { createDemoArmService, type DemoArmService, type DemoArmServiceOptions } from './demoService';
export { armReadiness, type ReadinessItem } from './readiness';
export {
  studioArmService,
  type ArmDiagnostics,
  type ArmSideDiagnostics,
  type DiagnosticPoint,
  type StudioArmService,
} from './service';

export function register(): void {
  // 顔のキャリブレーション・動き（order 12）の後
  registerPanelSection({ id: 'studio.arms', panelId: STUDIO_SETTINGS_PANEL, order: 14, component: ArmsSection });
}
