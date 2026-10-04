// アニメーション画面（カード46）。register() で枠に中央（プレビューとタイムライン）、
// 左の「アニメーション」（一覧）、右の「登録の設定」を入れる
import { registerCenter, registerPanel } from '../../shell/api';
import { AnimationCenter } from './AnimationCenter';
import { AnimationListPanel } from './AnimationListPanel';
import { ANIMATION_SETTINGS_PANEL, AnimationSettingsPanel } from './SettingsPanel';

export const ANIMATION_LIST_PANEL = 'animation.list';
export { ANIMATION_SETTINGS_PANEL } from './SettingsPanel';
export {
  addAnimationCommand,
  createAnimation,
  duplicateAnimationCommand,
  removeAnimationCommand,
  renameAnimationCommand,
  updateAnimationCommand,
} from './commands';
export { sampleAnimation, sampleKeyframes } from './keyframes';
export { TRANSITION_PRESETS } from './settings';

export function register(): void {
  registerCenter('animation', AnimationCenter);
  registerPanel({
    id: ANIMATION_LIST_PANEL,
    mode: 'animation',
    area: 'left',
    title: 'アニメーション',
    order: 10,
    component: AnimationListPanel,
  });
  registerPanel({
    id: ANIMATION_SETTINGS_PANEL,
    mode: 'animation',
    area: 'right',
    title: '登録の設定',
    order: 10,
    component: AnimationSettingsPanel,
  });
}
