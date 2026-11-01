import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import type { ParamValues } from '@app/contracts';
import { armInFront, armReferenceFromJoints, changeArmRig, planArmSetup, releaseArmRig } from '@app/core';
import {
  HAND_SHAPES,
  defaultArmLimits,
  inspectArmRigs,
  type ArmHandAttachment,
  type ArmLimits,
  type ArmPose,
  type ArmSide,
  type HandShape,
  type Vec2,
} from '@app/schema';
import { useCanvas, useDispatch, useEditor, useProject, useServices } from '../../../shell/api';
import { useBindEnv, type EnvSlot } from '../canvas/env';
import { ARM_TOOL_ID, type ArmEditor, type ArmHandle } from './tool';
import './arms.css';

const SHAPE: Record<HandShape, string> = { open: 'パー', fist: 'グー', point: '指さし', peace: 'ピース' };
const JOINT = { shoulder: '肩', elbow: '肘', wrist: '手首' };
const initialJoints = () => ({ shoulder: { x: 300, y: 240 }, elbow: { x: 300, y: 358 }, wrist: { x: 300, y: 466 } });
export function makeArmPanel(slot: EnvSlot, controller: ArmEditor): FC {
  return function ArmPanel() {
    useBindEnv(slot);
    const project = useProject(),
      dispatch = useDispatch(),
      services = useServices();
    const [, setEditor] = useEditor(),
      canvas = useCanvas();
    const [side, setSide] = useState<ArmSide>('L'),
      rig = project.model.armRigs?.find((r) => r.side === side);
    const [parentId, setParent] = useState<string | null>(null),
      [joints, setJoints] = useState(initialJoints);
    const [upper, setUpper] = useState<string[]>([]),
      [lower, setLower] = useState<string[]>([]);
    const [hands, setHands] = useState<Partial<Record<HandShape, ArmHandAttachment>>>({});
    const [limits, setLimits] = useState<ArmLimits>(defaultArmLimits),
      [rest, setRest] = useState<ArmPose>({ shoulder: 8, elbow: 12, wrist: 0 });
    const [restHand, setRestHand] = useState<HandShape>('open'),
      [handle, setHandle] = useState<ArmHandle>('shoulder');
    const [legacy, setLegacy] = useState(false),
      [message, setMessage] = useState('');
    const [wave, setWave] = useState(false);
    const [referenceWrist, setReferenceWrist] = useState(0);
    const setPreviewValues = useCallback(
      (patch: ParamValues) => {
        setEditor({ editorParamValues: { ...services.editor.get().editorParamValues, ...patch } });
      },
      [services, setEditor],
    );
    const clearSidePreview = () => {
      const ids = new Set(
        [...(project.model.armRigs ?? []), ...(services.store.get().model.armRigs ?? [])]
          .filter((r) => r.side === side)
          .flatMap((r) => [
            r.parameters.shoulder,
            r.parameters.elbow,
            r.parameters.wrist,
            ...Object.values(r.parameters.shapes),
          ]),
      );
      setEditor({
        editorParamValues: Object.fromEntries(
          Object.entries(services.editor.get().editorParamValues).filter(([id]) => !ids.has(id)),
        ),
      });
    };
    useEffect(() => {
      if (!wave || !rig) return;
      let frame = 0;
      const start = performance.now();
      const tick = (now: number) => {
        const t = ((now - start) / 1000) * 2 * Math.PI;
        setPreviewValues({
          [rig.parameters.shoulder]: 65 + 6 * Math.sin(t),
          [rig.parameters.elbow]: 100 + 10 * Math.sin(t),
          [rig.parameters.wrist]: 25 * Math.cos(t),
          ...Object.fromEntries(HAND_SHAPES.map((h) => [rig.parameters.shapes[h], h === 'open' ? 1 : 0])),
        });
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    }, [wave, rig, setPreviewValues]);
    useEffect(() => {
      setParent(rig?.parentPartId ?? null);
      setJoints(rig ? structuredClone(rig.joints) : initialJoints());
      setHands(rig ? structuredClone(rig.hands) : {});
      setLimits(rig ? structuredClone(rig.limits) : defaultArmLimits());
      setRest(rig ? { ...rig.restPose } : { shoulder: 8, elbow: 12, wrist: 0 });
      setRestHand(rig?.restHand ?? 'open');
      setReferenceWrist(rig?.referencePose.wrist ?? 0);
      setUpper(
        rig
          ? project.model.parts.filter((p) => p.parentId === rig.groups.shoulder && p.kind === 'image').map((p) => p.id)
          : [],
      );
      setLower(
        rig
          ? project.model.parts.filter((p) => p.parentId === rig.groups.elbow && p.kind === 'image').map((p) => p.id)
          : [],
      );
      setHandle(rig ? 'preview' : 'shoulder');
      setWave(false);
      setMessage('');
    }, [rig, side, project.model.parts]);
    useEffect(() => {
      controller.configure({
        side,
        parentId,
        joints,
        rigId: rig?.id ?? null,
        handle,
        onJoint: setJoints,
        onError: setMessage,
      });
    }, [side, parentId, joints, rig?.id, handle]);
    const plan = useMemo(() => {
      const geometry = armReferenceFromJoints(side, joints, referenceWrist);
      return rig
        ? changeArmRig(project, {
            ...rig,
            joints,
            ...geometry,
            hands,
            limits,
            restPose: rest,
            restHand,
          })
        : planArmSetup(project, {
            side,
            parentPartId: parentId,
            joints,
            upperPartIds: upper,
            forearmPartIds: lower,
            hands,
            referenceWristAngle: referenceWrist,
            acknowledgeLegacy: legacy,
          });
    }, [project, rig, side, parentId, joints, upper, lower, hands, legacy, limits, rest, restHand, referenceWrist]);
    const images = project.model.parts.filter((p) => p.kind === 'image');
    const groups = project.model.parts.filter(
      (p) => p.kind === 'group' && !project.model.armRigs?.some((r) => Object.values(r.groups).includes(p.id)),
    );
    const setPoint = (key: keyof typeof JOINT, axis: keyof Vec2, value: number) =>
      setJoints((p) => ({ ...p, [key]: { ...p[key], [axis]: value } }));
    const chooseHandle = (next: ArmHandle) => {
      setWave(false);
      setHandle(next);
      canvas.setActiveTool(ARM_TOOL_ID);
      if (next !== 'preview')
        setPreviewValues(
          rig
            ? {
                [rig.parameters.shoulder]: rig.referencePose.shoulder,
                [rig.parameters.elbow]: rig.referencePose.elbow,
                [rig.parameters.wrist]: rig.referencePose.wrist,
              }
            : {},
        );
    };
    const preview = (pose: ArmPose, shape: HandShape) => {
      if (!rig) return;
      setWave(false);
      setHandle('preview');
      setPreviewValues({
        [rig.parameters.shoulder]: pose.shoulder,
        [rig.parameters.elbow]: pose.elbow,
        [rig.parameters.wrist]: pose.wrist,
        ...Object.fromEntries(HAND_SHAPES.map((h) => [rig.parameters.shapes[h], h === shape ? 1 : 0])),
      });
      canvas.requestRedraw();
    };
    const multi = (label: string, value: string[], set: (v: string[]) => void) => (
      <label>
        {label}
        <select
          aria-label={label}
          multiple
          size={3}
          value={value}
          disabled={!!rig}
          onChange={(e) => set([...e.target.selectedOptions].map((o) => o.value))}
        >
          {images.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
    );
    return (
      <div className="arm-setup">
        <p>肩・肘・手首と左右専用の手を設定する。キャンバスの点をドラッグして配置し、最後に保存する。</p>
        <label>
          設定する腕
          <select aria-label="設定する腕" value={side} onChange={(e) => setSide(e.target.value as ArmSide)}>
            <option value="L">モデルの左腕（画面右）</option>
            <option value="R">モデルの右腕（画面左）</option>
          </select>
        </label>
        <label>
          体側の親
          <select
            aria-label="体側の親"
            value={parentId ?? ''}
            disabled={!!rig}
            onChange={(e) => setParent(e.target.value || null)}
          >
            <option value="">モデルの原点</option>
            {groups.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {multi('上腕の素材', upper, setUpper)}
        {multi('前腕の素材', lower, setLower)}
        <fieldset>
          <legend>基準画像の関節</legend>
          {(Object.keys(JOINT) as (keyof typeof JOINT)[]).map((key) => (
            <div key={key}>
              <button type="button" aria-pressed={handle === key} onClick={() => chooseHandle(key)}>
                {JOINT[key]}を配置
              </button>
              <div className="arm-setup-pair">
                {(['x', 'y'] as const).map((axis) => (
                  <label key={axis}>
                    {axis.toUpperCase()}
                    <input
                      aria-label={`${JOINT[key]} ${axis.toUpperCase()}`}
                      type="number"
                      value={joints[key][axis]}
                      onChange={(e) => setPoint(key, axis, Number(e.target.value))}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
        <label>
          基準画像の手首（度）
          <input
            aria-label="基準の手首"
            type="number"
            value={referenceWrist}
            onChange={(e) => setReferenceWrist(Number(e.target.value))}
          />
        </label>
        <fieldset>
          <legend>手の素材・接続</legend>
          <p>手のひら面を固定。左右の絵を反転して流用しない。</p>
          {HAND_SHAPES.map((shape) => {
            const hand = hands[shape];
            const update = (patch: Partial<ArmHandAttachment>) =>
              setHands((all) => ({
                ...all,
                [shape]: {
                  partIds: [],
                  wrist: { ...joints.wrist },
                  fingerDirection: { x: joints.wrist.x - joints.elbow.x, y: joints.wrist.y - joints.elbow.y },
                  ...all[shape],
                  ...patch,
                },
              }));
            return (
              <details key={shape}>
                <summary>
                  {SHAPE[shape]}
                  {hand?.partIds.length ? '：設定済み' : '：未設定'}
                </summary>
                <label>
                  {SHAPE[shape]}の素材
                  <select
                    aria-label={`${SHAPE[shape]}の素材`}
                    value={hand?.partIds[0] ?? ''}
                    disabled={!!rig}
                    onChange={(e) => update({ partIds: e.target.value ? [e.target.value] : [] })}
                  >
                    <option value="">未設定</option>
                    {images.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="arm-setup-pair">
                  {(['x', 'y'] as const).map((axis) => (
                    <label key={axis}>
                      接続{axis.toUpperCase()}
                      <input
                        aria-label={`${SHAPE[shape]} 接続${axis.toUpperCase()}`}
                        type="number"
                        value={hand?.wrist[axis] ?? joints.wrist[axis]}
                        onChange={(e) =>
                          update({ wrist: { ...(hand?.wrist ?? joints.wrist), [axis]: Number(e.target.value) } })
                        }
                      />
                    </label>
                  ))}
                </div>
                <label>
                  基準の指方向（度）
                  <input
                    aria-label={`${SHAPE[shape]} 指方向`}
                    type="number"
                    value={
                      hand
                        ? Math.round((Math.atan2(hand.fingerDirection.y, hand.fingerDirection.x) * 180) / Math.PI)
                        : Math.round(
                            (Math.atan2(joints.wrist.y - joints.elbow.y, joints.wrist.x - joints.elbow.x) * 180) /
                              Math.PI,
                          )
                    }
                    onChange={(e) => {
                      const a = (Number(e.target.value) * Math.PI) / 180;
                      update({ fingerDirection: { x: Math.cos(a), y: Math.sin(a) } });
                    }}
                  />
                </label>
              </details>
            );
          })}
        </fieldset>
        {rig && (
          <details>
            <summary>可動域と休止姿勢</summary>
            {(Object.keys(limits) as (keyof ArmLimits)[]).map((key) => (
              <label key={key}>
                {{ ...JOINT, forearm: '前腕の合成角', hand: '手の合成角' }[key]}（度）
                <div className="arm-setup-pair">
                  {(['min', 'max'] as const).map((edge) => (
                    <input
                      key={edge}
                      aria-label={`${key} ${edge}`}
                      type="number"
                      value={limits[key][edge]}
                      onChange={(e) =>
                        setLimits((all) => ({ ...all, [key]: { ...all[key], [edge]: Number(e.target.value) } }))
                      }
                    />
                  ))}
                </div>
              </label>
            ))}
            {(Object.keys(JOINT) as (keyof ArmPose)[]).map((key) => (
              <label key={key}>
                休止の{JOINT[key]}
                <input
                  aria-label={`休止の${JOINT[key]}`}
                  type="number"
                  value={rest[key]}
                  onChange={(e) => setRest((all) => ({ ...all, [key]: Number(e.target.value) }))}
                />
              </label>
            ))}
            <label>
              休止の手
              <select aria-label="休止の手" value={restHand} onChange={(e) => setRestHand(e.target.value as HandShape)}>
                {HAND_SHAPES.map((h) => (
                  <option key={h} value={h}>
                    {SHAPE[h]}
                  </option>
                ))}
              </select>
            </label>
          </details>
        )}
        {!rig && (
          <label className="arm-setup-check">
            <input type="checkbox" checked={legacy} onChange={(e) => setLegacy(e.target.checked)} />
            旧ArmL/Rから専用関節へ付け替える
          </label>
        )}
        {plan.warnings.map((w) => (
          <p key={w}>{w}</p>
        ))}
        {plan.errors.map((error) => (
          <p className="arm-setup-error" key={error}>
            {error}
          </p>
        ))}
        {message && <p role="status">{message}</p>}
        <button
          type="button"
          disabled={!plan.command}
          onClick={() => {
            if (plan.command) {
              dispatch(plan.command);
              setMessage('腕の設定を保存した');
            }
          }}
        >
          {rig ? '腕の設定を保存' : '専用関節を作成'}
        </button>
        {rig && (
          <>
            <button type="button" onClick={() => chooseHandle('preview')}>
              手首をドラッグして確認
            </button>
            <div className="arm-setup-buttons">
              <button
                aria-pressed={wave}
                onClick={() => {
                  setHandle('preview');
                  setWave((v) => !v);
                }}
              >
                {wave ? '手振りを停止' : '手振りを再生'}
              </button>
              <button onClick={() => preview(rig.restPose, rig.restHand)}>休止</button>
              <button onClick={() => preview({ shoulder: 65, elbow: 100, wrist: 25 }, 'open')}>手振り</button>
              <button onClick={() => preview({ shoulder: 90, elbow: 0, wrist: 0 }, 'point')}>指さし</button>
              <button onClick={() => preview({ shoulder: 140, elbow: 130, wrist: -30 }, 'peace')}>
                顔の前でピース
              </button>
              <button onClick={() => preview({ shoulder: 65, elbow: 100, wrist: 0 }, 'fist')}>グー</button>
            </div>
            <button onClick={() => dispatch(armInFront(rig.id))}>前腕・手を顔より前へ</button>
            <button
              onClick={() => {
                dispatch(releaseArmRig(rig.id));
                clearSidePreview();
              }}
            >
              関節設定を解除（素材・キーを残す）
            </button>
            {inspectArmRigs(project.model)
              .filter((i) => i.rigId === rig.id)
              .map((i, n) => (
                <p className="arm-setup-error" key={`${i.path}-${n}`}>
                  {i.message}
                </p>
              ))}
          </>
        )}
        <button
          type="button"
          onClick={() => {
            services.store.undo();
            clearSidePreview();
          }}
          disabled={!services.store.canUndo()}
        >
          元に戻す
        </button>
      </div>
    );
  };
}
