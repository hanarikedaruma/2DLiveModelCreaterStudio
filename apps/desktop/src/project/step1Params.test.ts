import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyProject,
  standardParametersFor,
  STANDARD_PARAMETER_PHASES,
  type Parameter,
  type Project,
} from '@app/schema';
import { MemoryFileSystem, type Services } from '@app/contracts';
import { createProjectStore } from '@app/core';
import { createProjectIO } from '@app/io';
import { createFakeServices } from '../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from '../shell/environment';
import { emitAppEvent } from '../shell/events';
import { createProjectActions, PROJECT_LOADED } from './actions';
import { applyStep1Parameters, connectStep1Params, withStep1Parameters } from './step1Params';

const STEP1_IDS = [
  'EyeSmileL',
  'EyeSmileR',
  'BrowYL',
  'BrowYR',
  'BrowFormL',
  'BrowFormR',
  'MouthForm',
  'MouthWidth',
  'Cheek',
  'BodyAngleX',
  'BodyAngleY',
  'BodyAngleZ',
];

const tail: Parameter = { id: 'tail', name: 'しっぽ', groupId: 'other', min: -1, max: 1, default: 0, standard: false };

// MVP の標準パラメータだけのプロジェクト（顔・目・口のグループだけ）
function mvpProject(): Project {
  const p = createEmptyProject('MVP のプロジェクト');
  return {
    ...p,
    model: {
      ...p.model,
      parameters: [...p.model.parameters, tail],
      parameterGroups: p.model.parameterGroups.filter((g) => ['face', 'eye', 'mouth', 'other'].includes(g.id)),
    },
  };
}

let offs: (() => void)[] = [];
afterEach(() => {
  for (const off of offs) off();
  offs = [];
});

describe('STEP1 の標準パラメータを足す', () => {
  it('足りないものだけを表の順に末尾へ足し、足したパラメータのグループも足す', () => {
    const before = mvpProject();
    const after = withStep1Parameters(before);
    const ids = after.model.parameters.map((p) => p.id);
    expect(ids).toEqual([...before.model.parameters.map((p) => p.id), ...STEP1_IDS]);
    expect(STEP1_IDS.every((id) => STANDARD_PARAMETER_PHASES[id] === 'step1')).toBe(true);
    // 表のとおりの値（standard: true）
    for (const p of standardParametersFor('step1')) {
      expect(after.model.parameters.find((x) => x.id === p.id)).toEqual(p);
    }
    expect(after.model.parameterGroups.map((g) => g.id)).toEqual([
      'face',
      'eye',
      'mouth',
      'other',
      'brow',
      'cheek',
      'body',
    ]);
    // STEP2 のものは足さない。ユーザー定義はそのまま
    expect(ids).not.toContain('Breath');
    expect(after.model.parameters.find((p) => p.id === 'tail')).toBe(tail);
    expect(before.model.parameters).toHaveLength(9); // 元は変えない
  });

  it('すでにそろっていれば同じ参照を返す。名前などを変えた標準パラメータは上書きしない', () => {
    const once = withStep1Parameters(mvpProject());
    expect(withStep1Parameters(once)).toBe(once);
    const renamed = {
      ...once,
      model: {
        ...once.model,
        parameters: once.model.parameters.map((p) => (p.id === 'Cheek' ? { ...p, name: 'ほお' } : p)),
      },
    };
    expect(withStep1Parameters(renamed)).toBe(renamed);
  });

  it('ストアは履歴に積まずに置き換える（足すものが無ければ何もしない）', () => {
    const store = createProjectStore(mvpProject());
    store.dispatch({ label: '名前', apply: (p) => ({ ...p, name: '変えた' }) });
    expect(applyStep1Parameters(store)).toBe(true);
    expect(store.get().name).toBe('変えた');
    expect(store.get().model.parameters.map((p) => p.id)).toEqual(expect.arrayContaining(STEP1_IDS));
    expect(store.canUndo()).toBe(false);
    const current = store.get();
    expect(applyStep1Parameters(store)).toBe(false);
    expect(store.get()).toBe(current);
  });
});

describe('projectLoaded でつなぐ', () => {
  it('つないだときのプロジェクトに足し、以後は projectLoaded のたびに足す。外したら足さない', () => {
    const store = createProjectStore(createEmptyProject('起動時'));
    const off = connectStep1Params(store);
    offs.push(off);
    expect(store.get().model.parameters.some((p) => p.id === 'BodyAngleZ')).toBe(true);

    store.load(mvpProject());
    expect(store.get().model.parameters.some((p) => p.id === 'Cheek')).toBe(false);
    emitAppEvent(PROJECT_LOADED, store.get());
    expect(store.get().model.parameters.map((p) => p.id)).toEqual(expect.arrayContaining(STEP1_IDS));
    expect(store.canUndo()).toBe(false);

    off();
    store.load(mvpProject());
    emitAppEvent(PROJECT_LOADED, store.get());
    expect(store.get().model.parameters.some((p) => p.id === 'Cheek')).toBe(false);
  });
});

describe('開く・新規の流れ（カード23 の ProjectActions）', () => {
  function setup(fs = new MemoryFileSystem()) {
    const base = createFakeServices();
    const services: Services = { ...base, fs, io: createProjectIO(fs) };
    offs.push(connectStep1Params(services.store));
    const dialogs = { confirm: vi.fn(async () => true), prompt: vi.fn(async () => '新しい'), notify: vi.fn() };
    const actions = createProjectActions({
      services,
      environment: createEnvironmentStore(memoryEnvironmentStorage()),
      dialogs,
      platform: { pickFolder: async () => null, unsavedRoot: async () => '/appdata/unsaved' },
    });
    return { services, actions, dialogs, fs };
  }

  const hasStep1 = (s: Services) => STEP1_IDS.every((id) => s.store.get().model.parameters.some((p) => p.id === id));

  it('起動したときのプロジェクトにも足し、変更ありにはしない', () => {
    const { services, actions } = setup();
    expect(hasStep1(services)).toBe(true);
    expect(actions.isDirty()).toBe(false);
  });

  it('MVP のプロジェクトを開くと足され、変更ありにも Undo の対象にもならない', async () => {
    const fs = new MemoryFileSystem();
    await createProjectIO(fs).save('/work/mvp', mvpProject(), {});
    const { services, actions, dialogs } = setup(fs);
    await actions.open('/work/mvp');
    expect(services.store.get().name).toBe('MVP のプロジェクト');
    expect(hasStep1(services)).toBe(true);
    expect(actions.isDirty()).toBe(false);
    expect(services.store.canUndo()).toBe(false);
    // 開き直すときに「保存していない変更」を聞かない
    await actions.open('/work/mvp');
    expect(dialogs.confirm).not.toHaveBeenCalled();
  });

  it('新規のプロジェクトにも足す', async () => {
    const { services, actions } = setup();
    await actions.newProject();
    expect(services.store.get().name).toBe('新しい');
    expect(hasStep1(services)).toBe(true);
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
