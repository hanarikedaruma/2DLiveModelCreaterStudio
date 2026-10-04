// シーンと背景プリセット（カード39）。register() でスタジオの left にシーンの一覧のパネル（id 'scene'）を足し、
// その中に選んだシーンの編集（背景・表情・モデルの配置）のセクションを登録する
import { registerPanel, registerPanelSection } from '../../../shell/api';
import { SCENE_PANEL, ScenePanel } from './ScenePanel';
import { SceneBackgroundSection, SceneExpressionSection, ScenePlacementSection } from './sections';
import './scenes.css';

export { SCENE_PANEL } from './ScenePanel';
export { SCENE_CHANGED_EVENT, sceneWatcher } from './watcher';
export { BACKGROUND_PRESETS, backgroundLabel, type BackgroundPreset } from './presets';

export function register(): void {
  registerPanel({ id: SCENE_PANEL, mode: 'studio', area: 'left', title: 'シーン', component: ScenePanel });
  registerPanelSection({ id: 'scene.background', panelId: SCENE_PANEL, order: 10, component: SceneBackgroundSection });
  registerPanelSection({ id: 'scene.expression', panelId: SCENE_PANEL, order: 20, component: SceneExpressionSection });
  registerPanelSection({ id: 'scene.placement', panelId: SCENE_PANEL, order: 30, component: ScenePlacementSection });
}
