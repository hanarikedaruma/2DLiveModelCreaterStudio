// カード59（回転中心と表示の印・I-051）のテスト。テストの担当は CL（実装の担当は CO）
// パーツ一覧の目の記号: 表示中・非表示・親が非表示を見分けられ、ツールチップとアクセシブル名にパーツ名が入る
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Services } from '@app/contracts';
import { registry } from '../../../shell/registry';
import { register as registerAssets } from '../assets';
import { pngBytes, renderShell, testServices } from '../assets/testShell';
import { register as registerStructure } from './index';
import { makeAsset, makePart, makeProject } from './testing';

beforeEach(() => {
  registry.reset();
  registerAssets();
  registerStructure();
});

// 体 ─┬ 頭 ─┬ 顔
//     │      └ 白目 L
//     └ 胴体
// 前髪
function project() {
  return makeProject({
    assets: [
      makeAsset('A', { offset: { x: 450, y: 100 }, width: 100, height: 50 }),
      makeAsset('B', { offset: { x: 600, y: 300 }, width: 40, height: 20 }),
      makeAsset('C', { offset: { x: 400, y: 500 }, width: 200, height: 300 }),
      makeAsset('D', { offset: { x: 420, y: 60 }, width: 160, height: 60 }),
    ],
    parts: [
      makePart('body', { kind: 'group', name: '体' }),
      makePart('head', { kind: 'group', name: '頭', parentId: 'body' }),
      makePart('face', { name: '顔', parentId: 'head', assetId: 'A' }),
      makePart('eyeL', { name: '白目 L', parentId: 'head', assetId: 'B' }),
      makePart('torso', { name: '胴体', parentId: 'body', assetId: 'C' }),
      makePart('hair', { name: '前髪', assetId: 'D' }),
    ],
  });
}

async function setup() {
  const services = testServices();
  renderShell(services);
  const initial = project();
  await act(async () => {
    await Promise.all(initial.assets.map((a) => services.assets.put(a.id, pngBytes(a.width, a.height))));
    services.store.load(initial);
  });
  return services;
}

const row = (id: string) => document.querySelector<HTMLElement>(`[role="tree"] [data-part-id="${id}"]`)!;
// 目の記号のボタン。名前に「表示」が入るのは、この行のボタンの中でこれだけ
const eye = (id: string) => within(row(id)).getByRole('button', { name: /表示/ });
const visibleOf = (services: Services, id: string) =>
  services.store.get().model.parts.find((p) => p.id === id)!.visible;

// 目の記号から読み取れること（状態の印・押した状態・斜線の有無・名前・説明）
function look(id: string) {
  const button = eye(id);
  return {
    state: button.getAttribute('data-visibility'),
    pressed: button.getAttribute('aria-pressed'),
    slash: button.querySelectorAll('svg path').length === 2, // 目の輪郭 + 斜線
    name: button.getAttribute('aria-label'),
    title: button.getAttribute('title'),
  };
}

const VISIBLE = (name: string) => `${name}：表示中（押すと隠す）`;
const HIDDEN = (name: string) => `${name}：非表示（押すと表示する）`;
const PARENT_HIDDEN = (name: string) => `${name}：親が非表示（このパーツは表示に設定。押すと隠す）`;

// テストでは css を読み込まない（?raw も空になる）ので、ファイルをそのまま読む
const structureCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'structure.css'), 'utf8');

// css の中で、セレクターに text を含む規則の宣言（`color: …` など）を集める
function declarationsFor(text: RegExp): string[] {
  const out: string[] = [];
  for (const [, selector, body] of structureCss.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!text.test(selector!)) continue;
    for (const d of body!.split(';')) if (d.trim()) out.push(d.trim().replace(/\s+/g, ' '));
  }
  return out.sort();
}
const stateRule = (state: string) => new RegExp(`\\[data-visibility=['"]${state}['"]\\]`);

describe('カード59: パーツ一覧の目の記号', () => {
  it('表示中・非表示・親が非表示の3つを、斜線・押した状態・名前・説明で見分けられる', async () => {
    const services = await setup();
    expect(look('face')).toEqual({
      state: 'visible',
      pressed: 'true',
      slash: false,
      name: VISIBLE('顔'),
      title: VISIBLE('顔'),
    });

    fireEvent.click(eye('head'));
    expect(visibleOf(services, 'head')).toBe(false);
    expect(look('head')).toEqual({
      state: 'hidden',
      pressed: 'false',
      slash: true,
      name: HIDDEN('頭'),
      title: HIDDEN('頭'),
    });
    // 子は自分の設定（表示）のままで、親が隠れていることを別の状態として出す
    expect(visibleOf(services, 'face')).toBe(true);
    expect(look('face')).toEqual({
      state: 'parent-hidden',
      pressed: 'true',
      slash: false,
      name: PARENT_HIDDEN('顔'),
      title: PARENT_HIDDEN('顔'),
    });
    expect(look('eyeL').state).toBe('parent-hidden');
    // 兄弟（胴体）と別の枝（前髪）は表示中のまま
    expect(look('torso').state).toBe('visible');
    expect(look('hair').state).toBe('visible');

    // 3つの状態は、状態の印も、パーツ名を除いた言葉もすべて違う
    const three = [look('torso'), look('head'), look('face')];
    expect(three.map((s) => s.state)).toEqual(['visible', 'hidden', 'parent-hidden']);
    expect(new Set(three.map((s) => s.name!.replace(/^[^：]+：/, ''))).size).toBe(3);
  });

  it('3つの状態にそれぞれ違う見た目を当て（親が非表示は点線の枠）、目の記号はロックの記号より大きく出す', async () => {
    await setup();
    const visible = declarationsFor(stateRule('visible'));
    const hidden = declarationsFor(stateRule('hidden'));
    const parentHidden = declarationsFor(stateRule('parent-hidden'));
    for (const decls of [visible, hidden, parentHidden]) expect(decls.length).toBeGreaterThan(0);
    expect(new Set([visible.join(';'), hidden.join(';'), parentHidden.join(';')]).size).toBe(3);
    expect(parentHidden.some((d) => /^border:.*\bdashed\b/.test(d))).toBe(true);
    expect(visible.some((d) => /dashed/.test(d))).toBe(false);
    expect(hidden.some((d) => /dashed/.test(d))).toBe(false);

    // 記号そのものは 14 ピクセルで描き（ロックと同じ）、目の記号のボタンの中だけ css で大きくする
    const eyeSvg = eye('face').querySelector('svg')!;
    const lockSvg = within(row('face')).getByRole('button', { name: 'ロック' }).querySelector('svg')!;
    expect(eyeSvg.getAttribute('width')).toBe('14');
    expect(lockSvg.getAttribute('width')).toBe('14');
    const size = declarationsFor(/\.part-visibility svg/)
      .map((d) => /^width: (\d+)px$/.exec(d)?.[1])
      .find((w) => w !== undefined);
    expect(Number(size)).toBeGreaterThan(14);
  });

  it('祖先のどこか（親の親）が非表示なら、その下は「親が非表示」になり、戻すと表示中に戻る', async () => {
    const services = await setup();
    fireEvent.click(eye('body'));
    expect(look('body').state).toBe('hidden');
    expect(look('head').state).toBe('parent-hidden');
    expect(look('face')).toMatchObject({ state: 'parent-hidden', name: PARENT_HIDDEN('顔') });
    expect(look('eyeL')).toMatchObject({ state: 'parent-hidden', name: PARENT_HIDDEN('白目 L') });
    expect(look('torso')).toMatchObject({ state: 'parent-hidden', name: PARENT_HIDDEN('胴体') });
    expect(look('hair')).toMatchObject({ state: 'visible', name: VISIBLE('前髪') });
    // 子孫の自分の設定は変えない
    expect(['head', 'face', 'eyeL', 'torso'].map((id) => visibleOf(services, id))).toEqual([true, true, true, true]);

    fireEvent.click(eye('body'));
    expect(['body', 'head', 'face', 'eyeL', 'torso', 'hair'].map((id) => look(id).state)).toEqual([
      'visible',
      'visible',
      'visible',
      'visible',
      'visible',
      'visible',
    ]);
  });

  it('親が非表示の間に子を押すと子自身が非表示になり、親を戻しても子は非表示のまま', async () => {
    const services = await setup();
    fireEvent.click(eye('head'));
    expect(look('face').state).toBe('parent-hidden');

    fireEvent.click(eye('face'));
    expect(visibleOf(services, 'face')).toBe(false);
    expect(look('face')).toMatchObject({ state: 'hidden', pressed: 'false', slash: true, name: HIDDEN('顔') });

    fireEvent.click(eye('head'));
    expect(visibleOf(services, 'head')).toBe(true);
    expect(look('head').state).toBe('visible');
    expect(look('face')).toMatchObject({ state: 'hidden', name: HIDDEN('顔') });
    expect(look('eyeL')).toMatchObject({ state: 'visible', name: VISIBLE('白目 L') });

    fireEvent.click(eye('face'));
    expect(visibleOf(services, 'face')).toBe(true);
    expect(look('face')).toMatchObject({ state: 'visible', pressed: 'true', slash: false, name: VISIBLE('顔') });
  });

  it('ツールチップとアクセシブル名にそのパーツの名前が入り、名前を変えると追う。回転中心の言葉は使わない', async () => {
    await setup();
    const names: [string, string][] = [
      ['body', '体'],
      ['head', '頭'],
      ['face', '顔'],
      ['eyeL', '白目 L'],
      ['torso', '胴体'],
      ['hair', '前髪'],
    ];
    for (const [id, name] of names) {
      // アクセシブル名（読み上げで読む名前）で探せる
      const button = within(row(id)).getByRole('button', { name: VISIBLE(name) });
      expect(button.getAttribute('title')).toBe(VISIBLE(name));
      expect(button).toBe(eye(id));
    }
    // 行ごとに名前が違うので、どのパーツの目の記号かを取り違えない
    const all = screen.getAllByRole('button', { name: /：(表示中|非表示|親が非表示)/ });
    expect(all.map((b) => b.getAttribute('aria-label'))).toEqual(names.map(([, name]) => VISIBLE(name)));
    // キャンバスの◎の言葉（回転中心）とは重ならない
    expect(all.some((b) => /回転|中心|ピボット/.test(`${b.getAttribute('aria-label')}${b.title}`))).toBe(false);

    // 名前を変えると、目の記号の名前と説明も新しい名前になる
    fireEvent.doubleClick(row('face'));
    const input = screen.getByLabelText('パーツの名前');
    fireEvent.change(input, { target: { value: '輪郭' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(
      within(row('face'))
        .getByRole('button', { name: VISIBLE('輪郭') })
        .getAttribute('title'),
    ).toBe(VISIBLE('輪郭'));
    expect(within(row('face')).queryByRole('button', { name: VISIBLE('顔') })).toBeNull();
    fireEvent.click(eye('face'));
    expect(look('face')).toMatchObject({ name: HIDDEN('輪郭'), title: HIDDEN('輪郭') });
  });
});
