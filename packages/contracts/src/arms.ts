import type {
  ArmCalibration,
  ArmLimits,
  ArmPose,
  ArmRig,
  ArmRigIssue,
  ArmSide,
  ArmTrackingSettings,
  HandShape,
  Model,
  Vec2,
} from '@app/schema';
import type { Layer, ParamValues } from './index';

// AT-03。時刻は全てページの単調時計のms。WorkerはtimeOriginの差を補正する。
export interface BodySampleTime {
  generation: number; // 停止・再開・設定変更ごとに増やす
  frameId: number;
  capturedAt: number;
  captureSource: 'captureTime' | 'callback';
  completedAt: number;
  receivedAt: number;
}
export interface BodyPoint extends Vec2 {
  z: number;
}
export interface PosePoint extends BodyPoint {
  visibility: number;
} // presenceは無い
export interface PoseObservation {
  landmarks: PosePoint[]; // 未反転の画像0..1、通常33点。未検出は空
  worldLandmarks: BodyPoint[]; // 腰原点のm。手の世界座標と足し合わせない
}
export interface HandObservation {
  landmarks: BodyPoint[]; // 通常21点。visibility/confidenceを捏造しない
  worldLandmarks: BodyPoint[]; // 手原点のm。無いときは空
  handedness: { side: 'left' | 'right'; score: number } | null; // 所属の正解ではなく候補
  gesture: { name: string; score: number } | null;
}
export interface BodySample<T> {
  time: BodySampleTime;
  value: T;
}
// nullはこの通知で更新無し、空配列は推定済み・未検出。Poseと手の別通知を結合しない。
export type BodyTrackingFrame = {
  image: { width: number; height: number }; // 推定器への入力。ミラー無し
} & (
  | { pose: BodySample<PoseObservation>; hands: BodySample<HandObservation[]> | null }
  | { pose: null; hands: BodySample<HandObservation[]> }
);
export type BodyFeatureState = 'off' | 'loading' | 'ready' | 'unavailable' | 'error';
export interface BodyTrackingConfig {
  enabled: boolean;
  mode: 'normal' | 'light';
  hands: boolean;
}
export interface BodyTrackingStatus {
  generation: number;
  pose: { state: BodyFeatureState; delegate: 'GPU' | 'CPU' | null; reason: string | null };
  hands: { state: BodyFeatureState; delegate: 'GPU' | 'CPU' | null; reason: string | null };
  poseFps: number | null;
  handFps: number | null;
  droppedFrames: number;
  staleResults: number;
}
// TrackingSource.bodyが無ければ非対応。カメラを別に開くstartメソッドは持たない。
export interface BodyTrackingCapability {
  configure(config: BodyTrackingConfig): void;
  status(): BodyTrackingStatus;
  onFrame(listener: (frame: BodyTrackingFrame) => void): () => void;
  onStatus(listener: () => void): () => void;
}

export type ObservationValidity = 'valid' | 'inferred' | 'missing' | 'ambiguous';
export interface ObservedPoint {
  position: Vec2 | null;
  validity: ObservationValidity;
}
export interface AssociatedHand {
  time: BodySampleTime;
  validity: ObservationValidity;
  // AT-05で縦横比・ミラーを1回適用済み。肩原点、xはモデルの外側が正、yは下。
  landmarks: BodyPoint[];
  worldLandmarks: BodyPoint[]; // 指の角度だけに使う手原点のm。画像座標と合算不可
  gesture: HandObservation['gesture'];
}
export interface ArmObservation {
  side: ArmSide; // AT-05でミラー割当済み。coreで左右を再反転しない
  actorSide: 'left' | 'right';
  time: BodySampleTime;
  validity: ObservationValidity;
  // 校正した演者の上腕+前腕長を1とする。肩原点、外側+x、下+y。
  elbow: ObservedPoint;
  wrist: ObservedPoint;
}
export interface NormalizedBodyFrame {
  generation: number;
  arms: Partial<Record<ArmSide, ArmObservation>>; // 無い側は更新無し、missingはロスト観測
  hands: Partial<Record<ArmSide, AssociatedHand>>;
}
export interface BodyAssociation {
  configure(options: { mirror: boolean; calibration: ArmCalibration | null }): void;
  update(frame: BodyTrackingFrame): NormalizedBodyFrame;
  reset(generation: number): void;
}
export interface HandShapeCandidate {
  shape: HandShape | null;
  score: number;
  palmAxis: Vec2 | null; // 正規化した肩空間。軸が潰れたらnull
}
export interface HandShapeResult {
  side: ArmSide;
  time: BodySampleTime; // 最後の実観測。tickで鮮度を更新しない
  candidate: HandShapeCandidate;
  confirmed: HandShape | null;
  confirmedAt: number | null; // 確定形を最後に有効に観測した撮影時刻。unknownで更新しない
  axisObservedAt: number | null; // 掌軸を最後に有効に観測した撮影時刻
  pointDirection?: Vec2 | null; // AT-07の追加観測。候補が指さしでない・潰れたらnull
  validity: ObservationValidity;
}
// 候補の約120ms安定はAT-07。長期ロスト・休止形への復帰はAT-09。
export interface HandShapeTracker {
  update(side: ArmSide, hand: AssociatedHand): HandShapeResult;
  reset(generation: number): void;
}
export const ARM_TIMING = Object.freeze({
  resultMaxAgeMs: 250,
  holdMs: 200,
  returnMs: 500,
  recoverMs: 200,
  shapeStableMs: 120,
  shapeHoldMs: 500,
  maxTickDtMs: 50,
});
export type ArmLimitReason =
  'shoulder' | 'elbow' | 'wrist' | 'forearm' | 'hand' | 'unreachable' | 'invalid-input' | 'invalid-rig';
export interface ArmIKInput {
  rig: ArmRig;
  wrist: Vec2; // 未変形モデルpx、肩を原点とし外側+x・下+y
  elbow: Vec2 | null;
  wristAngle: number | null; // 前腕からの相対角。nullはprevious又はrest
  previous: ArmPose | null;
}
export interface ArmIKResult {
  valid: boolean; // falseなら幾何を適用しない。invalid-rigを理由に返す
  pose: ArmPose;
  elbow: Vec2;
  wrist: Vec2; // 入力と同じ座標
  wristError: number;
  reasons: ArmLimitReason[];
}
export type ArmIKSolver = (input: ArmIKInput) => ArmIKResult;
export type ArmConstraint = (pose: ArmPose, limits: ArmLimits, bendSign: 1 | -1, fallback: ArmPose) => ArmPose;
export type ArmFollowState =
  'off' | 'tracking' | 'inferred' | 'holding' | 'returning' | 'rest' | 'recovering' | 'unavailable';
export interface ArmMotionStatus {
  state: ArmFollowState;
  handState: 'tracking' | 'holding' | 'rest' | 'fixed';
  pose: ArmPose | null;
  hand: HandShape | null;
  reasons: ArmLimitReason[];
}
export interface ArmMotionInput {
  body: NormalizedBodyFrame;
  shapes: Partial<Record<ArmSide, HandShapeResult>>;
}
export interface ArmMotionSession {
  configure(model: Model, settings: ArmTrackingSettings): void;
  update(input: ArmMotionInput): void;
  tick(now: number): Layer | null; // tracking層。値自体を休止へ戻す、顔のweightは参照しない
  reset(generation: number, displayed?: ParamValues): void; // フィルタを消す。現在の合成姿勢を復帰の始点にできる
  status(): Record<ArmSide, ArmMotionStatus>;
}
export interface ArmJointDelta {
  partId: string;
  pivot: Vec2;
  rotation: number;
}
export interface ArmRigEvaluation {
  // 合成後の値に最終制約を適用し、基準画像からの回転差分を子→親へ1度だけ適用する。
  joints: ArmJointDelta[];
  // 手形の接続位置/方向を基準手首へ合わせる正の等倍率1の剛体変換。AT-08が算出。
  hands: { partIds: string[]; from: Vec2; to: Vec2; rotation: number }[];
  opacityGates: Record<string, 0 | 1>; // 既存のvisible/opacityと乗算。保存値は変更しない
  poses: Partial<Record<ArmSide, ArmPose>>;
  issues: ArmRigIssue[];
}
export type ArmRigEvaluator = (model: Model, values: ParamValues) => ArmRigEvaluation;
export type ArmCalibrationStep = 'neutral' | 'bend' | 'left' | 'right';
export interface ArmServiceStatus {
  available: boolean;
  reason: string | null;
  tracking: BodyTrackingStatus;
  motion: Record<ArmSide, ArmMotionStatus>;
  calibration: {
    state: 'empty' | 'capturing' | 'ready' | 'invalid';
    step: ArmCalibrationStep | null;
    reason: string | null;
  };
  rigIssues: ArmRigIssue[];
}
// AT-11はこのUI契約と仮実装で開発。Project/Environmentへの保存と本物の配線はAT-12。
export interface ArmService {
  settings(): ArmTrackingSettings;
  status(): ArmServiceStatus;
  subscribe(listener: () => void): () => void;
  setSettings(settings: ArmTrackingSettings): void;
  captureCalibration(step: ArmCalibrationStep): Promise<void>;
  clearCalibration(): void;
  cancelCalibration(): void; // 途中の記録を捨て、以前の校正を保持する
  calibration(): ArmCalibration | null;
  diagnostics(): ArmDiagnostics | null;
  onDiagnostics(listener: () => void): () => void;
}

export type ArmActorSide = 'left' | 'right';
export interface ArmDiagnosticPoint extends Vec2 {
  visibility: number;
}
export interface ArmSideDiagnostics {
  actorSide: ArmActorSide;
  validity: ObservationValidity;
  elbow: Vec2 | null; // 採用済み、肩原点・腕長1・外向き+x・下+y
  wrist: Vec2 | null;
  target: Vec2 | null; // 肩原点の未変形モデルpx
  actual: Vec2 | null; // 同じ空間
  reasons: ArmLimitReason[];
}
export interface ArmDiagnostics {
  time: number; // 診断の元の撮影時刻。再通知で更新しない
  image: { width: number; height: number };
  pose: Record<
    ArmActorSide,
    { shoulder: ArmDiagnosticPoint | null; elbow: ArmDiagnosticPoint | null; wrist: ArmDiagnosticPoint | null }
  > | null;
  hands: Vec2[]; // 未反転の画像の0..1の手首
  sides: Partial<Record<ArmSide, ArmSideDiagnostics>>;
}
