import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeServices } from '../../../services';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { register as registerStructure } from '../structure';
import { register } from './index';
import { physicsProject } from './testModel';
import { PHYSICS_PRESETS } from './presets';
import { simulateSwayPreview } from './preview';

afterEach(cleanup);
describe('物理の画面', () => {
  it('揺らす・4種類のプリセット・強さの変更を保存し、Undoで戻す', async () => {
    registry.reset();
    registerStructure();
    register();
    const services = {
      ...createFakeServices(),
      createRenderer: () => ({ init() {}, setTextures() {}, render() {}, dispose() {} }),
    };
    services.store.load(physicsProject());
    services.editor.set({ selectedPartIds: ['hair'] });
    render(<Shell services={services} environment={createEnvironmentStore(memoryEnvironmentStorage(null))} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: '軸で揺らす' }));
    const enabled = services.store.get();
    expect(enabled.physics).toHaveLength(1);
    expect(enabled.model.parameters.some((p) => p.id === 'Sway_hair')).toBe(true);
    for (const [label, preset] of [
      ['布', 'cloth'],
      ['リボン', 'ribbon'],
      ['アクセサリ', 'accessory'],
      ['髪', 'hair'],
    ] as const) {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: label }));
      });
      expect(services.store.get().physics[0]).toMatchObject({ preset, ...PHYSICS_PRESETS[preset] });
    }
    const slider = screen.getByRole('slider', { name: '揺れ方' });
    fireEvent.change(slider, { target: { value: '0.8' } });
    fireEvent.blur(slider);
    expect(services.store.get().physics[0]!.strength).toBe(0.8);
    act(() => services.store.undo());
    expect(services.store.get().physics[0]!.strength).toBe(0.5);
    const preview = simulateSwayPreview(services.store.get(), enabled.physics[0]!.id)!;
    expect(preview.frames.some((f) => Math.abs(f.Sway_hair ?? 0) > 0.01)).toBe(true);
    const saved = { FaceAngleX: 8 };
    act(() => services.editor.set({ editorParamValues: saved }));
    fireEvent.click(screen.getByRole('button', { name: '揺れを試す' }));
    expect(services.editor.get().editorParamValues).not.toBe(saved);
    act(() => services.editor.set({ selectedPartIds: ['plain'] }));
    expect(services.editor.get().editorParamValues).toBe(saved);
    act(() => services.editor.set({ selectedPartIds: ['hair'] }));
    fireEvent.click(screen.getByRole('checkbox', { name: '軸で揺らす' }));
    expect(services.store.get().physics).toEqual([]);
    act(() => services.store.undo());
    expect(services.store.get().physics).toHaveLength(1);
  });
});
