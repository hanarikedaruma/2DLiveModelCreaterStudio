// パラメータパネルとキー編集（カード19）。register() で枠（shell/api.ts）に部品を登録する
import { registerCanvasOverlay, registerPanel } from '../../../shell/api';
import { drawEditingOverlay, EDITING_OVERLAY_ID } from './overlay';
import { PARAMETER_PANEL_ID, ParameterPanel } from './ParameterPanel';

export function register(): void {
  registerPanel({
    id: PARAMETER_PANEL_ID,
    mode: 'modeling',
    area: 'right',
    title: 'パラメータ',
    order: 10,
    component: ParameterPanel,
    info: PARAMETER_PANEL_ID,
  });
  registerCanvasOverlay(EDITING_OVERLAY_ID, drawEditingOverlay);
}
