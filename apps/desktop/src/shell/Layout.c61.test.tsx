// カード61（小さいウィンドウの右の列・I-010）のテスト。テストの担当は CL（実装の担当は CO）。
// I-064（大きい窓でも開いたパネルを縮めない・境目で高さを決める）で、大きい窓と高さを決めたパネルの決まりを足した
// jsdom はレイアウト（高さ・スクロール）を計算せず、CSS も読み込まない。そこで shell.css を文書に入れて、
// ウィンドウの大きさごとに当てはまる規則（@media の条件と詳細度・順番）をこのテストで決め、
// 右の列の各パネルに効く min-height・flex-shrink・overflow を確かめる。実際の見た目（800×600 で全パネルへ
// スクロールで届くか）は Edge で別に確かめる。
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProjectJson, type Project } from '@app/schema';
import type { Services } from '@app/contracts';
import { registerModes } from '../modes';
import { createFakeServices } from '../services';
import { createEnvironmentStore, memoryEnvironmentStorage } from './environment';
import { registry } from './registry';
import { Shell } from './Shell';

const sampleJson = Object.values(
  import.meta.glob<string>('../../../../fixtures/sample-model/project.json', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)[0]!;

// たたんだパネルの id を覚える localStorage のキー（Layout.tsx）
const COLLAPSED_KEY = 'live2d-studio.collapsedPanels';

// かんたんのモデリングで、選択・変形ツールで目以外を選んでいるときに右の列に出るパネル（共通パレット、order 順）。
// メッシュ・流れ線・閉じた目の線は、ツールや選んだパーツに合わせて出るオブジェクトパレット（下の別のテストで確かめる）
const RIGHT_PANELS = ['パラメータ', 'Transform', 'パーツの設定', '標準パーツの割り当て', '表情', '母音'];

type Viewport = { width: number; height: number };
const SMALL: Viewport = { width: 800, height: 600 };
const LARGE: Viewport = { width: 1440, height: 1000 };

// ---- shell.css の規則を、ウィンドウの大きさを決めて当てはめる ----

let sheet: CSSStyleSheet | null = null;

async function loadShellCss(): Promise<CSSStyleSheet> {
  // このパッケージは Node の型を入れていないので、fs と url は型なしで読み込む（landmarker.test.ts と同じ）
  const fsName: string = 'node:fs';
  const urlName: string = 'node:url';
  const fs = (await import(fsName)) as { readFileSync(p: string, encoding: 'utf8'): string };
  const { fileURLToPath } = (await import(urlName)) as { fileURLToPath(u: string): string };
  const path = fileURLToPath(import.meta.url).replace(/Layout\.c61\.test\.tsx$/, 'shell.css');
  const style = document.createElement('style');
  style.textContent = fs.readFileSync(path, 'utf8');
  document.head.appendChild(style);
  return style.sheet!;
}

// 括弧の外のカンマで分ける（セレクタの一覧・メディアクエリの一覧）
function splitTop(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out;
}

// 幅・高さの min/max だけを見る。分からない条件は当てはまらないとみなす
function mediaMatches(mediaText: string, v: Viewport): boolean {
  return splitTop(mediaText).some((query) =>
    query.split(/\s+and\s+/).every((part) => {
      const m = /^\(\s*(min|max)-(width|height)\s*:\s*(\d+(?:\.\d+)?)px\s*\)$/.exec(part.trim());
      if (!m) return false;
      const value = v[m[2] as 'width' | 'height'];
      return m[1] === 'max' ? value <= Number(m[3]) : value >= Number(m[3]);
    }),
  );
}

type Specificity = [number, number, number];
const compare = (a: Specificity, b: Specificity) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const strongest = (list: Specificity[]) => list.reduce((a, b) => (compare(a, b) >= 0 ? a : b));

// セレクタ1つの詳細度（:not・:is・:has は中のいちばん強いもの、:where は 0）
function specificity(selector: string): Specificity {
  const s: Specificity = [0, 0, 0];
  let rest = selector.replace(/:(not|is|has|where)\(((?:[^()]|\([^()]*\))*)\)/g, (_m, name: string, args: string) => {
    if (name !== 'where') {
      const inner = strongest(splitTop(args).map(specificity));
      s[0] += inner[0];
      s[1] += inner[1];
      s[2] += inner[2];
    }
    return ' ';
  });
  const count = (re: RegExp, i: 0 | 1 | 2) => {
    rest = rest.replace(re, () => {
      s[i]++;
      return ' ';
    });
  };
  count(/\[[^\]]*\]/g, 1);
  count(/::[\w-]+/g, 2);
  count(/#[\w-]+/g, 0);
  count(/\.[\w-]+/g, 1);
  count(/:[\w-]+/g, 1);
  count(/[a-zA-Z][\w-]*/g, 2);
  return s;
}

interface Declaration {
  property: string;
  value: string;
  selector: string;
  media: string | null;
}

// el に効く宣言（properties のどれかで、詳細度がいちばん強く、同じなら後のもの）。無ければ null
function cascaded(el: Element, properties: string[], viewport: Viewport): Declaration | null {
  // 文書の順に集め、最後に詳細度がいちばん強いもののうち後のものを選ぶ
  const found: { declaration: Declaration; specificity: Specificity }[] = [];
  const visit = (rules: CSSRuleList, media: string | null) => {
    for (const rule of Array.from(rules)) {
      if ('media' in rule && 'cssRules' in rule) {
        const mediaRule = rule as CSSMediaRule;
        if (mediaMatches(mediaRule.media.mediaText, viewport)) visit(mediaRule.cssRules, mediaRule.media.mediaText);
        continue;
      }
      if (!('selectorText' in rule)) continue;
      const styleRule = rule as CSSStyleRule;
      const matched = splitTop(styleRule.selectorText).filter((selector) => el.matches(selector));
      if (matched.length === 0) continue;
      const spec = strongest(matched.map(specificity));
      for (let i = 0; i < styleRule.style.length; i++) {
        const property = styleRule.style[i]!;
        if (!properties.includes(property)) continue;
        found.push({
          declaration: { property, value: styleRule.style.getPropertyValue(property), selector: matched[0]!, media },
          specificity: spec,
        });
      }
    }
  };
  visit(sheet!.cssRules, null);
  const best = found.reduce<(typeof found)[number] | null>(
    (a, b) => (a && compare(a.specificity, b.specificity) > 0 ? a : b),
    null,
  );
  return best?.declaration ?? null;
}

const minHeight = (el: Element, v: Viewport) => cascaded(el, ['min-height'], v)?.value ?? null;
// flex-shrink は flex の一括指定でも決まる。効く宣言の名前と値（無ければ null で、初期値の 1）
function shrink(el: Element, v: Viewport): { property: string; value: string } | null {
  const d = cascaded(el, ['flex', 'flex-shrink'], v);
  return d && { property: d.property, value: d.value };
}

// ---- 画面 ----

function setup(collapsed: string[] | null = null) {
  if (collapsed) localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
  const services: Services = {
    ...createFakeServices(),
    createRenderer: () => ({ init() {}, setTextures() {}, render() {}, dispose() {} }),
  };
  render(<Shell services={services} environment={createEnvironmentStore(memoryEnvironmentStorage())} />);
  const project: Project = loadProjectJson(sampleJson);
  act(() => services.store.load(project));
  const image = project.model.parts.find((p) => p.kind === 'image')!;
  act(() => services.editor.set({ selectedPartIds: [image.id] }));
  const right = screen.getByRole('complementary', { name: '右のパネル' });
  const panels = () => Array.from(right.children) as HTMLElement[];
  const titleOf = (panel: HTMLElement) => panel.querySelector(':scope > .panel-title > button')!.textContent!.slice(1);
  const panel = (title: string) => panels().find((p) => titleOf(p) === title)!;
  const body = (p: HTMLElement) => p.querySelector<HTMLElement>(':scope > .panel-body')!;
  return { services, right, panels, titleOf, panel, body };
}

beforeEach(async () => {
  localStorage.clear();
  registry.reset();
  registerModes();
  sheet ??= await loadShellCss();
});
afterEach(() => {
  registry.reset();
  localStorage.clear();
});

describe('カード61: 小さいウィンドウの右の列', () => {
  it('shell.css を読めていて、このテストの当てはめが既存の規則で正しく働く（空振りの防止）', () => {
    const { right, panels } = setup();
    // 読んだ規則の数と、高さに関係なく効く既存の規則
    expect(sheet!.cssRules.length).toBeGreaterThan(50);
    expect(cascaded(right, ['overflow', 'overflow-y'], SMALL)).toMatchObject({
      property: 'overflow',
      value: 'auto',
      selector: '.shell-area',
      media: null,
    });
    expect(cascaded(right, ['width'], SMALL)).toMatchObject({ value: '280px', selector: '.shell-area-right' });
    // 詳細度の計算。小さいウィンドウの規則は shell.css で .panel（min-height: 0）より前にあるので、詳細度で勝つ
    expect(specificity('.panel')).toEqual([0, 1, 0]);
    expect(specificity('.shell-area-right > .panel:not(.collapsed)')).toEqual([0, 3, 0]);
    expect(specificity('.shell-area-right > .panel:not(.collapsed) > .panel-body')).toEqual([0, 4, 0]);
    expect(specificity("button:hover:not(:disabled, [aria-pressed='true'], .active, .primary)")).toEqual([0, 2, 1]);
    expect(mediaMatches('(max-height: 700px)', SMALL)).toBe(true);
    expect(mediaMatches('(max-height: 700px)', LARGE)).toBe(false);
    expect(panels().length).toBe(RIGHT_PANELS.length);
  });

  it('800×600 では、右の列の開いたパネルがどれも最低 180px を持って縮まず、列全体がスクロールの入れ物になる', () => {
    const { right, panels, titleOf, body } = setup();
    // 右の列の子はパネルだけで、初めて開いたときはすべて開いている（保存した開閉が無いとき）
    expect(panels().map(titleOf)).toEqual(RIGHT_PANELS);
    for (const p of panels()) {
      expect(p.classList.contains('panel')).toBe(true);
      expect(p.querySelector(':scope > .panel-title > button')!.getAttribute('aria-expanded')).toBe('true');
    }
    // 列: 縦に並べ、はみ出した分はスクロールする（高さの決まりは列のほうには無い）
    expect(cascaded(right, ['display'], SMALL)?.value).toBe('flex');
    expect(cascaded(right, ['flex-direction'], SMALL)?.value).toBe('column');
    expect(cascaded(right, ['overflow', 'overflow-y'], SMALL)?.value).toBe('auto');
    expect(cascaded(right, ['max-height', 'height'], SMALL)).toBeNull();

    for (const p of panels()) {
      const name = titleOf(p);
      // パネル: 最低 180px で、縮めない（.panel の min-height: 0 より強い）
      expect({ name, minHeight: minHeight(p, SMALL) }).toEqual({ name, minHeight: '180px' });
      expect({ name, shrink: shrink(p, SMALL) }).toEqual({ name, shrink: { property: 'flex-shrink', value: '0' } });
      expect(cascaded(p, ['max-height', 'height'], SMALL)).toBeNull();
      // 中身: 隠さず、最低 140px で、縮めない（中身が多ければ中でもスクロールする）
      const b = body(p);
      expect(b.hidden).toBe(false);
      expect({ name, minHeight: minHeight(b, SMALL) }).toEqual({ name, minHeight: '140px' });
      expect({ name, shrink: shrink(b, SMALL) }).toEqual({ name, shrink: { property: 'flex-shrink', value: '0' } });
      expect(cascaded(b, ['display'], SMALL)).toBeNull();
    }
    // 最低の高さの合計（6 × 180 = 1080px）はウィンドウの高さより大きいので、パネルは潰れずに列がスクロールする。
    // すべてのパネルが同じスクロールの入れ物（右の列）の直下にあるので、列をスクロールすれば全部に届く
    expect(panels().length * 180).toBeGreaterThan(SMALL.height);
    expect(panels().every((p) => p.parentElement === right)).toBe(true);
  });

  it('800×600 でも「パーツの設定」の中身（変形の細かさ）が隠れずにあり、操作できる', () => {
    const { panel, body } = setup();
    const settings = panel('パーツの設定');
    expect(body(settings).hidden).toBe(false);
    expect(minHeight(settings, SMALL)).toBe('180px');
    const radios = within(body(settings)).getAllByRole('radio');
    expect(radios.map((r) => r.parentElement!.textContent)).toEqual(['軽い', '標準', 'なめらか']);
    expect(radios.every((r) => !(r as HTMLInputElement).disabled)).toBe(true);
  });

  it('たたんだパネルは最低の高さを持たず題だけになり、開き直すと最低 180px に戻る', () => {
    const { panel, body } = setup();
    const expressions = panel('表情');
    const toggle = within(expressions).getByRole('button', { name: '表情' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(expressions.classList.contains('collapsed')).toBe(true);
    expect(body(expressions).hidden).toBe(true);
    expect(minHeight(expressions, SMALL)).toBe('0');
    expect(shrink(expressions, SMALL)).toEqual({ property: 'flex', value: 'none' });
    expect(cascaded(body(expressions), ['display'], SMALL)?.value).toBe('none');
    // ほかの開いたパネルはそのまま
    expect(minHeight(panel('パーツの設定'), SMALL)).toBe('180px');
    expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY)!)).toEqual(['expressions']);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(body(expressions).hidden).toBe(false);
    expect(minHeight(expressions, SMALL)).toBe('180px');
    expect(shrink(expressions, SMALL)).toEqual({ property: 'flex-shrink', value: '0' });
  });

  it('オブジェクトパレット（メッシュ・流れ線・閉じた目の線）は列のいちばん上に出て、どの窓の大きさでも縮まない', () => {
    const { services, panels, titleOf, body } = setup();
    // メッシュ編集ツールで目を選ぶと、ツールのパレット → パーツのパレット → 共通パレットの順
    fireEvent.click(screen.getByRole('button', { name: 'メッシュ編集' }));
    act(() => services.editor.set({ selectedPartIds: ['part-eyeWhiteL'] }));
    expect(panels().map(titleOf)).toEqual(['メッシュ', '閉じた目の線', ...RIGHT_PANELS]);
    // 2026-10-08 CO / カード99: 流れ線も小画面検査の対象にする（流線で曲げるツールのときに出る）
    fireEvent.click(screen.getByRole('button', { name: '流線で曲げる' }));
    expect(panels().map(titleOf)).toEqual(['流れ線', '閉じた目の線', ...RIGHT_PANELS]);
    for (const p of panels().slice(0, 2)) {
      const name = titleOf(p);
      expect(p.classList.contains('object')).toBe(true);
      // 小さい窓: 最低 180px で縮めない。大きい窓: 最低の高さは掛けないが縮めない（中身をすべて出す）
      expect({ name, minHeight: minHeight(p, SMALL) }).toEqual({ name, minHeight: '180px' });
      expect({ name, shrink: shrink(p, SMALL) }).toEqual({ name, shrink: { property: 'flex-shrink', value: '0' } });
      expect({ name, minHeight: minHeight(p, LARGE) }).toEqual({ name, minHeight: '0' });
      expect({ name, shrink: shrink(p, LARGE) }).toEqual({ name, shrink: { property: 'flex-shrink', value: '0' } });
      expect(body(p).hidden).toBe(false);
      // オブジェクトパレットの中身は、共通パレットの高さの上限（I-064）を受けない
      expect({ name, maxHeight: cascaded(body(p), ['max-height'], LARGE) }).toEqual({ name, maxHeight: null });
    }
    // 共通パレットも、大きい窓で縮まない（I-064。高さを分け合って題だけに潰れない）
    for (const p of panels().slice(2)) expect(shrink(p, LARGE)).toEqual({ property: 'flex-shrink', value: '0' });
    // 選択・変形ツールで目以外を選ぶと、オブジェクトパレットは無くなる
    fireEvent.click(screen.getByRole('button', { name: '選択・変形' }));
    act(() => services.editor.set({ selectedPartIds: ['part-torso'] }));
    expect(panels().map(titleOf)).toEqual(RIGHT_PANELS);
  });

  it('保存した開閉の設定はそのまま使う（たたんだものだけたたみ、ほかは開く）', () => {
    const { panels, titleOf, panel, body } = setup(['partSettings', 'transform']);
    const collapsed = panels()
      .filter((p) => p.classList.contains('collapsed'))
      .map(titleOf);
    expect(collapsed).toEqual(['Transform', 'パーツの設定']);
    expect(body(panel('パーツの設定')).hidden).toBe(true);
    expect(minHeight(panel('パーツの設定'), SMALL)).toBe('0');
    expect(minHeight(panel('パラメータ'), SMALL)).toBe('180px');
    expect(minHeight(panel('母音'), SMALL)).toBe('180px');
  });

  it('右の列はキーボードで選べる（Tab の順番に入り、名前は「右のパネル」）', () => {
    const { right } = setup();
    expect(right.tagName).toBe('ASIDE');
    expect(right.getAttribute('tabindex')).toBe('0');
    expect(right.tabIndex).toBe(0);
    act(() => right.focus());
    expect(document.activeElement).toBe(right);
    // 右の列は1つだけ
    expect(screen.getAllByRole('complementary', { name: '右のパネル' })).toHaveLength(1);
  });

  it('1440×1000 では、右の列の開いたパネルは最低の高さを持たないが縮まず、列全体がスクロールする（I-064）', () => {
    const { right, panels, titleOf, body } = setup();
    for (const p of panels()) {
      const name = titleOf(p);
      // .panel の min-height: 0 が効き、縮めない（中身の多いパネルを開いても、ほかが題だけに潰れない）
      expect({ name, minHeight: minHeight(p, LARGE) }).toEqual({ name, minHeight: '0' });
      expect({ name, shrink: shrink(p, LARGE) }).toEqual({ name, shrink: { property: 'flex-shrink', value: '0' } });
      expect(minHeight(body(p), LARGE)).toBeNull();
      expect(shrink(body(p), LARGE)).toBeNull();
      // 中身は窓の高さの半分まで（超えた分は中でスクロール）。中身のとても多いパネルがほかを列の下へ押し出さない
      expect({ name, maxHeight: cascaded(body(p), ['max-height'], LARGE)?.value }).toEqual({ name, maxHeight: '50vh' });
      expect({ name, maxHeight: cascaded(body(p), ['max-height'], SMALL)?.value }).toEqual({ name, maxHeight: '50vh' });
      expect(cascaded(body(p), ['overflow', 'overflow-y'], LARGE)?.value).toBe('auto');
    }
    expect(cascaded(right, ['overflow', 'overflow-y'], LARGE)?.value).toBe('auto');
    // CSS の既定は280px。I-087の手動変更と窓への調整はlayoutSizes.i087.test.tsxで確認する
    expect(cascaded(right, ['width'], LARGE)?.value).toBe('280px');
  });

  it('境目で高さを決めたパネルは、どの窓でも最低の高さを掛けずにその高さになり、中でスクロールする（I-064）', () => {
    localStorage.setItem('live2d-studio.panelHeights', JSON.stringify({ partSettings: 120 }));
    const { panel, body } = setup();
    const settings = panel('パーツの設定');
    expect(settings.classList.contains('sized')).toBe(true);
    expect(body(settings).style.height).toBe('120px');
    for (const v of [SMALL, LARGE]) {
      expect(minHeight(settings, v)).toBe('0');
      expect(shrink(settings, v)).toEqual({ property: 'flex-shrink', value: '0' });
      expect(minHeight(body(settings), v)).toBeNull();
      expect(shrink(body(settings), v)).toEqual({ property: 'flex', value: 'none' });
      expect(cascaded(body(settings), ['max-height'], v)).toBeNull();
      expect(cascaded(body(settings), ['overflow', 'overflow-y'], v)?.value).toBe('auto');
    }
    // 決めていないパネルは今までどおり
    expect(panel('パラメータ').classList.contains('sized')).toBe(false);
    expect(minHeight(panel('パラメータ'), SMALL)).toBe('180px');
    expect(minHeight(body(panel('パラメータ')), SMALL)).toBe('140px');
  });

  it('800×600 でも左の列のパネルには最低の高さを掛けない（右の列だけを変える）', () => {
    setup();
    const left = document.querySelector<HTMLElement>('.shell-area-left')!;
    const leftPanels = Array.from(left.querySelectorAll<HTMLElement>(':scope > .panel'));
    expect(leftPanels.length).toBeGreaterThan(0);
    for (const p of leftPanels) {
      expect(minHeight(p, SMALL)).toBe('0');
      expect(shrink(p, SMALL)).toBeNull();
    }
    expect(left.getAttribute('tabindex')).toBeNull();
  });

  it('I-087: 左の列で高さを決めたパネルは縮めず、隣のパネルと重ならずに列全体でスクロールする', () => {
    localStorage.setItem('live2d-studio.layoutSizes', JSON.stringify({ 'modeling.panel.assets.tray': 1800 }));
    setup();
    const left = document.querySelector<HTMLElement>('.shell-area-left')!;
    const panel = left.querySelector<HTMLElement>('[data-panel-id="assets.tray"]')!;
    const body = panel.querySelector<HTMLElement>(':scope > .panel-body')!;
    expect(body.style.height).toBe('1800px');
    for (const viewport of [SMALL, LARGE]) {
      expect(shrink(panel, viewport)).toEqual({ property: 'flex-shrink', value: '0' });
      expect(shrink(body, viewport)).toEqual({ property: 'flex', value: 'none' });
      expect(cascaded(left, ['overflow', 'overflow-y'], viewport)?.value).toBe('auto');
    }
  });
});
