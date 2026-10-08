import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import type { DeformedModel, ParamValues } from '@app/contracts';
import { validateProject } from '@app/schema';
import { chestStaticParams, createBindingEvaluator, createDeformPipeline } from '@app/core';
import { createFakeServices } from '../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../shell/environment';
import { ShellContext } from '../../shell/context';
import { createCanvasController } from '../../shell/canvas/controller';
import { createDialogController } from '../../shell/dialogs';
import { AnimationPreview } from './Preview';
import { animationEditor } from './state';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  animationEditor.reset();
});
describe('胸のアニメーション評価', () => {
  it('慣性を再生し、同じフレーム・シーク・停止・ループで状態を適切に初期化する', () => {
    const project = validateProject(
      JSON.parse(
        readFileSync(new NodeURL('../../../../../fixtures/chest-model/project.json', import.meta.url), 'utf8'),
      ),
    );
    const rendered: DeformedModel[] = [];
    const services = {
      ...createFakeServices(),
      evaluator: createBindingEvaluator(),
      pipeline: createDeformPipeline(),
      createRenderer: () => ({
        init() {},
        setTextures() {},
        render(m: DeformedModel) {
          rendered.push(m);
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
    animationEditor.set({ animationId: 'chest-demo', playback: 'once' });
    const view = (values: ParamValues) => (
      <ShellContext.Provider value={context}>
        <AnimationPreview values={values} />
      </ShellContext.Provider>
    );
    const screen = render(view({ BodyAngleZ: 30, MoveY: 0 }));
    const positions = (m: DeformedModel) => m.byPartId.chest!.positions;
    const staticFrame = (values: ParamValues) =>
      services.pipeline.deform(
        project.model,
        services.evaluator.evaluate(project.model, chestStaticParams(project, values)),
      );
    expect(positions(rendered.at(-1)!)).toEqual(positions(staticFrame({ BodyAngleZ: 30, MoveY: 0 })));
    for (let i = 1; i <= 20; i++) {
      now = (i * 1000) / 60;
      act(() => animationEditor.advance(i / 60));
      screen.rerender(view({ BodyAngleZ: 30, MoveY: (-i * i) / 50 }));
    }
    const last = positions(rendered.at(-1)!);
    expect(last).not.toEqual(positions(staticFrame({ BodyAngleZ: 30, MoveY: -8 })));
    now += 5;
    screen.rerender(view({ BodyAngleZ: 30, MoveY: -8 }));
    expect(positions(rendered.at(-1)!)).toEqual(last);
    now += 10;
    act(() => animationEditor.set({ time: 0.1 }));
    expect(positions(rendered.at(-1)!)).toEqual(positions(staticFrame({ BodyAngleZ: 30, MoveY: -8 })));
    act(() => animationEditor.set({ playback: 'stopped' }));
    expect(positions(rendered.at(-1)!)).toEqual(positions(staticFrame({ BodyAngleZ: 30, MoveY: -8 })));
    act(() => animationEditor.set({ playback: 'loop', time: 0 }));
    expect(positions(rendered.at(-1)!)).toEqual(positions(staticFrame({ BodyAngleZ: 30, MoveY: -8 })));
    const manual = structuredClone(project);
    manual.animations[0]!.tracks.push({ parameterId: 'BustY', keyframes: [{ time: 0, value: 0.7, curve: 'linear' }] });
    act(() => services.store.load(manual));
    screen.rerender(view({ BustX: 0.2, BustY: 0.7 }));
    expect(positions(rendered.at(-1)!)).toEqual(
      positions(
        services.pipeline.deform(manual.model, services.evaluator.evaluate(manual.model, { BustX: 0.2, BustY: 0.7 })),
      ),
    );
  });
});
