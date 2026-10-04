import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject, ensureStandardParameters } from '@app/schema';
import { createFakeServices } from '../../../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../../../shell/environment';
import { registry } from '../../../shell/registry';
import { Shell } from '../../../shell/Shell';
import { registerVowelCommand, STANDARD_VOWELS } from './commands';
import { register } from './index';

afterEach(cleanup);
describe('母音の形の登録', () => {
  it('標準6形を作り、スライダーの値を登録し、各操作をUndoできる', async () => {
    registry.reset();
    register();
    const services = {
      ...createFakeServices(),
      createRenderer: () => ({ init() {}, setTextures() {}, render() {}, dispose() {} }),
    };
    const p = createEmptyProject('母音');
    services.store.load({ ...p, model: ensureStandardParameters(p.model, 'step2') });
    render(<Shell services={services} environment={createEnvironmentStore(memoryEnvironmentStorage(null))} />);
    fireEvent.click(await screen.findByRole('button', { name: '標準の形で作る' }));
    expect(services.store.get().model.lipSync.vowels).toEqual(STANDARD_VOWELS);
    fireEvent.change(screen.getByRole('combobox', { name: '母音' }), { target: { value: 'i' } });
    expect(services.editor.get().editorParamValues.MouthWidth).toBe(1);
    const slider = screen.getAllByRole('slider')[0]!;
    fireEvent.change(slider, { target: { value: '0.55' } });
    fireEvent.click(screen.getByRole('button', { name: 'この形を登録' }));
    expect(services.store.get().model.lipSync.vowels.find((v) => v.vowel === 'i')?.values.MouthOpen).toBe(0.55);
    act(() => services.store.undo());
    expect(services.store.get().model.lipSync.vowels).toEqual(STANDARD_VOWELS);
    act(() => services.store.undo());
    expect(services.store.get().model.lipSync.vowels).toEqual([]);
    act(() => services.store.redo());
    expect(services.store.get().model.lipSync.vowels).toHaveLength(6);
  });
  it('口以外は登録せず、範囲外や不正値を補正して元のプロジェクトを変えない', () => {
    const p = createEmptyProject('母音');
    const project = { ...p, model: ensureStandardParameters(p.model, 'step2') };
    const out = registerVowelCommand('a', { FaceAngleX: 10, MouthOpen: 3, MouthForm: NaN, MouthWidth: -3 }).apply(
      project,
    );
    expect(out.model.lipSync.vowels).toEqual([{ vowel: 'a', values: { MouthOpen: 1, MouthForm: 0, MouthWidth: -1 } }]);
    expect(project.model.lipSync.vowels).toEqual([]);
  });
});
