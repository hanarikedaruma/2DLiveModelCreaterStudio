// カード99追補 / CO: 軸揺れを設定した本人の目印。親からの誤継承と履歴・再読込での取り残しを防ぐ。
import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { curveMeshSignature } from '@app/core';
import { validateProject, type Project } from '@app/schema';
import { registry } from '../../../shell/registry';
import { register as registerAssets } from '../assets';
import { renderShell, testServices } from '../assets/testShell';
import { disablePhysicsCommand, enablePhysicsCommand } from '../physics/commands';
import { register as registerStructure } from './index';
import { makeMesh, makePart, makeProject } from './testing';

beforeEach(() => {
  registry.reset();
  registerAssets();
  registerStructure();
});

function project() {
  return makeProject({
    parts: [
      makePart('head', { kind: 'group', name: '頭' }),
      makePart('hair', { name: '長い髪', parentId: 'head', meshId: 'm' }),
      makePart('plain', { name: '飾り', parentId: 'head' }),
    ],
    meshes: [makeMesh('m')],
  });
}

const enable = (id: string) =>
  enablePhysicsCommand(id, { physics: `ph-${id}`, transform: `bt-${id}`, vertices: `bv-${id}` });
const row = (id: string) => document.querySelector<HTMLElement>(`[role="tree"] [data-part-id="${id}"]`)!;
const badge = (id: string) => within(row(id)).queryByRole('img', { name: /軸揺れ：ON/ });

function setup(initial: Project = project()) {
  const services = testServices();
  services.store.load(initial);
  renderShell(services);
  return services;
}

describe('軸揺れの振り子の目印', () => {
  it('設定した本人だけに出し、グループの子へ継承しない', () => {
    const services = setup();
    expect(screen.queryAllByRole('img', { name: /軸揺れ：ON/ })).toHaveLength(0);
    act(() => services.store.dispatch(enable('head')));
    expect(badge('head')?.getAttribute('title')).toBe('頭：軸揺れ：ON');
    expect(badge('hair')).toBeNull();
    expect(badge('plain')).toBeNull();
    act(() => services.store.dispatch(enable('hair')));
    expect(badge('hair')?.getAttribute('aria-label')).toBe('長い髪：軸揺れ：ON');
    expect(screen.getAllByRole('img', { name: /軸揺れ：ON/ })).toHaveLength(2);
    expect(badge('plain')).toBeNull();
  });

  it('OFF・Undo・Redo・保存して再読込でも対象の表示だけが変わる', () => {
    const services = setup(enable('hair').apply(enable('head').apply(project())));
    act(() => services.store.dispatch(disablePhysicsCommand('hair')));
    expect(badge('hair')).toBeNull();
    expect(badge('head')).toBeTruthy();
    act(() => services.store.undo());
    expect(badge('hair')).toBeTruthy();
    act(() => services.store.redo());
    expect(badge('hair')).toBeNull();
    act(() => services.store.undo());
    const saved = validateProject(JSON.parse(JSON.stringify(services.store.get())));
    act(() => services.store.load(project()));
    expect(screen.queryAllByRole('img', { name: /軸揺れ：ON/ })).toHaveLength(0);
    act(() => services.store.load(saved));
    expect(badge('hair')).toBeTruthy();
    expect(badge('head')).toBeTruthy();
  });

  it('再生中の値や表示・ロックの変更で目印を消さず、押しても揺れ設定を変更しない', () => {
    const services = setup(enable('hair').apply(project()));
    const physics = services.store.get().physics;
    act(() => services.editor.set({ editorParamValues: { Sway_hair: 0.8 } }));
    fireEvent.click(badge('hair')!);
    expect(services.editor.get().selectedPartIds).toEqual(['hair']);
    expect(services.store.get().physics).toBe(physics);
    fireEvent.click(within(row('hair')).getByRole('button', { name: /表示中/ }));
    fireEvent.click(within(row('hair')).getByRole('button', { name: 'ロック' }));
    expect(badge('hair')).toBeTruthy();
    expect(services.store.get().physics).toBe(physics);
    fireEvent.doubleClick(row('hair'));
    fireEvent.change(screen.getByLabelText('パーツの名前'), { target: { value: '揺れる髪' } });
    fireEvent.keyDown(screen.getByLabelText('パーツの名前'), { key: 'Enter' });
    expect(badge('hair')?.getAttribute('title')).toBe('揺れる髪：軸揺れ：ON');
  });

  it('描画順の一覧にも同じ目印を出し、一覧の切替で設定を変えない', () => {
    const services = setup(enable('hair').apply(project()));
    const initial = services.store.get();
    fireEvent.click(screen.getByRole('tab', { name: '描画順' }));
    const order = screen.getByRole('listbox', { name: '描画順' });
    expect(within(order).getAllByRole('img', { name: /軸揺れ：ON/ })).toHaveLength(1);
    expect(within(order).getByRole('img', { name: '長い髪：軸揺れ：ON' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'パーツ構造' }));
    expect(badge('hair')).toBeTruthy();
    expect(services.store.get()).toBe(initial);
  });

  it('物理設定のpartIdで既存データを判定し、切れたphysicsIdや静的な重力線には出さない', () => {
    const initial = enable('head').apply(project());
    initial.model.parts = initial.model.parts.map((part) => ({
      ...part,
      physicsId: part.id === 'hair' ? 'missing' : null,
    }));
    const points = [
      { x: 1, y: 1 },
      { x: 1, y: 3 },
      { x: 1, y: 5 },
    ] as const;
    initial.model.curveGuides = [
      {
        id: 'guide',
        partId: 'hair',
        meshId: 'm',
        meshSignature: curveMeshSignature(initial.model.meshes[0]!),
        reference: [...points],
        points: [...points],
        radius: 10,
        rootFraction: 0.2,
        gravity: true,
        enabled: true,
      },
    ];
    setup(initial);
    expect(badge('head')).toBeTruthy();
    expect(badge('hair')).toBeNull();
    expect(screen.queryByRole('img', { name: /流れ揺れ/ })).toBeNull();
  });
});
