// ⓘ の説明は info.md に集める。HTMLや任意のMarkdownを実行せず、目的・使いどころ・手順だけを読む。
import infoMarkdown from './info.md?raw';

export interface InfoText {
  title: string;
  purpose: string;
  uses: string[];
  steps: string[];
}

export const PARAMETER_HELP_IDS = {
  generateBetween: 'parameters.generateBetween',
  regenerateAll: 'parameters.regenerateAll',
  rebuildDepth: 'parameters.rebuildDepth',
  generation: 'parameters.generation',
} as const;

export function parseInfoTexts(markdown: string): Map<string, InfoText> {
  const texts = new Map<string, InfoText>();
  let current: InfoText | null = null;
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (!current || paragraph.length === 0) return;
    current.purpose += (current.purpose ? '\n\n' : '') + paragraph.join(' ');
    paragraph = [];
  };
  for (const rawLine of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    const heading = /^## ([A-Za-z][\w.-]*) (.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      const [, id, title] = heading;
      if (texts.has(id!)) throw new Error(`説明のIDが重複しています: ${id}`);
      current = { title: title!, purpose: '', uses: [], steps: [] };
      texts.set(id!, current);
      continue;
    }
    if (!current || line.startsWith('#')) throw new Error(`説明の見出しを読めません: ${line}`);
    const use = /^- (.+)$/.exec(line);
    const step = /^\d+\. (.+)$/.exec(line);
    if (use || step) {
      flushParagraph();
      if (use) current.uses.push(use[1]!);
      else current.steps.push(step![1]!);
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  for (const [id, info] of texts) {
    if (!info.purpose) throw new Error(`説明の目的がありません: ${id}`);
  }
  return texts;
}

function loadInfoTexts(): Map<string, InfoText> {
  try {
    return parseInfoTexts(infoMarkdown);
  } catch (error) {
    console.error('説明を読み込めませんでした', error);
    return new Map();
  }
}

export const infoTexts = loadInfoTexts();
export const ANIMATION_HELP_IDS = { startFromCurrent: 'animation.startFromCurrent' } as const;
export const getInfoText = (id: string): InfoText | undefined => infoTexts.get(id);
