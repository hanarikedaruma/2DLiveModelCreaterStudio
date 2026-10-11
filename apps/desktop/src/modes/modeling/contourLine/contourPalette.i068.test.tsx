import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Mesh, Project, Vec2 } from '@app/schema';
import { registry } from '../../../shell/registry';
import { register as registerCanvasEdit } from '../canvas';
import { renderShell, stubSize } from '../canvas/testUtils';
import { makeAsset, makePart, makeProject } from '../structure/testing';
import { contourEditor, register } from './index';

function gridMesh(id: string): Mesh {
  const vertices: Vec2[] = [];
  const uvs: Vec2[] = [];
  for (let r = 0; r <= 10; r++)
    for (let c = 0; c <= 10; c++) {
      vertices.push({ x: 100 + c * 20, y: 100 + r * 20 });
      uvs.push({ x: c / 10, y: r / 10 });
    }
  const triangles: Mesh['triangles'] = [];
  for (let r = 0; r < 10; r++)
    for (let c = 0; c < 10; c++) {
      const a = r * 11 + c;
      triangles.push([a, a + 1, a + 11], [a + 1, a + 12, a + 11]);
    }
  return { id, vertices, uvs, triangles, density: 'custom', edited: false };
}

function project(): Project {
  const asset = (id: string) => makeAsset(id, { width: 200, height: 200, offset: { x: 100, y: 100 } });
  const p = makeProject({
    assets: [asset('face'), asset('art')],
    parts: [
      makePart('face', { assetId: 'face', meshId: 'm-face', name: '顔' }),
      makePart('art', { assetId: 'art', meshId: 'm-art', name: '輪郭の線画' }),
    ],
    meshes: [gridMesh('m-face'), gridMesh('m-art')],
  });
  p.model.contourLines = [
    {
      id: 'line',
      partId: 'face',
      name: 'あご 右',
      points: [0.1, 0.3, 0.5, 0.7, 0.9].map((y) => ({ x: 0.25, y })),
      radius: 40,
      withPartIds: [],
    },
  ];
  return p;
}

let restoreSize: () => void = () => {};
beforeEach(() => {
  registry.reset();
  registerCanvasEdit();
  register();
  restoreSize = stubSize(800, 600);
});
afterEach(() => restoreSize());

async function open() {
  const shell = renderShell();
  const p = project();
  act(() => shell.services.store.load(p));
  await waitFor(() => expect(shell.canvas.lastDeformed()?.items.length).toBe(2));
  const panel = () => document.querySelector<HTMLElement>('[data-panel-id="contourLine"]');
  return { ...shell, panel };
}

describe('I-068: 輪郭線のパレット', () => {
  it('輪郭線で整えるツールのときだけ、右の列の上に出る', async () => {
    const s = await open();
    expect(s.panel()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '輪郭線で整える' }));
    await waitFor(() => expect(s.panel()).not.toBeNull());
    expect(within(s.panel()!).getByText(/輪郭線を引く画像パーツを/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '選択・変形' }));
    await waitFor(() => expect(s.panel()).toBeNull());
  });

  it('パーツを選ぶと線の一覧・影響幅・一緒に動かすパーツの候補・頂点の間隔が出る', async () => {
    const s = await open();
    act(() => s.services.editor.set({ selectedPartIds: ['face'] }));
    fireEvent.click(screen.getByRole('button', { name: '輪郭線で整える' }));
    await waitFor(() => expect(s.panel()).not.toBeNull());
    const panel = within(s.panel()!);
    expect(panel.getByText('顔')).toBeTruthy();
    expect((panel.getByRole('combobox', { name: '輪郭線' }) as HTMLSelectElement).value).toBe('line');
    expect(panel.getByRole('option', { name: 'あご 右（点 5）' })).toBeTruthy();
    expect(panel.getByText('40px')).toBeTruthy();
    expect(panel.getByTestId('contour-spacing').textContent).toMatch(/線の上に頂点が無い/);
    // 影響幅にかかる「輪郭の線画」が候補に出て、チェックで一緒に動かすパーツになる
    fireEvent.click(panel.getByRole('checkbox', { name: '輪郭の線画' }));
    expect(s.services.store.get().model.contourLines![0]!.withPartIds).toEqual(['art']);
    // ［線を引く］で引く段になり、案内が出る
    fireEvent.click(panel.getByRole('button', { name: '線を引く' }));
    expect(contourEditor.state.get().drawing).toBe(true);
    expect(panel.getByText(/輪郭をなぞる（ドラッグ）/)).toBeTruthy();
  });
});
