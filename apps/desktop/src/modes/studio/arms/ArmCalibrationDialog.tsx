// 腕の校正のダイアログ（AT-11）。顔の校正と同じ形（手順・指示・3・2・1・やり直し・キャンセル）に、位置合わせの骨格を足す
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { HAND_SHAPES, type ArmSide } from '@app/schema';
import { ARM_CALIBRATION_STEPS, ARM_COUNTDOWN_FROM, type ArmCalibrationFlow } from './flow';
import { SHAPE_LABEL, sideTitle } from './labels';
import { useArmDiagnostics, type StudioArmService } from './service';
import { PART_LABEL, STEP_NEEDS } from './points';
import { Skeleton, VisibleParts } from './Skeleton';

interface DialogProps {
  flow: ArmCalibrationFlow;
  service: StudioArmService;
  mirror: boolean;
  sides: ArmSide[]; // 手形を試す側（有効にしてある側。無ければ両側）
}

// 校正していない間は何も出さず、診断も購読しない
export function ArmCalibrationDialog(props: DialogProps) {
  const phase = useSyncExternalStore(props.flow.subscribe, props.flow.state);
  return phase.kind === 'idle' ? null : <DialogBody {...props} />;
}

function DialogBody(props: DialogProps) {
  const { flow, service, mirror } = props;
  const phase = useSyncExternalStore(flow.subscribe, flow.state);
  const { diagnostics, stale } = useArmDiagnostics(service);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), [phase.kind]);
  if (phase.kind === 'idle') return null;

  const shapes = phase.kind === 'shapes';
  const stepIndex = shapes ? ARM_CALIBRATION_STEPS.length : phase.step;
  const step = ARM_CALIBRATION_STEPS[stepIndex];

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog arms-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="腕の校正"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') flow.cancel();
        }}
      >
        <ol className="arms-steps" aria-label="手順">
          {[...ARM_CALIBRATION_STEPS, { id: 'shapes', label: '手形を試す' }].map((s, i) => (
            <li
              key={s.id}
              data-state={i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'pending'}
              aria-current={i === stepIndex ? 'step' : undefined}
            >
              {s.label}
            </li>
          ))}
        </ol>

        {!shapes && step && (
          <>
            <Skeleton diagnostics={diagnostics} mirror={mirror} stale={stale} />
            <VisibleParts diagnostics={diagnostics} parts={STEP_NEEDS[step.id]} />
            <p className="arms-instruction">{step.instruction}</p>
          </>
        )}

        {phase.kind === 'waiting' && (
          <p className="studio-note" aria-live="polite" aria-label="待っている理由">
            {phase.noPoints
              ? '体の点が来ていない（カメラのトラッキングと腕の認識が動いているか確かめる）'
              : `あなたの${phase.missing.map((p) => PART_LABEL[p]).join('・')}が写っていない。写ると数え始める`}
          </p>
        )}
        {phase.kind === 'countdown' && (
          <>
            <div className="arms-count" aria-live="assertive" aria-label="カウント">
              {phase.count}
            </div>
            <p className="studio-note">{ARM_COUNTDOWN_FROM}・2・1 のあと、その姿勢の点を読み取る</p>
          </>
        )}
        {phase.kind === 'capturing' && (
          <div className="arms-count" aria-live="assertive" aria-label="カウント">
            そのまま
          </div>
        )}
        {phase.kind === 'failed' && (
          <p className="arms-instruction studio-warn" role="alert">
            {phase.message}
          </p>
        )}
        {shapes && (
          <>
            <p className="arms-instruction">
              腕の校正を保存した。パー・グー・指さし・ピースを、左右それぞれで試す（そろわなくても閉じてよい）
            </p>
            <table className="arms-shapes" aria-label="認識できた手形">
              <thead>
                <tr>
                  <th />
                  {HAND_SHAPES.map((s) => (
                    <th key={s}>{SHAPE_LABEL[s]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {props.sides.map((side) => (
                  <tr key={side}>
                    <th scope="row">{sideTitle(side, mirror)}</th>
                    {HAND_SHAPES.map((s) => {
                      const ok = phase.seen[side].includes(s);
                      return (
                        <td key={s} data-seen={ok} aria-label={`${SHAPE_LABEL[s]}${ok ? '：認識できた' : '：まだ'}`}>
                          {ok ? '✓' : '－'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="dialog-buttons">
          {phase.kind === 'failed' && (
            <button type="button" className="primary" onClick={() => flow.retry()}>
              もう一度
            </button>
          )}
          {shapes ? (
            <button type="button" className="primary" ref={closeRef} onClick={() => flow.cancel()}>
              閉じる
            </button>
          ) : (
            <button type="button" ref={closeRef} onClick={() => flow.cancel()}>
              キャンセル
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
