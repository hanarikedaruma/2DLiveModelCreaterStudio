import { onAppEvent, registerPanelSection } from '../../../shell/api';
import { registerLayerProducer } from '../runtime';
import { SCENE_CHANGED_EVENT } from '../scenes/watcher';
import { AnimationPeriodicSection } from './AnimationPeriodicSection';
import { periodicBinding } from './binding';
import { PROJECT_LOADED_EVENT } from './commands';
import { ScenePeriodicSection } from './ScenePeriodicSection';

let unregister: (() => void) | null = null;

export function register(): void {
  unregister?.();
  const offProducer = registerLayerProducer(periodicBinding.producer);
  const offScene = onAppEvent(SCENE_CHANGED_EVENT, periodicBinding.sceneChanged);
  const offProject = onAppEvent(PROJECT_LOADED_EVENT, periodicBinding.projectLoaded);
  unregister = () => {
    offProducer();
    offScene();
    offProject();
  };
  registerPanelSection({ id: 'scene.periodic', panelId: 'scene', order: 50, component: ScenePeriodicSection });
  registerPanelSection({
    id: 'animation.periodic',
    panelId: 'animation.settings',
    order: 50,
    component: AnimationPeriodicSection,
  });
}
