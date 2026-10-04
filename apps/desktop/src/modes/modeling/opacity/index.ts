// カード34: 不透明度のキー。register() で「Transform」パネルに「不透明度（このキー）」のセクションを入れる
import { registerPanelSection } from '../../../shell/api';
import { OpacityKeySection } from './OpacityKeySection';

export { OPACITY_FLOOR, opacityAt, opacityCommand } from './opacityKey';

export const OPACITY_KEY_SECTION_ID = 'transform.opacityKey';

export function register(): void {
  registerPanelSection({ id: OPACITY_KEY_SECTION_ID, panelId: 'transform', order: 5, component: OpacityKeySection });
}
