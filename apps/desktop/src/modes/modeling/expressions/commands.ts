// 表情の一覧を書き換えるコマンド（追加・ひな形・変更・削除）。どれも1回の Undo。
// apply を純粋にするため、新しい表情（id）は呼ぶ側で先に作って渡す
import { newId, type Expression, type Project } from '@app/schema';
import type { Command } from '@app/contracts';
import { EXPRESSION_FADE_DEFAULT } from '@app/core';

// 標準の表情のひな形（値は空。ユーザーが作る）
export const STANDARD_EXPRESSION_NAMES = ['通常', '笑顔', '怒り', '悲しみ', '驚き', '照れ', 'ウィンク'] as const;

export function createExpression(name: string, entries: Expression['entries'] = [], id: string = newId()): Expression {
  return { id, name, entries, fadeIn: EXPRESSION_FADE_DEFAULT, fadeOut: EXPRESSION_FADE_DEFAULT };
}

// まだ使っていない「表情 N」（N は表情の数 + 1 から）
export function nextExpressionName(expressions: readonly Expression[]): string {
  const names = new Set(expressions.map((e) => e.name));
  let n = expressions.length + 1;
  while (names.has(`表情 ${n}`)) n += 1;
  return `表情 ${n}`;
}

// プロジェクトにまだ無い名前の標準の表情（値は空）。表の順
export function missingStandardExpressions(project: Project): Expression[] {
  const names = new Set(project.expressions.map((e) => e.name));
  return STANDARD_EXPRESSION_NAMES.filter((name) => !names.has(name)).map((name) => createExpression(name));
}

// 末尾に足す（同じ id のものは足さない）。足すものが無ければ何もしない
export function addExpressionsCommand(label: string, expressions: readonly Expression[]): Command {
  return {
    label,
    apply(p) {
      const have = new Set(p.expressions.map((e) => e.id));
      const added: Expression[] = [];
      for (const e of expressions) {
        if (have.has(e.id)) continue;
        have.add(e.id);
        added.push(e);
      }
      if (added.length === 0) return p;
      return { ...p, expressions: [...p.expressions, ...added] };
    },
  };
}

export function addExpressionCommand(expression: Expression): Command {
  return addExpressionsCommand('表情を登録', [expression]);
}

export type ExpressionPatch = Partial<Pick<Expression, 'name' | 'entries' | 'fadeIn' | 'fadeOut'>>;

function sameEntries(a: Expression['entries'], b: Expression['entries']): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i]!;
      return x.parameterId === y.parameterId && x.value === y.value && x.blend === y.blend;
    })
  );
}

const validFade = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

// 名前（前後の空白を除く。空なら変えない）・項目・フェードの秒数（0 以上）を変える。何も変わらなければ何もしない
export function updateExpressionCommand(label: string, expressionId: string, patch: ExpressionPatch): Command {
  return {
    label,
    apply(p) {
      const current = p.expressions.find((e) => e.id === expressionId);
      if (!current) return p;
      const name = patch.name?.trim();
      const next: Expression = {
        ...current,
        name: name ? name : current.name,
        entries: patch.entries ?? current.entries,
        fadeIn: validFade(patch.fadeIn) ? patch.fadeIn : current.fadeIn,
        fadeOut: validFade(patch.fadeOut) ? patch.fadeOut : current.fadeOut,
      };
      if (
        next.name === current.name &&
        sameEntries(next.entries, current.entries) &&
        next.fadeIn === current.fadeIn &&
        next.fadeOut === current.fadeOut
      ) {
        return p;
      }
      return { ...p, expressions: p.expressions.map((e) => (e.id === expressionId ? next : e)) };
    },
  };
}

// 削除する。シーンの「切り替えたときに適用する表情」からも外す（Undo で戻る）。
// ホットキーの割り当ては残す（対象が「見つからない」と出る）
export function removeExpressionCommand(expressionId: string): Command {
  return {
    label: '表情を削除',
    apply(p) {
      if (!p.expressions.some((e) => e.id === expressionId)) return p;
      const scenes = p.studio.scenes.map((s) =>
        s.expressionIds.includes(expressionId)
          ? { ...s, expressionIds: s.expressionIds.filter((id) => id !== expressionId) }
          : s,
      );
      return {
        ...p,
        expressions: p.expressions.filter((e) => e.id !== expressionId),
        studio: { ...p.studio, scenes },
      };
    },
  };
}
