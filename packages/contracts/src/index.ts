// 実行時の契約（カード03、STEP1 の追加はカード26、STEP2 の追加はカード45）。設計書のインターフェースをそのまま定義している。
// 形を変えるときは docs/contract-changes.md に記録すること。
import type {
  Asset,
  BlendMode,
  BlendOp,
  Binding,
  CurveGuideDynamics,
  Environment,
  Hotkey,
  ModeId,
  Model,
  Parameter,
  Project,
  TransformDelta,
  UiLevel,
  Vec2,
} from '@app/schema';

// ---- 評価の契約 ----

export type ParamValues = Record<string, number>;
export interface TargetDeltas {
  transforms: Record<string, TransformDelta>; // partId → 合成済みの差分（opacity は使わない。1 のまま）
  vertices: Record<string, Float32Array>; // meshId → [dx0, dy0, dx1, dy1, ...]
  warpPoints: Record<string, Float32Array>; // warpId → 制御点の差分（同じ並び）
  // partId → パーツ自身の不透明度（0..1。親は掛けていない）。不透明度のバインディング（controlsOpacity）があるパーツだけ。
  // 無いパーツは Part.opacity（I-026）
  opacities?: Record<string, number>;
}
export interface BindingEvaluator {
  evaluate(model: Model, params: ParamValues): TargetDeltas;
}

// ---- 変形の契約 ----

export interface DrawItem {
  partId: string;
  assetId: string;
  positions: Float32Array; // 変形後の頂点（キャンバス座標）[x0, y0, x1, y1, ...]
  uvs: Float32Array; // [u0, v0, ...]（0..1）
  indices: Uint32Array;
  opacity: number; // 親まで掛けた最終値
  blendMode: BlendMode;
  mask: { sourcePartIds: string[]; inverted: boolean } | null;
}
export interface DeformedModel {
  items: DrawItem[]; // 描画順（背面 → 前面）。非表示のパーツは含めない
  byPartId: Record<string, DrawItem>;
  curveGuides?: Record<string, CurveGuideResult>;
}
export interface CurveGuideResult {
  curve: Vec2[];
  handles: Vec2[]; // 根元・中間・毛先の表示位置
  status: 'ok' | 'limited' | 'stale' | 'disabled';
  strength: number; // 三角形の破綻を避けて適用した割合
  dynamics?: { status: 'disabled' | 'settled' | 'running' | 'frozen'; reason?: string };
  collision?: {
    status: 'disabled' | 'ok' | 'limited' | 'unresolved';
    reason?: string;
    diagnostics?: { colliderId: string; reason: string }[];
  };
}
export interface DeformPipeline {
  deform(model: Model, deltas: TargetDeltas): DeformedModel;
}
export interface HairFrameContext {
  now: number;
  dt: number;
  frameId: string | number;
  active: boolean;
}
export interface HairContact {
  id: string;
  points: Vec2[];
  radius: number;
}
export interface HairContacts {
  colliders: HairContact[];
  radius: number;
  margin?: number;
}
export interface HairDynamicsSession {
  readonly epoch: number;
  reset(): void;
  retain(projectId: string, ids: string[]): void;
  discard(id: string): void;
  reject(id: string): void;
  accept(id: string, curve: Vec2[], along: number[]): void;
  previousContacts(id: string): { curve: Vec2[]; contacts: HairContacts } | undefined;
  advance(
    id: string,
    rest: Vec2[],
    along: number[],
    rootFraction: number,
    settings: CurveGuideDynamics,
    fingerprint: string,
    axisKey: string,
    frame: HairFrameContext,
    contacts?: HairContacts,
  ): { curve: Vec2[]; status: 'running' | 'settled' | 'frozen'; reason?: string; collisionUnresolved?: boolean };
}
export interface HairFrameEvaluator {
  evaluate(
    project: Project,
    params: ParamValues,
    context?: HairFrameContext,
    session?: HairDynamicsSession,
  ): DeformedModel;
}

// ---- 合成の契約 ----

// 層。値の出どころごとに分ける（STEP3 のカード65・CC-010）: tracking はカメラから来た値だけ、auto はプログラムが作る値
// （自動まばたき）、hotkey はホットキーのパラメータの上書き（表情の後・アニメーションの前）
export type LayerId =
  'tracking' | 'auto' | 'bodyFollow' | 'expression' | 'hotkey' | 'animation' | 'lipSync' | 'periodic' | 'physics';
export const LAYER_ORDER: LayerId[] = [
  'tracking',
  'auto',
  'bodyFollow',
  'expression',
  'hotkey',
  'animation',
  'lipSync',
  'periodic',
  'physics',
];
export interface Layer {
  id: LayerId;
  weight: number; // 0..1
  parameterWeights?: Record<string, number>; // 指定したパラメータは weight の代わりにこの重みを使う（0..1）
  values: ParamValues; // このレイヤーが担当するパラメータの値だけ
  blend?: Record<string, BlendOp>; // パラメータごとの合成方法。無ければ override
}
export interface ParameterMixer {
  mix(parameters: Parameter[], layers: Layer[]): ParamValues;
}

// スタジオの1フレームの文脈。producer は LAYER_ORDER の順に呼ばれる
export interface FrameContext {
  now: number;
  dt: number; // ミリ秒
  project: Project;
  mixedSoFar: ParamValues; // それまでのレイヤーを合成した値
  // それまでのレイヤーそのもの（合成する前の値と重み。順に並ぶ）。実行部は必ず渡す。省いたら空として扱う（CC-010）
  layersSoFar?: readonly Layer[];
  flags: { lipSyncWeight: number; physicsActive: boolean }; // 前のレイヤーが後のレイヤーへ伝える値（初期値 1・true）
}
export interface LayerProducer {
  id: LayerId;
  // STEP2（カード45）から複数のレイヤーを返せる。同じ id のレイヤーは配列の順に合成する
  produce(ctx: FrameContext): Layer | Layer[] | null;
}

// ---- 描画の契約 ----

export type Background =
  { type: 'transparent' } | { type: 'color'; color: string } | { type: 'image'; image: ImageBitmap };
export interface ViewTransform {
  scale: number;
  offset: Vec2;
} // 画面座標（CSSピクセル）= キャンバス座標 × scale + offset
export interface Renderer {
  init(canvas: HTMLCanvasElement): void;
  setTextures(images: Record<string, ImageBitmap>): void; // assetId → 画像
  render(model: DeformedModel, view: ViewTransform, background: Background): void;
  dispose(): void;
}

// ---- ストアの契約 ----

export interface Command {
  label: string;
  apply(project: Project): Project;
} // 純粋関数
export interface ProjectStore {
  get(): Project;
  subscribe(listener: (project: Project) => void): () => void;
  dispatch(command: Command): void; // 1回の Undo 単位
  transaction(label: string, run: (dispatch: (c: Command) => void) => void): void; // まとめて1回の Undo
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  load(project: Project): void; // 履歴を消して置き換える
}
export interface EditorState {
  mode: ModeId;
  uiLevel: Record<ModeId, UiLevel>;
  selectedPartIds: string[];
  activeParameterIds: string[]; // 編集中のパラメータ（0〜2個）
  editorParamValues: ParamValues; // モデリング中のプレビュー値（無いパラメータはデフォルト値）
}
export interface EditorStore {
  get(): EditorState;
  set(patch: Partial<EditorState>): void;
  subscribe(l: (s: EditorState) => void): () => void;
}

// ---- 素材の置き場の契約 ----

export interface AssetRepository {
  put(assetId: string, png: Uint8Array): Promise<void>; // 画像も作って保持する
  getPng(assetId: string): Uint8Array | undefined;
  getImage(assetId: string): ImageBitmap | undefined;
  getImageData(assetId: string): ImageData | undefined; // メッシュ生成などに使う
  all(): Record<string, Uint8Array>;
  subscribe(listener: () => void): () => void;
}
export { createAssetRepository } from './assets'; // 本物の実装

// ---- 取り込み・保存の契約 ----

export interface FileSystem {
  // パスは / 区切りの絶対パス
  readText(path: string): Promise<string>;
  writeText(path: string, data: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}
export interface ImportedAsset {
  asset: Asset;
  png: Uint8Array;
} // png はトリミング済み
export interface ImportWarning {
  kind: 'canvasMismatch' | 'noTransparency' | 'resolution' | 'needsMerge';
  assetIds: string[];
  layerNames: string[];
  message: string;
}
export interface Importer {
  importFiles(
    files: { name: string; data: Uint8Array }[],
  ): Promise<{ assets: ImportedAsset[]; warnings: ImportWarning[] }>;
}
// 開いたときに分かったこと・直したこと（STEP3 のカード58。CC-009）
export interface LoadReport {
  missingAssetIds: string[]; // ファイルが無く、透明な画像の代わりで開いた素材
  changedAssetIds: string[]; // 記録のハッシュと違う素材（外で書き換えられた。そのまま読んだ）
  repairs: string[]; // 開くときに直したこと（人に見せる文）
  openedFromTmp: boolean; // project.json が無く、保存の途中の project.json.tmp から開いた（保存すると戻る）
}
export interface LoadedProject {
  project: Project;
  assetPngs: Record<string, Uint8Array>;
  report: LoadReport;
}
export interface SaveOptions {
  skipAssetIds?: string[]; // 書かずに欠けたままにする素材（開いたときに欠けていて、まだ差し替えていないもの）
}
export interface ProjectIO {
  save(dir: string, project: Project, assetPngs: Record<string, Uint8Array>, options?: SaveOptions): Promise<void>;
  load(dir: string): Promise<LoadedProject>;
}
export function emptyLoadReport(): LoadReport {
  return { missingAssetIds: [], changedAssetIds: [], repairs: [], openedFromTmp: false };
}
export interface AutoSaver {
  start(dir: string): void;
  stop(): void;
  findRecoverable(dir: string): Promise<string | null>;
}

// ---- メッシュ生成の契約 ----

export interface MeshGenerator {
  generate(
    alpha: ImageData,
    offset: Vec2,
    density: 'light' | 'standard' | 'smooth',
  ): { vertices: Vec2[]; uvs: Vec2[]; triangles: [number, number, number][] }; // 頂点はキャンバス座標
}

// ---- 生成・セットアップの契約 ----

export interface KeyGenerator {
  linear(binding: Binding, divisions?: number): Binding;
  depthParallax(model: Model, parameterId: 'FaceAngleX' | 'FaceAngleY'): Binding[]; // 作り直した transform バインディング
  // ここから STEP1（カード26）
  rotate(binding: Binding, model: Model): Binding; // 頂点・制御点をピボット中心の円弧で補間
  surface(binding: Binding, model: Model): Binding; // ワープの制御点を球面に沿って生成
  ease(binding: Binding): Binding; // 中間キーの値をゆるやかに
  regenerate(binding: Binding, model: Model, range?: [number, number]): Binding; // ロックされたキーを残して作り直す
}
export interface AutoSetup {
  plan(project: Project): { command: Command; warnings: string[] };
}

// ---- キー編集の契約 ----

export type TransformChange = {
  dPosition?: Vec2;
  dRotation?: number;
  scaleFactor?: Vec2;
  // パーツ自身の不透明度（0..1。親は掛けない）をいまの値でこの値にする（I-026）。基準状態では Part.opacity
  // （不透明度のバインディングのデフォルト値のキーも同じ値にする）、パラメータの編集中はそのバインディングのキー
  // （不透明度のバインディングにして、ほかの不透明度のバインディングの分を除いた値を記録する）
  opacity?: number;
  dPivot?: Vec2;
};
export type PointsTarget = { kind: 'mesh'; meshId: string } | { kind: 'warp'; warpId: string };
export interface KeyEditor {
  // EditorState の activeParameterIds と editorParamValues に応じて、基準状態かキーを変えるコマンドを返す
  transformEdit(
    project: Project,
    editor: EditorState,
    partIds: string[],
    change: TransformChange,
  ): Command | 'needsKey';
  pointsEdit(
    project: Project,
    editor: EditorState,
    target: PointsTarget,
    moves: { index: number; d: Vec2 }[],
  ): Command | 'needsKey';
  addKeyAtCurrentValue(project: Project, editor: EditorState, target: { partId: string } | PointsTarget): Command;
}

// ---- トラッキングの契約 ----

export interface TrackingFrame {
  time: number; // ミリ秒（performance.now）
  detected: boolean;
  faceYaw: number; // 度。ユーザーが自分の右を向くと正
  facePitch: number; // 度。上を向くと正
  faceRoll: number; // 度。ユーザーが自分の右へ傾けると正
  eyeOpenL: number;
  eyeOpenR: number; // 0..1。ユーザー自身の左目・右目
  eyeBallX: number; // -1..1。ユーザーが自分の右を見ると正
  eyeBallY: number; // -1..1。上を見ると正
  mouthOpen: number; // 0..1
  // ここから STEP1（カード26）の任意の項目。推定できないときは undefined
  mouthForm?: number; // -1..1（への字〜笑顔）
  mouthWidth?: number; // -1..1（すぼめ〜横に開く）
  browY?: number; // -1..1（下げる〜上げる）
}
export interface CameraCaptureStats {
  mode: Environment['cameraCapture']['mode'];
  state: 'selecting' | 'ready' | 'error';
  width: number;
  height: number;
  requestedFps: number;
  nominalFps: number | null;
  maxFps: number | null;
  cameraFps: number | null;
  trackingFps: number | null;
  warning: string | null;
}
export interface TrackingSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  configureCapture(settings: Environment['cameraCapture']): void;
  captureStats(): CameraCaptureStats | null;
  onCaptureStats(listener: () => void): () => void;
  start(deviceId?: string): Promise<void>;
  stop(): void;
  onFrame(listener: (frame: TrackingFrame) => void): () => void;
}
export interface TrackingLayerProducer {
  update(frame: TrackingFrame): void;
  tick(now: number): Layer; // id 'tracking'
  status(): 'tracking' | 'lost';
  setMirror(on: boolean): void;
  setLostBehavior(b: 'returnToFront' | 'hold'): void;
  // ここから STEP1（カード26）
  setCalibration(c: Environment['calibration']): void;
  setPreset(
    p: 'stable' | 'standard' | 'large' | 'custom',
    custom?: { minCutoff: number; beta: number; gain: number; deadZone: number },
  ): void;
  setEyeTracking(on: boolean): void; // off のときと外れたときは AutoBlink の値を使う
}

// ---- 音声・リップシンクの契約（STEP1） ----

export interface AudioLevel {
  time: number;
  rmsDb: number;
}
export interface AudioSource {
  listDevices(): Promise<{ id: string; label: string }[]>;
  start(deviceId?: string): Promise<void>;
  stop(): void;
  onLevel(listener: (x: AudioLevel) => void): () => void; // 10ms ごと
  onSamples(listener: (samples: Float32Array, sampleRate: number, time: number) => void): () => void;
}
export interface LipSyncProducer extends LayerProducer {
  // id 'lipSync'
  configure(o: {
    mouthSource: 'max' | 'micOnly' | 'cameraOnly';
    strength: 'low' | 'standard' | 'high';
    silenceThresholdDb: number;
  }): void;
  update(level: AudioLevel): void;
}

// ---- 自動の動き・表情の契約（STEP1） ----

export interface AutoBlink {
  tick(now: number): { EyeOpenL: number; EyeOpenR: number };
}
export interface BodyFollowProducer extends LayerProducer {
  // id 'bodyFollow'
  setStrength(s: 'low' | 'standard' | 'high'): void;
}
export interface ExpressionController extends LayerProducer {
  // id 'expression'
  apply(expressionId: string | null, now: number): void; // null で解除。STEP1では1つだけ
  active(): string | null;
  // ここから STEP2（カード45）。複数の同時適用
  toggle(expressionId: string, now: number): void;
  actives(): string[]; // 適用した順
  hold(ownerId: string, expressionId: string | null, mode: 'stack' | 'single', now: number): void;
  release(ownerId: string, now: number): void;
}

// ---- キャリブレーション・ホットキー・出力の契約（STEP1） ----

export type CalibrationStep = 'neutral' | 'eyesClosed' | 'mouthOpen';
export interface CalibrationService {
  capture(step: CalibrationStep, frames: TrackingFrame[]): void;
  result(): Environment['calibration'];
  reset(): void;
}
export interface HotkeyService {
  register(hotkey: Hotkey, handler: (phase: 'down' | 'up') => void): Promise<'ok' | 'conflict'>;
  unregisterAll(): Promise<void>;
}
export interface OutputSink {
  start(o: { width: number; height: number; fps: number }): Promise<void>;
  setTextures(pngs: Record<string, Uint8Array>): Promise<void>;
  submit(model: DeformedModel, view: ViewTransform, background: Background): void;
  stop(): Promise<void>;
}

// ---- アニメーション・周期アニメーション・物理・母音の契約（STEP2） ----

export interface AnimationPlayer extends LayerProducer {
  // id 'animation'。ctx.flags を設定する
  play(animationId: string, now: number): void;
  stop(animationId: string, now: number): void;
  stopAll(now: number): void;
  playing(): string[];
}
export interface PeriodicPlayer extends LayerProducer {
  // id 'periodic'
  setActive(animationIds: string[]): void;
}
export interface PhysicsEngine extends LayerProducer {
  // id 'physics'
  reset(): void;
}
export interface VowelEstimator {
  estimate(
    samples: Float32Array,
    sampleRate: number,
  ): { closed: number; a: number; i: number; u: number; e: number; o: number }; // 合計 1
}

// ---- サービスのまとめ ----

export interface Services {
  store: ProjectStore;
  editor: EditorStore;
  assets: AssetRepository;
  fs: FileSystem;
  evaluator: BindingEvaluator;
  pipeline: DeformPipeline;
  mixer: ParameterMixer;
  createRenderer(): Renderer;
  meshGenerator: MeshGenerator;
  keyGenerator: KeyGenerator;
  autoSetup: AutoSetup;
  keyEditor: KeyEditor;
  importer: Importer;
  io: ProjectIO;
  autoSaver: AutoSaver;
  tracking: TrackingSource;
  trackingLayer: TrackingLayerProducer;
  // ここから STEP1（カード26）
  audio: AudioSource;
  lipSync: LipSyncProducer;
  autoBlink: AutoBlink;
  bodyFollow: BodyFollowProducer;
  expressions: ExpressionController;
  calibration: CalibrationService;
  hotkeys: HotkeyService;
  spout: OutputSink;
  // ここから STEP2（カード45）
  animations: AnimationPlayer;
  periodic: PeriodicPlayer;
  physics: PhysicsEngine;
  vowels: VowelEstimator;
}

// ---- 仮実装 ----

export * from './fakes';
export { createExpressionSelection } from './expressionSelection';
