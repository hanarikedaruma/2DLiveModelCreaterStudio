// グローバルホットキー（カード40）。register() でスタジオの設定のパネルに割り当ての画面を足し、
// パラメータのホットキーの値を出す producer（id 'expression'）をスタジオの実行部に登録する
import { registerPanelSection } from '../shell/api';
import { registerLayerProducer } from '../modes/studio';
import { HotkeySection } from './HotkeySection';
import { hotkeyRuntime } from './runtime';
import './hotkeys.css';

export { createHotkeyService, tauriShortcutBackend, windowShortcutBackend, type ShortcutBackend } from './service';
export { hotkeyRuntime } from './runtime';
export { ANIMATION_EVENT, RECALIBRATE_EVENT, type HotkeyAnimationEvent } from './actions';

// スタジオの設定のパネル（modes/studio の STUDIO_SETTINGS_PANEL）
const STUDIO_SETTINGS_PANEL = 'studioSettings';

let offProducer: (() => void) | null = null;

export function register(): void {
  registerPanelSection({ id: 'studio.hotkeys', panelId: STUDIO_SETTINGS_PANEL, order: 40, component: HotkeySection });
  // 何度呼んでも producer は1つ
  offProducer?.();
  offProducer = registerLayerProducer(hotkeyRuntime.actions.producer);
}
