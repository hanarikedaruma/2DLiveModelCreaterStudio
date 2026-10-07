import { registerCanvasTool, registerPanel } from '../../../shell/api';
import { createEnvSlot } from '../canvas/env';
import { createCurveEditor } from './curveTool';
import { makeCurvePanel } from './CurvePanel';

export const curveToolEnv = createEnvSlot();
export const curveEditor = createCurveEditor(curveToolEnv);
const CurvePanel = makeCurvePanel(curveToolEnv, curveEditor);
export function register(): void {
  registerCanvasTool(curveEditor.tool);
  registerPanel({
    id: 'curveGuide',
    mode: 'modeling',
    area: 'right',
    title: '流れ線',
    order: 41,
    component: CurvePanel,
  });
}
