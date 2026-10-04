// カード32: 合成モードの選択。register() で「Transform」パネルにセクションを入れる
import { registerPanelSection } from '../../../shell/api';
import { BlendModeSection } from './BlendModeSection';

export { setBlendMode, BLEND_MODE_OPTIONS } from './commands';

export const BLEND_SECTION_ID = 'blend.mode';

export function register(): void {
  registerPanelSection({ id: BLEND_SECTION_ID, panelId: 'transform', order: 10, component: BlendModeSection });
}
