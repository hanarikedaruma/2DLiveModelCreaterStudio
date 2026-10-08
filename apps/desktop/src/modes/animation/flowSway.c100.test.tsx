import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeformedModel } from '@app/contracts';
import type { CurveGuide } from '@app/schema';
import { createBindingEvaluator, createDeformPipeline, createHairFrameEvaluator, curveMeshSignature } from '@app/core';
import { createFakeServices } from '../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../shell/environment';
import { ShellContext } from '../../shell/context';
import { createCanvasController } from '../../shell/canvas/controller';
import { createDialogController } from '../../shell/dialogs';
import { hairProject } from '../modeling/curveGuide/testing';
import { AnimationPreview } from './Preview';
import { animationEditor } from './state';

afterEach(() => {
  vi.restoreAllMocks();
  animationEditor.reset();
});
describe('アニメーションの流れ揺れ', () => {
  it('連続再生で慣性を進め、同じ時刻の再描画は進めず、小さい手動シーク/停止/同じIDの再読込は静止形に戻す', () => {
    const project = hairProject();
    const points: CurveGuide['points'] = [
      { x: 300, y: 200 },
      { x: 300, y: 300 },
      { x: 300, y: 400 },
    ];
    project.model.curveGuides = [
      {
        id: 'g',
        partId: 'hair',
        meshId: 'm',
        meshSignature: curveMeshSignature(project.model.meshes[0]!),
        reference: points,
        points,
        radius: 70,
        rootFraction: 0.15,
        enabled: true,
        gravity: true,
        dynamics: { enabled: true, preset: 'normal', strength: 0.5, damping: 0.2 },
      },
    ];
    const rendered: DeformedModel[] = [];
    const services = {
      ...createFakeServices(),
      evaluator: createBindingEvaluator(),
      pipeline: createDeformPipeline(),
      createRenderer: () => ({
        init() {},
        setTextures() {},
        render(model: DeformedModel) {
          rendered.push(model);
        },
        dispose() {},
      }),
    };
    services.store.load(project);
    const context = {
      services,
      canvas: createCanvasController(),
      dialogs: createDialogController(),
      environment: createEnvironmentStore(memoryEnvironmentStorage(null)),
    };
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    animationEditor.reset();
    animationEditor.set({ playback: 'once' });
    const view = (angle: number) => (
      <ShellContext.Provider value={context}>
        <AnimationPreview values={{ FaceAngleZ: angle }} />
      </ShellContext.Provider>
    );
    const screen = render(view(0));
    for (let i = 1; i < 20; i++) {
      now = (i * 1000) / 60;
      act(() => animationEditor.advance(i / 60));
      screen.rerender(view(i));
    }
    expect(rendered.some((m) => m.curveGuides!.g!.dynamics!.status === 'running')).toBe(true);
    const before = rendered.at(-1)!.byPartId.hair!.positions;
    now += 5;
    screen.rerender(view(19));
    expect(rendered.at(-1)!.byPartId.hair!.positions).toEqual(before);
    now += 10;
    act(() => animationEditor.set({ time: animationEditor.get().time + 0.01 }));
    const staticFrame = createHairFrameEvaluator(services.evaluator, services.pipeline).evaluate(project, {
      FaceAngleZ: 19,
    });
    expect(rendered.at(-1)!.byPartId.hair!.positions).toEqual(staticFrame.byPartId.hair!.positions);
    act(() => animationEditor.set({ playback: 'stopped' }));
    expect(rendered.at(-1)!.byPartId.hair!.positions).toEqual(staticFrame.byPartId.hair!.positions);
    act(() => services.store.load(JSON.parse(JSON.stringify(project))));
    expect(rendered.at(-1)!.curveGuides!.g!.dynamics!.status).toBe('settled');
  });
});
