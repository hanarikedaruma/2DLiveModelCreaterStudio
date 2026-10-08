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
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { validateProject } from '@app/schema';

afterEach(cleanup);
describe('物理の画面', () => {
  it('胸の目印・2出力・固定範囲・重力・お試し・失効の理由を表示する', async () => {
    registry.reset();
    registerStructure();
    register();
    const services = {
      ...createFakeServices(),
      createRenderer: () => ({ init() {}, setTextures() {}, render() {}, dispose() {} }),
    };
    const p = validateProject(
      JSON.parse(
        readFileSync(new NodeURL('../../../../../../fixtures/chest-model/project.json', import.meta.url), 'utf8'),
      ),
    );
    services.store.load(p);
    services.editor.set({ selectedPartIds: ['chest'] });
    render(<Shell services={services} environment={createEnvironmentStore(memoryEnvironmentStorage(null))} />);
    expect(((await screen.findByRole('checkbox', { name: '胸を揺らす' })) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText('胸：胸揺れ：ON')).toBeTruthy();
    expect(screen.queryByLabelText('胸：軸揺れ：ON')).toBeNull();
    expect(screen.getByLabelText('揺れパラメータ').textContent).toContain('胸揺れ 左右');
    expect(screen.getByLabelText('揺れパラメータ').textContent).toContain('胸揺れ 上下');
    fireEvent.click(screen.getByRole('button', { name: '物理の数値' }));
    expect((screen.getByRole('spinbutton', { name: '胸の重力の強さ' }) as HTMLInputElement).value).toBe('0.3');
    fireEvent.click(screen.getByRole('button', { name: '胸の固定範囲' }));
    expect(screen.getByRole('img', { name: '胸の固定点（白丸）と揺れる点（黒丸）' })).toBeTruthy();
    const saved = { BodyAngleZ: 30 };
    act(() => services.editor.set({ editorParamValues: saved }));
    fireEvent.click(screen.getByRole('button', { name: '上下を試す' }));
    expect(screen.getByRole('button', { name: '止める' })).toBeTruthy();
    act(() => services.editor.set({ selectedPartIds: ['torso'] }));
    expect(services.editor.get().editorParamValues).toBe(saved);
    act(() => {
      services.editor.set({ selectedPartIds: ['chest'] });
      services.store.dispatch({
        label: 'メッシュ編集',
        apply: (p) => ({
          ...p,
          model: {
            ...p.model,
            meshes: p.model.meshes.map((m) =>
              m.id === 'mesh-chest'
                ? { ...m, vertices: m.vertices.map((v, i) => (i === 40 ? { ...v, x: v.x + 1 } : v)) }
                : m,
            ),
          },
        }),
      });
    });
    expect((await screen.findByRole('alert')).textContent).toContain('メッシュが変わりました');
  });
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
