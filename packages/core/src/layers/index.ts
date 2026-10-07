// 合成のレイヤー（STEP1）。公開するものだけをここから export する
export { createAutoBlink } from './autoBlink'; // カード36
export { createAutoLayerProducer, AUTO_BLINK_PARAMETERS, type AutoLayerProducer } from './autoLayer'; // STEP3 のカード66
export { createBodyFollowProducer, BODY_FOLLOW_RATES, type BodyFollowStrength } from './bodyFollow'; // カード36
export {
  createExpressionController,
  EXPRESSION_FADE_DEFAULT,
  EXPRESSION_STANDARD_BLENDS,
  expressionEase,
  expressionRuleBlend,
  expressionBlendFor,
  expressionEntryValue,
  expressionStateValue,
  buildExpressionEntries,
  expressionStateOf,
  expressionGroupModesOf,
  type ExpressionGroupMode,
  type ExpressionGroupModes,
} from './expression'; // カード38
