// アニメーションの再生（カード47）。register() で実行部に producer（id 'animation'）を、スタジオの bottom に
// 「アニメーション」パネルを入れ、ホットキーの 'hotkey:animation' を受けて再生 / やめる
import { onAppEvent, registerPanel } from '../../../shell/api';
import { ANIMATION_EVENT } from '../../../hotkeys/actions';
import { registerLayerProducer } from '../runtime';
import { animationBinding, isHotkeyAnimationEvent } from './binding';
import { AnimationButtons, STUDIO_ANIMATION_PANEL } from './AnimationButtons';

export { createAnimationBinding, animationBinding, isHotkeyAnimationEvent, type AnimationBinding } from './binding';
export { STUDIO_ANIMATION_PANEL } from './AnimationButtons';

let unregister: (() => void) | null = null;

export function register(): void {
  // 何度呼んでも実行部の producer とホットキーの受け口は1つだけ（テストや開発中の読み込み直しで二重にしない）
  unregister?.();
  const offProducer = registerLayerProducer(animationBinding.producer);
  // ホットキーはスタジオのモードの間だけ届く。つないでいなければ何もしない
  const offHotkey = onAppEvent(ANIMATION_EVENT, (payload) => {
    if (isHotkeyAnimationEvent(payload)) animationBinding.hotkey(payload, performance.now());
  });
  unregister = () => {
    offProducer();
    offHotkey();
  };
  registerPanel({
    id: STUDIO_ANIMATION_PANEL,
    mode: 'studio',
    area: 'bottom',
    title: 'アニメーション',
    order: 10,
    component: AnimationButtons,
  });
}
