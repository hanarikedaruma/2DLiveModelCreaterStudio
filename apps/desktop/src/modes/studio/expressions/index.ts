// 表情の適用（カード38・52）。register() で実行部に producer（id 'expression'）を、スタジオの bottom に「表情」パネルを入れる
import { registerPanel } from '../../../shell/api';
import { registerLayerProducer } from '../runtime';
import { expressionBinding } from './binding';
import { ExpressionCards, STUDIO_EXPRESSION_PANEL } from './ExpressionCards';

export { createExpressionBinding, expressionBinding, type ExpressionBinding, type ExpressionCardMode } from './binding';
export { STUDIO_EXPRESSION_PANEL } from './ExpressionCards';

let unregisterExpression: (() => void) | null = null;

export function register(): void {
  // 何度呼んでも実行部には1つだけ入れる（テストや開発中の読み込み直しで二重にしない）
  unregisterExpression?.();
  unregisterExpression = registerLayerProducer(expressionBinding.producer);
  registerPanel({
    id: STUDIO_EXPRESSION_PANEL,
    mode: 'studio',
    area: 'bottom',
    title: '表情',
    component: ExpressionCards,
  });
}
