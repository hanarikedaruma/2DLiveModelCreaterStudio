// スタジオの producer（カード36 体の追従）。register() で実行部に producer を、スタジオの設定にセクションを入れる
import { registerPanelSection } from '../../../shell/api';
import { registerLayerProducer } from '../runtime';
import { STUDIO_SETTINGS_PANEL } from '../sections';
import { bodyFollowBinding } from './bodyFollow';
import { BodyFollowSection } from './BodyFollowSection';

export { bodyFollowBinding, type BodyFollowStrength } from './bodyFollow';

let unregisterBodyFollow: (() => void) | null = null;

export function register(): void {
  // 何度呼んでも実行部には1つだけ入れる（テストや開発中の読み込み直しで二重にしない）
  unregisterBodyFollow?.();
  unregisterBodyFollow = registerLayerProducer(bodyFollowBinding.producer);
  registerPanelSection({
    id: 'studio.bodyFollow',
    panelId: STUDIO_SETTINGS_PANEL,
    order: 15,
    component: BodyFollowSection,
  });
}
