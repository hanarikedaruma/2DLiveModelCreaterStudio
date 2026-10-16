import { afterEach, describe, expect, it } from 'vitest';
import { registry } from '../shell/registry';
import { register as registerMesh } from '../modes/modeling/mesh';
import { register as registerCurve } from '../modes/modeling/curveGuide';
import { register as registerWarp } from '../modes/modeling/warp';
import { register as registerContour } from '../modes/modeling/contourLine';
import { register as registerClosedLine } from '../modes/modeling/setupTools';
import { register as registerParameters } from '../modes/modeling/parameters';
import { ANIMATION_HELP_IDS, infoTexts, PARAMETER_HELP_IDS, parseInfoTexts } from './infoTexts';

afterEach(() => registry.reset());

describe('外部の説明テキスト（I-086）', () => {
  it('ID・見出し・目的の段落・使いどころ・手順を読み、改行コードが違っても同じ', () => {
    const markdown = '## test.example 見出し\n\n目的の\n続き\n\n次の段落\n\n- 使いどころ\n\n1. まず選ぶ\n2. 動かす\n';
    expect(parseInfoTexts(markdown).get('test.example')).toEqual({
      title: '見出し',
      purpose: '目的の 続き\n\n次の段落',
      uses: ['使いどころ'],
      steps: ['まず選ぶ', '動かす'],
    });
    expect(parseInfoTexts(markdown.replace(/\n/g, '\r\n'))).toEqual(parseInfoTexts(markdown));
  });

  it('重複ID・目的の欠落・不正な見出しを見逃さない', () => {
    expect(() => parseInfoTexts('## test テスト\n目的\n## test 重複\n目的')).toThrow('重複');
    expect(() => parseInfoTexts('## test テスト\n- 手順だけ')).toThrow('目的がありません');
    expect(() => parseInfoTexts('## テスト\n目的')).toThrow('見出し');
  });

  it('実際に登録したパネルと項目のIDがすべてあり、説明の消し忘れも無い', () => {
    registry.reset();
    for (const register of [
      registerMesh,
      registerCurve,
      registerWarp,
      registerContour,
      registerClosedLine,
      registerParameters,
    ])
      register();
    const panelIds = registry.get().panels.flatMap((p) => (typeof p.info === 'string' ? [p.info] : []));
    expect(panelIds).toHaveLength(6);
    expect([...panelIds, ...Object.values(PARAMETER_HELP_IDS), ...Object.values(ANIMATION_HELP_IDS)].sort()).toEqual(
      [...infoTexts.keys()].sort(),
    );
  });
});
