// 選んでいるアニメーションと、その中に収めた時刻（カード46）
import type { Animation, Project } from '@app/schema';
import { useProject } from '../../shell/api';
import { selectedAnimation, useAnimationEditor, type AnimationEditorState } from './state';

export interface CurrentAnimation {
  project: Project;
  animation: Animation | null;
  time: number; // 0..duration
  state: AnimationEditorState;
  setState(patch: Partial<AnimationEditorState>): void;
}

export function useCurrentAnimation(): CurrentAnimation {
  const project = useProject();
  const [state, setState] = useAnimationEditor();
  const animation = selectedAnimation(project, state);
  const time = animation ? Math.min(Math.max(state.time, 0), animation.duration) : 0;
  return { project, animation, time, state, setState };
}
