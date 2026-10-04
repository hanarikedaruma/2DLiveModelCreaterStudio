import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyProject,
  ensureStandardParameters,
  standardParametersFor,
  STANDARD_PARAMETER_PHASES,
  type Parameter,
  type Project,
} from '@app/schema';
import { MemoryFileSystem, type Services } from '@app/contracts';
import { createProjectStore } from '@app/core';
import { createProjectIO } from '@app/io';
import { resultLabel } from '../modes/modeling/parameters/labels';
import { createFakeServices } from '../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../shell/environment';
import { emitAppEvent } from '../shell/events';
import { createProjectActions, PROJECT_LOADED } from './actions';
import { registerProject } from './index';
import { connectStep1Params } from './step1Params';
import { applyStep2Parameters, connectStep2Params, withStep2Parameters } from './step2Params';

const STEP2_IDS = ['Breath', 'ArmL', 'ArmR', 'HairFront', 'HairSide', 'HairBack'];

const tail: Parameter = { id: 'tail', name: 'しっぽ', groupId: 'other', min: -1, max: 1, default: 0, standard: false };

// STEP1 までの標準パラメータのプロジェクト（腕・揺れもののグループは無い）
function step1Project(): Project {
  const p = createEmptyProject('STEP1 のプロジェクト');
  const model = ensureStandardParameters(p.model, 'step1');
  return {
    ...p,
    model: {
      ...model,
      parameters: [...model.parameters, tail],
      parameterGroups: model.parameterGroups.filter((g) => !['armL', 'armR', 'sway'].includes(g.id)),
    },
  };
}
// MVP の標準パラメータだけのプロジェクト（顔・目・口・その他のグループだけ）
function mvpProject(): Project {
  const p = createEmptyProject('MVP のプロジェクト');
  return {
    ...p,
    model: {
      ...p.model,
      parameterGroups: p.model.parameterGroups.filter((g) => ['face', 'eye', 'mouth', 'other'].includes(g.id)),
    },
  };
}
const ids = (p: Project) => p.model.parameters.map((q) => q.id);
const hasStep2 = (p: Project) => STEP2_IDS.every((id) => ids(p).includes(id));

let offs: (() => void)[] = [];
afterEach(() => {
  for (const off of offs) off();
  offs = [];
});

describe('STEP2 の標準パラメータを足す', () => {
  it('足りないものだけを表の順に末尾へ足し、足したパラメータのグループも足す', () => {
    const before = step1Project();
    const after = withStep2Parameters(before);
    expect(ids(after)).toEqual([...ids(before), ...STEP2_IDS]);
    expect(STEP2_IDS.every((id) => STANDARD_PARAMETER_PHASES[id] === 'step2')).toBe(true);
    // 表のとおりの値（standard: true）。呼吸は体、腕は左腕・右腕、髪揺れは揺れもののグループ
    for (const p of standardParametersFor('step2')) {
      expect(after.model.parameters.find((x) => x.id === p.id)).toEqual(p);
    }
    expect(after.model.parameters.find((x) => x.id === 'Breath')).toMatchObject({ groupId: 'body', min: 0, max: 1 });
    expect(after.model.parameterGroups.map((g) => g.id).slice(-3)).toEqual(['armL', 'armR', 'sway']);
    // ユーザー定義はそのまま。元は変えない
    expect(after.model.parameters.find((p) => p.id === 'tail')).toBe(tail);
    expect(before.model.parameters).toHaveLength(21);
  });

  it('MVP だけのプロジェクトには STEP1 と STEP2 の標準パラメータを表の順に足す', () => {
    const after = withStep2Parameters(mvpProject());
    expect(ids(after)).toEqual(standardParametersFor('step2').map((p) => p.id));
    expect(after.model.parameterGroups.map((g) => g.id)).toEqual([
      'face',
      'eye',
      'mouth',
      'other',
      'brow',
      'cheek',
      'body',
      'armL',
      'armR',
      'sway',
    ]);
  });

  it('すでにそろっていれば同じ参照を返す。名前などを変えた標準パラメータは上書きしない', () => {
    const once = withStep2Parameters(step1Project());
    expect(withStep2Parameters(once)).toBe(once);
    const renamed = {
      ...once,
      model: {
        ...once.model,
        parameters: once.model.parameters.map((p) => (p.id === 'Breath' ? { ...p, name: 'いき' } : p)),
      },
    };
    expect(withStep2Parameters(renamed)).toBe(renamed);
  });

  it('ストアは履歴に積まずに置き換える（足すものが無ければ何もしない）', () => {
    const store = createProjectStore(step1Project());
    store.dispatch({ label: '名前', apply: (p) => ({ ...p, name: '変えた' }) });
    expect(applyStep2Parameters(store)).toBe(true);
    expect(store.get().name).toBe('変えた');
    expect(hasStep2(store.get())).toBe(true);
    expect(store.canUndo()).toBe(false);
    const current = store.get();
    expect(applyStep2Parameters(store)).toBe(false);
    expect(store.get()).toBe(current);
  });

  it('足したパラメータはパネルで結果の言葉付きで出る（呼吸・腕）', () => {
    const p = withStep2Parameters(step1Project());
    const at = (id: string, value: number) =>
      resultLabel(
        p.model.parameters.find((q) => q.id === id)!,
        value,
      );
    expect([at('Breath', 0), at('Breath', 1)]).toEqual(['吐く（0）', '吸う（1）']);
    expect([at('ArmL', -1), at('ArmL', 0), at('ArmL', 1)]).toEqual(['内へ（-1）', '–（0）', '上げる（+1）']);
    expect([at('ArmR', -1), at('ArmR', 1)]).toEqual(['内へ（-1）', '上げる（+1）']);
  });
});

describe('projectLoaded でつなぐ', () => {
  it('つないだときのプロジェクトに足し、以後は projectLoaded のたびに足す。外したら足さない', () => {
    const store = createProjectStore(createEmptyProject('起動時'));
    const off = connectStep2Params(store);
    offs.push(off);
    expect(hasStep2(store.get())).toBe(true);

    store.load(step1Project());
    expect(ids(store.get())).not.toContain('Breath');
    emitAppEvent(PROJECT_LOADED, store.get());
    expect(hasStep2(store.get())).toBe(true);
    expect(store.canUndo()).toBe(false);

    off();
    store.load(step1Project());
    emitAppEvent(PROJECT_LOADED, store.get());
    expect(ids(store.get())).not.toContain('Breath');
  });

  it('registerProject がつなぐ（起動時のプロジェクトに STEP1 と STEP2 の標準パラメータが表の順に並ぶ）', () => {
    const services = createFakeServices();
    services.store.load(mvpProject());
    const dialogs = { confirm: vi.fn(async () => true), prompt: vi.fn(async () => null), notify: vi.fn() };
    const actions = registerProject(services, createEnvironmentStore(memoryEnvironmentStorage()), dialogs);
    expect(ids(services.store.get())).toEqual(standardParametersFor('step2').map((p) => p.id));
    expect(actions.isDirty()).toBe(false);
    services.store.load(step1Project());
    emitAppEvent(PROJECT_LOADED, services.store.get());
    expect(hasStep2(services.store.get())).toBe(true);
  });
});

describe('開く・新規の流れ（カード23 の ProjectActions。STEP1 と同じつなぎ方）', () => {
  function setup(fs = new MemoryFileSystem()) {
    const base = createFakeServices();
    const services: Services = { ...base, fs, io: createProjectIO(fs) };
    // project/index.ts の registerProject と同じ順でつなぐ
    offs.push(connectStep1Params(services.store), connectStep2Params(services.store));
    const dialogs = { confirm: vi.fn(async () => true), prompt: vi.fn(async () => '新しい'), notify: vi.fn() };
    const actions = createProjectActions({
      services,
      environment: createEnvironmentStore(memoryEnvironmentStorage()),
      dialogs,
      platform: { pickFolder: async () => null, unsavedRoot: async () => '/appdata/unsaved' },
    });
    return { services, actions, dialogs, fs };
  }

  it('起動したときのプロジェクトにも足し、変更ありにはしない', () => {
    const { services, actions } = setup();
    expect(hasStep2(services.store.get())).toBe(true);
    expect(actions.isDirty()).toBe(false);
  });

  it('MVP・STEP1 のプロジェクトを開くと足され、変更ありにも Undo の対象にもならない', async () => {
    const fs = new MemoryFileSystem();
    await createProjectIO(fs).save('/work/mvp', mvpProject(), {});
    await createProjectIO(fs).save('/work/step1', step1Project(), {});
    const { services, actions, dialogs } = setup(fs);
    await actions.open('/work/mvp');
    expect(services.store.get().name).toBe('MVP のプロジェクト');
    expect(ids(services.store.get())).toEqual(standardParametersFor('step2').map((p) => p.id));
    expect(actions.isDirty()).toBe(false);
    expect(services.store.canUndo()).toBe(false);
    await actions.open('/work/step1');
    expect(ids(services.store.get())).toEqual([...ids(step1Project()), ...STEP2_IDS]);
    expect(actions.isDirty()).toBe(false);
    expect(services.store.canUndo()).toBe(false);
    // 開き直すときに「保存していない変更」を聞かない
    await actions.open('/work/step1');
    expect(dialogs.confirm).not.toHaveBeenCalled();
  });

  it('新規のプロジェクトにも足す', async () => {
    const { services, actions } = setup();
    await actions.newProject();
    expect(services.store.get().name).toBe('新しい');
    expect(hasStep2(services.store.get())).toBe(true);
    expect(actions.isDirty()).toBe(false);
  });

  it('足したプロジェクトを保存して開き直すと、同じ内容になる', async () => {
    const { services, actions } = setup();
    await actions.saveAs('/work/p');
    const saved = services.store.get();
    await actions.open('/work/p');
    expect(services.store.get()).toEqual(saved);
    expect(actions.isDirty()).toBe(false);
  });
});
