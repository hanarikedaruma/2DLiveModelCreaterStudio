// カード50: 物理のかんたんUIと揺れの自動作成。register() で「パーツの設定」に物理のセクションを入れる
import { registerPanelSection } from '../../../shell/api';
import { PART_SETTINGS_PANEL_ID } from '../structure';
import { PhysicsSection } from './PhysicsSection';

export {
  enablePhysicsCommand,
  disablePhysicsCommand,
  rebuildSwayCommand,
  physicsOfPart,
  swayParameterIdFor,
} from './commands';
export { PHYSICS_PRESETS, PHYSICS_KINDS } from './presets';
export { simulateSwayPreview } from './preview';

export const PHYSICS_SECTION_ID = 'modeling.physics';

export function register(): void {
  registerPanelSection({
    id: PHYSICS_SECTION_ID,
    panelId: PART_SETTINGS_PANEL_ID,
    order: 50,
    component: PhysicsSection,
  });
}
