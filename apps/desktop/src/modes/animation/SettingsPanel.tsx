// 登録の設定（アニメーションの right のパネル、カード46）。選んでいるアニメーションの
// 再生速度・ループ・影響範囲・遷移・再開始を変える（どれも1回の Undo。プロジェクトに入るので保存される）。
// 影響範囲の自動/グループ選択、遷移のプリセット/数値・合成方法・リップシンク/物理演算の維持を表示する。
import { useId, useState } from 'react';
import { InfoButton } from '../../help/InfoButton';
import { ANIMATION_HELP_IDS } from '../../help/infoTexts';
import type { Animation, ParameterGroupId } from '@app/schema';
import { PanelSections, useDispatch } from '../../shell/api';
import { useConfirmOverwriteCustom } from '../../shell/level';
import { updateAnimationCommand } from './commands';
import { formatTime, groupNames, PRESET_CHOICES } from './labels';
import { NumberField } from './NumberField';
import {
  applyTransitionPreset,
  autoAffectedGroups,
  currentTransitionPreset,
  MAX_BLEND,
  MAX_SPEED,
  MIN_SPEED,
  setAffectedGroups,
  setBlend,
  setLoop,
  setRestart,
  setSpeed,
  setTransitionOptions,
  type TransitionOptions,
  type TransitionPresetName,
} from './settings';
import { useCurrentAnimation } from './useCurrent';

export const ANIMATION_SETTINGS_PANEL = 'animation.settings';

const CURVE_LABELS: readonly { id: Animation['transition']['curve']; label: string }[] = [
  { id: 'linear', label: '線形' },
  { id: 'smooth', label: 'なめらか' },
];
const BLEND_MODE_LABELS: readonly { id: Animation['transition']['blendMode']; label: string }[] = [
  { id: 'override', label: '上書き' },
  { id: 'addToTracking', label: 'トラッキングに加算' },
];
const RESTART_LABELS: readonly { id: Animation['restart']; label: string }[] = [
  { id: 'restart', label: '最初から' },
  { id: 'ignore', label: '無視' },
];

const formatSpeed = (v: number) => String(Number(v.toFixed(2)));

export function AnimationSettingsPanel() {
  const { project, animation } = useCurrentAnimation();
  const dispatch = useDispatch();
  const confirmOverwrite = useConfirmOverwriteCustom();
  const radioName = useId();
  const [manualFor, setManualFor] = useState<string | null>(null); // 「グループを選ぶ」にしたアニメーション（まだ何も選んでいないとき）

  if (!animation) {
    return (
      <div className="anim-settings">
        <p className="anim-note">アニメーションを選ぶと設定できる</p>
      </div>
    );
  }

  const anim = animation;
  const update = (label: string, fn: (a: Animation) => Animation) =>
    dispatch(updateAnimationCommand(label, anim.id, fn));
  const setOptions = (patch: Partial<TransitionOptions>) =>
    update('遷移を変える', (a) => setTransitionOptions(a, patch));

  // 影響範囲
  const { model } = project;
  const auto = autoAffectedGroups(anim, model.parameters);
  const manual = anim.affectedGroups.length > 0 || manualFor === anim.id;
  const affected = anim.affectedGroups.length > 0 ? anim.affectedGroups : auto;
  const toggleGroup = (id: ParameterGroupId, on: boolean) => {
    const next = on ? [...affected, id] : affected.filter((g) => g !== id);
    if (next.length === 0) setManualFor(null); // 空は自動
    update('影響範囲を変える', (a) => setAffectedGroups(a, next));
  };

  // 遷移
  const t = anim.transition;
  const preset = currentTransitionPreset(t);
  // カスタムのときだけ「個別に調整した値を上書きします」を確かめる（プリセットどうしはすぐ切り替える）
  const choosePreset = (id: TransitionPresetName) => {
    if (preset === id) return;
    const apply = () => update('遷移を変える', (a) => applyTransitionPreset(a, id));
    if (preset !== 'custom') apply();
    else void confirmOverwrite(preset).then((ok) => ok && apply());
  };

  return (
    <div className="anim-settings">
      <p className="anim-settings-name">{anim.name}</p>

      <label className="anim-field">
        <span>再生速度</span>
        <span className="anim-inline">
          <NumberField
            className="anim-number"
            label="再生速度（倍）"
            value={anim.speed}
            min={MIN_SPEED}
            max={MAX_SPEED}
            step={0.1}
            format={formatSpeed}
            onCommit={(v) => update('再生速度を変える', (a) => setSpeed(a, v))}
          />
          倍
        </span>
      </label>
      <label className="anim-check">
        <input
          type="checkbox"
          checked={anim.loop}
          onChange={(e) => update('ループを変える', (a) => setLoop(a, e.target.checked))}
        />
        ループ（止めるまで繰り返す）
      </label>

      <h3 className="anim-heading">影響範囲</h3>
      <p className="anim-note" aria-label="影響範囲の状態">
        {anim.affectedGroups.length === 0
          ? `自動（トラックのあるグループ: ${auto.length > 0 ? groupNames(model, auto) : 'まだ無い'}）`
          : `選んだグループ: ${groupNames(model, anim.affectedGroups)}`}
      </p>
      <>
        <div className="anim-options">
          <label className="anim-check">
            <input
              type="radio"
              name={`${radioName}-groups`}
              checked={!manual}
              onChange={() => {
                setManualFor(null);
                update('影響範囲を変える', (a) => setAffectedGroups(a, []));
              }}
            />
            自動（トラックのあるグループ）
          </label>
          <label className="anim-check">
            <input
              type="radio"
              name={`${radioName}-groups`}
              checked={manual}
              onChange={() => {
                setManualFor(anim.id);
                update('影響範囲を変える', (a) => setAffectedGroups(a, auto));
              }}
            />
            グループを選ぶ
          </label>
          {manual && (
            <div className="anim-groups" role="group" aria-label="影響するグループ">
              {model.parameterGroups.map((g) => (
                <label key={g.id} className="anim-check">
                  <input
                    type="checkbox"
                    checked={affected.includes(g.id)}
                    onChange={(e) => toggleGroup(g.id, e.target.checked)}
                  />
                  {g.name}
                </label>
              ))}
              <p className="anim-note">すべて外すと自動に戻る</p>
            </div>
          )}
        </div>
      </>

      <h3 className="anim-heading">遷移</h3>
      <label className="anim-check">
        <input
          type="checkbox"
          checked={t.startFromCurrent === true}
          disabled={anim.periodic}
          onChange={(e) => setOptions({ startFromCurrent: e.target.checked })}
        />
        現在の姿勢を始点にする（実験）
      </label>
      <InfoButton infoId={ANIMATION_HELP_IDS.startFromCurrent} />
      {t.startFromCurrent && (
        <p className="anim-note">
          スタジオの再生で、今の姿勢へ記録した動きの変化量を重ねます。始まりの秒数で動き始めをなじませます。タイムラインは記録した値を表示します。
        </p>
      )}
      {anim.periodic && <p className="anim-note">この実験設定は通常のアニメーション専用です。</p>}
      <div className="anim-choices" role="group" aria-label="遷移">
        {PRESET_CHOICES.map((c) => (
          <button key={c.id} type="button" aria-pressed={preset === c.id} onClick={() => choosePreset(c.id)}>
            {c.label}
          </button>
        ))}
        {preset === 'custom' && (
          <button type="button" aria-pressed="true" disabled>
            カスタム
          </button>
        )}
      </div>
      <label className="anim-check">
        <input
          type="checkbox"
          checked={t.returnToTracking}
          onChange={(e) => setOptions({ returnToTracking: e.target.checked })}
        />
        トラッキングに戻る
      </label>
      {!t.returnToTracking && <p className="anim-note">終わったら最後の値のまま止まる（次の再生か停止で戻る）</p>}
      <>
        <div className="anim-options">
          <label className="anim-field">
            <span>始まり</span>
            <span className="anim-inline">
              <NumberField
                className="anim-number"
                label="始まりの遷移（blendIn、秒）"
                value={t.blendIn}
                min={0}
                max={MAX_BLEND}
                step={0.05}
                format={formatTime}
                onCommit={(v) => update('遷移を変える', (a) => setBlend(a, { blendIn: v }))}
              />
              秒
            </span>
          </label>
          <label className="anim-field">
            <span>終わり</span>
            <span className="anim-inline">
              <NumberField
                className="anim-number"
                label="終わりの遷移（blendOut、秒）"
                value={t.blendOut}
                min={0}
                max={MAX_BLEND}
                step={0.05}
                format={formatTime}
                onCommit={(v) => update('遷移を変える', (a) => setBlend(a, { blendOut: v }))}
              />
              秒
            </span>
          </label>
          <div className="anim-field">
            <span>カーブ</span>
            <div className="anim-choices" role="group" aria-label="遷移のカーブ">
              {CURVE_LABELS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={t.curve === c.id}
                  onClick={() => setOptions({ curve: c.id })}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div className="anim-field">
            <span>合成方法</span>
            <div className="anim-choices" role="group" aria-label="合成方法">
              {BLEND_MODE_LABELS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={t.blendMode === c.id}
                  onClick={() => setOptions({ blendMode: c.id })}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <label className="anim-check">
            <input
              type="checkbox"
              checked={t.keepLipSync}
              onChange={(e) => setOptions({ keepLipSync: e.target.checked })}
            />
            リップシンクを維持
          </label>
          <label className="anim-check">
            <input
              type="checkbox"
              checked={t.keepPhysics}
              onChange={(e) => setOptions({ keepPhysics: e.target.checked })}
            />
            物理演算を維持
          </label>
        </div>
      </>

      <h3 className="anim-heading">再開始</h3>
      <div className="anim-choices" role="group" aria-label="再開始">
        {RESTART_LABELS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={anim.restart === c.id}
            onClick={() => update('再開始を変える', (a) => setRestart(a, c.id))}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="anim-note">再生中にもう一度始めたとき</p>

      <PanelSections panelId={ANIMATION_SETTINGS_PANEL} />
    </div>
  );
}
