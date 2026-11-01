import { registerCanvasTool, registerPanel } from '../../../shell/api';
import { createEnvSlot } from '../canvas/env';
import { createArmEditor, ARM_TOOL_ID } from './tool';
import { makeArmPanel } from './ArmPanel';
export const armToolEnv = createEnvSlot();
export const armEditor = createArmEditor(armToolEnv);
const ArmPanel = makeArmPanel(armToolEnv, armEditor);
export function register(): void {
  registerCanvasTool(armEditor.tool);
  registerPanel({
    id: 'armSetup',
    title: '腕・手の設定',
    mode: 'modeling',
    area: 'right',
    order: 43,
    component: ArmPanel,
    object: { kind: 'tool', when: ({ activeToolId }) => activeToolId === ARM_TOOL_ID },
  });
}
