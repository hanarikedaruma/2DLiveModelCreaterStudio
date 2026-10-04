// シーンのパネル（'scene'）のセクション「周期アニメーション」（カード48）。使っているシーンで有効にする
// 周期アニメーションをチェックで選ぶ（Scene.periodicAnimationIds に保存。1回ずつ Undo）。
// services.periodic を実行部の producer につなぐのもここ（出力ウィンドウはスタジオの画面を離れても動き続け、
// シーンはほかのモードの Undo でも変わるので、外れても（画面を離れても）つないだままにする）
import { useEffect } from 'react';
import { hasBreathAnimation, PERIODIC_FADE_SECONDS } from '@app/core';
import { useDispatch, useProject, useServices } from '../../../shell/api';
import { activeScene } from '../scene';
import { periodicBinding } from './binding';
import { addStandardBreathCommand, periodicAnimations, setScenePeriodicCommand } from './commands';
import './periodic.css';

export function ScenePeriodicSection() {
  const services = useServices();
  const project = useProject();
  const dispatch = useDispatch();
  useEffect(() => {
    periodicBinding.bind({ periodic: services.periodic, store: services.store });
  }, [services]);

  const enabled = new Set(activeScene(project)?.periodicAnimationIds ?? []);
  const animations = periodicAnimations(project);

  return (
    <div className="studio-section">
      <h3>周期アニメーション</h3>
      {animations.length === 0 ? (
        <p className="studio-note">周期アニメーションが無い（アニメーションのモードで「周期アニメーションにする」）</p>
      ) : (
        <div className="periodic-list" role="group" aria-label="周期アニメーション">
          {animations.map((a) => (
            <label key={a.id} className="studio-check">
              <input
                type="checkbox"
                checked={enabled.has(a.id)}
                onChange={(e) => dispatch(setScenePeriodicCommand(a.id, e.target.checked))}
              />
              {a.name}
            </label>
          ))}
        </div>
      )}
      {!hasBreathAnimation(project) && (
        <button type="button" onClick={() => dispatch(addStandardBreathCommand())}>
          標準の呼吸を作る
        </button>
      )}
      <p className="studio-note">{`チェックしたものを、このシーンの間ほかの動きに重ねて繰り返す（始めと終わりは ${PERIODIC_FADE_SECONDS} 秒でフェード）`}</p>
    </div>
  );
}
