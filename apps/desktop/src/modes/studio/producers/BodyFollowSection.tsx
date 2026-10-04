// スタジオの設定（studioSettings）の「体の動き」（カード36）。控えめ / 標準 / 大きめ を選ぶ
import { useEffect, useSyncExternalStore } from 'react';
import { useProject, useServices } from '../../../shell/api';
import { BODY_FOLLOW_CHOICES, bodyFollowBinding } from './bodyFollow';

// 体の追従が出すパラメータ（顔の左右の向き・傾きに合わせる）
export const BODY_FOLLOW_PARAMETERS = ['BodyAngleX', 'BodyAngleZ'];

export function BodyFollowSection() {
  const services = useServices();
  const project = useProject();
  // services.bodyFollow を実行部の producer につなぐ。出力ウィンドウはスタジオの画面を離れても動き続けるので、
  // 外したとき（画面を離れたとき）もつないだままにする。services が替わったらつなぎ直す
  useEffect(() => {
    bodyFollowBinding.bind(services.bodyFollow);
  }, [services]);
  const strength = useSyncExternalStore(bodyFollowBinding.subscribe, bodyFollowBinding.strength);
  const hasBody = project.model.parameters.some((p) => BODY_FOLLOW_PARAMETERS.includes(p.id));

  return (
    <div className="studio-section">
      <h3>体の動き</h3>
      <div className="studio-choices" role="group" aria-label="体の動き">
        {BODY_FOLLOW_CHOICES.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={strength === c.id}
            onClick={() => bodyFollowBinding.setStrength(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="studio-note">顔の左右の向きと傾きに合わせて体を動かす</p>
      {!hasBody && (
        <p className="studio-note">モデルに体のパラメータ（BodyAngleX・BodyAngleZ）が無いので、体は動かない</p>
      )}
    </div>
  );
}
