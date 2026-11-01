import {
  armParentTransform,
  armReferenceFromJoints,
  armSetupPointMapper,
  forwardArmInModel,
  solveArmIK,
} from '@app/core';
import { transformVec, type ArmRig, type ArmSide, type Vec2 } from '@app/schema';
import type { CanvasTool } from '../../../shell/api';
import type { EnvSlot } from '../canvas/env';

export const ARM_TOOL_ID = 'modeling.arms';
export type ArmHandle = 'shoulder' | 'elbow' | 'wrist' | 'preview';
export interface ArmToolConfig {
  side: ArmSide;
  parentId: string | null;
  joints: ArmRig['joints'];
  rigId: string | null;
  handle: ArmHandle;
  onJoint(joints: ArmRig['joints']): void;
  onError(message: string): void;
}
export function createArmEditor(slot: EnvSlot) {
  let config: ArmToolConfig | null = null,
    dragging = false,
    start: Vec2 | null = null;
  const move: CanvasTool['onPointerMove'] = (e) => {
    const env = slot.get();
    if (!start || !config || !env) return;
    if (!dragging && Math.hypot(e.screenPoint.x - start.x, e.screenPoint.y - start.y) < 3) return;
    dragging = true;
    const project = env.services.store.get();
    try {
      const key = config.handle === 'preview' ? 'wrist' : config.handle;
      const solve = armSetupPointMapper(project.model, config.parentId, [config.joints[key]]),
        point = solve([e.canvasPoint])?.[0];
      if (!point) throw new Error('この親の変換では関節を配置できない');
      const rig = project.model.armRigs?.find((r) => r.id === config!.rigId);
      if (config.handle === 'preview') {
        if (!rig) return;
        const values = env.services.editor.get().editorParamValues;
        const pose = {
          shoulder: values[rig.parameters.shoulder] ?? rig.restPose.shoulder,
          elbow: values[rig.parameters.elbow] ?? rig.restPose.elbow,
          wrist: values[rig.parameters.wrist] ?? rig.restPose.wrist,
        };
        const out = solveArmIK({
          rig,
          wrist: {
            x: (point.x - rig.joints.shoulder.x) * (rig.side === 'L' ? 1 : -1),
            y: point.y - rig.joints.shoulder.y,
          },
          elbow: null,
          wristAngle: pose.wrist,
          previous: pose,
        });
        if (!out.valid) throw new Error('関節の設定を確認する');
        env.services.editor.set({
          editorParamValues: {
            ...values,
            [rig.parameters.shoulder]: out.pose.shoulder,
            [rig.parameters.elbow]: out.pose.elbow,
            [rig.parameters.wrist]: out.pose.wrist,
          },
        });
      } else config.onJoint({ ...config.joints, [key]: point });
      config.onError('');
      env.requestRedraw();
    } catch (error) {
      config.onError(error instanceof Error ? error.message : String(error));
    }
  };
  const tool: CanvasTool = {
    id: ARM_TOOL_ID,
    label: '腕の設定',
    cursor: 'crosshair',
    onPointerDown(e) {
      dragging = false;
      start = null;
      const env = slot.get();
      if (e.button !== 0 || !config || !env) return;
      try {
        const model = env.services.store.get().model,
          rig = model.armRigs?.find((r) => r.id === config!.rigId),
          values = env.services.editor.get().editorParamValues;
        const joints =
          rig && config.handle === 'preview'
            ? forwardArmInModel(rig, {
                shoulder: values[rig.parameters.shoulder] ?? rig.restPose.shoulder,
                elbow: values[rig.parameters.elbow] ?? rig.restPose.elbow,
                wrist: values[rig.parameters.wrist] ?? rig.restPose.wrist,
              })
            : config.joints;
        const point = transformVec(
          armParentTransform(model, config.parentId),
          joints[config.handle === 'preview' ? 'wrist' : config.handle],
        );
        if (Math.hypot(point.x - e.canvasPoint.x, point.y - e.canvasPoint.y) * Math.abs(env.view().scale) > 10) return;
        start = { ...e.screenPoint };
      } catch (error) {
        config.onError(error instanceof Error ? error.message : String(error));
      }
    },
    onPointerMove: move,
    onPointerUp() {
      dragging = false;
      start = null;
    },
    onKeyDown(e) {
      if (e.key === 'Escape') {
        dragging = false;
        start = null;
      }
    },
    drawOverlay(ctx, view) {
      const env = slot.get();
      if (!env || !config) return;
      try {
        const model = env.services.store.get().model,
          parent = armParentTransform(model, config.parentId);
        const rig = model.armRigs?.find((r) => r.id === config!.rigId),
          values = env.services.editor.get().editorParamValues;
        const joints =
          rig && config.handle === 'preview'
            ? forwardArmInModel(rig, {
                shoulder: values[rig.parameters.shoulder] ?? rig.restPose.shoulder,
                elbow: values[rig.parameters.elbow] ?? rig.restPose.elbow,
                wrist: values[rig.parameters.wrist] ?? rig.restPose.wrist,
              })
            : config.joints;
        const points = (['shoulder', 'elbow', 'wrist'] as const).map((k) => {
          const p = transformVec(parent, joints[k]);
          return { x: p.x * view.scale + view.offset.x, y: p.y * view.scale + view.offset.y };
        });
        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = config.side === 'L' ? '#28aaa4' : '#a080e0';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
        points.forEach((p, i) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = '12px sans-serif';
          ctx.fillText(['肩', '肘', '手首'][i]!, p.x + 9, p.y - 8);
        });
        ctx.restore();
      } catch {
        /* 不適合な親はパネルに診断する */
      }
    },
  };
  return {
    tool,
    configure(next: ArmToolConfig) {
      config = next;
      slot.get()?.requestRedraw();
    },
    reference: armReferenceFromJoints,
  };
}
export type ArmEditor = ReturnType<typeof createArmEditor>;
