// 2Dパラメータと組み合わせキー（カード30）。パラメータパネルに方向グリッド（かんたん）と組み合わせの補正（詳細）を差し込む
import { registerPanelSection } from '../../../shell/api';
import { PARAMETER_PANEL_ID } from '../parameters/ParameterPanel';
import { CombinationSection } from './CombinationSection';
import { DirectionGridSection } from './DirectionGridSection';

export const DIRECTION_GRID_SECTION_ID = 'modeling.grid2d.direction';
export const COMBINATION_SECTION_ID = 'modeling.grid2d.combination';

export function register(): void {
  registerPanelSection({
    id: DIRECTION_GRID_SECTION_ID,
    panelId: PARAMETER_PANEL_ID,
    order: 10,
    level: 'easy',
    component: DirectionGridSection,
  });
  registerPanelSection({
    id: COMBINATION_SECTION_ID,
    panelId: PARAMETER_PANEL_ID,
    order: 10,
    level: 'detail',
    component: CombinationSection,
  });
}
