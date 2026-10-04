// 表情の作成（カード38）。register() でモデリングの右に「表情」パネルを入れる
import { registerPanel } from '../../../shell/api';
import { EXPRESSION_PANEL_ID, ExpressionPanel } from './ExpressionPanel';

export {
  STANDARD_EXPRESSION_NAMES,
  addExpressionCommand,
  addExpressionsCommand,
  createExpression,
  missingStandardExpressions,
  nextExpressionName,
  removeExpressionCommand,
  updateExpressionCommand,
  type ExpressionPatch,
} from './commands';
export { EXPRESSION_PANEL_ID } from './ExpressionPanel';

export function register(): void {
  registerPanel({
    id: EXPRESSION_PANEL_ID,
    mode: 'modeling',
    area: 'right',
    title: '表情',
    order: 60,
    component: ExpressionPanel,
  });
}
