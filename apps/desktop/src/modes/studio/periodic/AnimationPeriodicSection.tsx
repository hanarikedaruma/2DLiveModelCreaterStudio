// アニメーション画面の「登録の設定」（'animation.settings'）のセクション「周期アニメーション」（カード48）。
// 選んでいるアニメーションを周期アニメーション（Animation.periodic）にする / やめる（1回の Undo）
import { PERIODIC_FADE_SECONDS } from '@app/core';
import { useDispatch } from '../../../shell/api';
import { useCurrentAnimation } from '../../animation/useCurrent';
import { setAnimationPeriodicCommand } from './commands';
import './periodic.css';

export function AnimationPeriodicSection() {
  const { project, animation } = useCurrentAnimation();
  const dispatch = useDispatch();
  if (!animation) return null;
  const scenes = project.studio.scenes.filter((s) => s.periodicAnimationIds.includes(animation.id)).map((s) => s.name);

  return (
    <div className="periodic-settings">
      <h3 className="anim-heading">周期アニメーション</h3>
      <label className="anim-check">
        <input
          type="checkbox"
          checked={animation.periodic}
          onChange={(e) => dispatch(setAnimationPeriodicCommand(animation.id, e.target.checked))}
        />
        周期アニメーションにする
      </label>
      {animation.periodic ? (
        <>
          <p className="anim-note" aria-label="有効にしているシーン">
            {scenes.length > 0
              ? `有効にしているシーン: ${scenes.join('、')}`
              : 'まだどのシーンでも有効にしていない（スタジオのシーンのパネルで選ぶ）'}
          </p>
          <p className="anim-note">{`デフォルト値からの差分をほかの動きに足して繰り返す。ループ・遷移・再開始は使わない（始めと終わりは ${PERIODIC_FADE_SECONDS} 秒でフェード）`}</p>
        </>
      ) : (
        <p className="anim-note">呼吸や体の揺れなどを、スタジオのシーンでほかの動きに重ねて繰り返す</p>
      )}
    </div>
  );
}
