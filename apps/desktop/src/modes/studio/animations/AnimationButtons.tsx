// スタジオの bottom の「アニメーション」パネル（カード47）。アニメーションのボタンを押すと再生し、もう一度押すとやめる
// （遷移は services.animations が行う）。周期アニメーションは別の仕組み（シーンごとに有効にする）なので出さない
import { useEffect, useSyncExternalStore } from 'react';
import { useProject, useServices } from '../../../shell/api';
import { animationBinding } from './binding';
import './animations.css';

export const STUDIO_ANIMATION_PANEL = 'studioAnimations';

export function AnimationButtons() {
  const services = useServices();
  const project = useProject();
  // services.animations を実行部の producer につなぐ。出力ウィンドウはスタジオの画面を離れても動き続けるので、
  // 外したとき（画面を離れたとき）もつないだままにする。services が替わったらつなぎ直す
  useEffect(() => {
    animationBinding.bind(services.animations);
  }, [services]);
  const playing = useSyncExternalStore(animationBinding.subscribe, animationBinding.playing);
  const animations = project.animations.filter((a) => !a.periodic);
  const names = playing.flatMap((id) => project.animations.find((a) => a.id === id)?.name ?? []);

  return (
    <div className="sanim-panel">
      {animations.length === 0 ? (
        <p className="studio-note">アニメーションがまだ無い（アニメーションのモードで作る）</p>
      ) : (
        <div className="sanim-buttons" role="group" aria-label="アニメーションのボタン">
          {animations.map((a) => {
            const on = playing.includes(a.id);
            return (
              <button
                key={a.id}
                type="button"
                className="sanim-button"
                aria-pressed={on}
                title={on ? 'もう一度押すとやめる' : '押すと再生する'}
                onClick={() => animationBinding.toggle(a.id, performance.now())}
              >
                <span className="sanim-button-name">{a.name}</span>
                {a.loop && <span className="sanim-button-tag">ループ</span>}
              </button>
            );
          })}
        </div>
      )}
      <p className="studio-note" aria-label="再生中のアニメーション">
        再生中: {names.length > 0 ? names.join('、') : 'なし'}
      </p>
    </div>
  );
}
