// 2Dパラメータと組み合わせキー（カード30）。方向グリッドを含む組み合わせの補正を差し込む
import { registerPanelSection } from '../../../shell/api';
import { PARAMETER_PANEL_ID } from '../parameters/ParameterPanel';
import { CombinationSection } from './CombinationSection';

export const COMBINATION_SECTION_ID = 'modeling.grid2d.combination';

export function register(): void {
  registerPanelSection({
    id: COMBINATION_SECTION_ID,
    panelId: PARAMETER_PANEL_ID,
    order: 10,

    component: CombinationSection,
  });
}
