// データの形（カード02）。設計書の型をコメントも含めてそのまま定義している。
// 形を変えるときは docs/contract-changes.md に記録すること。

// ---- 基本の型 ----

export type Id = string;
export interface Vec2 {
  x: number;
  y: number;
}
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'add';
export type ParameterGroupId =
  'face' | 'eye' | 'brow' | 'mouth' | 'cheek' | 'body' | 'armL' | 'armR' | 'sway' | 'other';
export type ModeId = 'modeling' | 'animation' | 'studio';
export type UiLevel = 'easy' | 'detail';

// ---- Asset ----

export interface Asset {
  id: Id;
  path: string; // 例: assets/<id>.png
  hash: string; // png の SHA-256（16進）
  width: number;
  height: number; // トリミング後のサイズ
  offset: Vec2; // トリミング後の左上のキャンバス座標
  canvasSize: { width: number; height: number };
  source: { kind: 'psd' | 'png'; file: string; layerName?: string; layerPath?: string[]; hidden?: boolean };
  sourceBlendMode: BlendMode;
  sourceOpacity: number; // 0..1
}

// ---- Part と StandardPartType ----

export interface Part {
  id: Id;
  name: string;
  kind: 'image' | 'group';
  standardType: StandardPartType | null; // 自由パーツは null
  assetId: Id | null; // image のみ
  meshId: Id | null; // image のみ
  parentId: Id | null;
  position: Vec2; // 初期値 {x: 0, y: 0}
  rotation: number; // 度。初期値 0
  scale: Vec2; // 初期値 {x: 1, y: 1}
  pivot: Vec2; // 回転・拡縮の中心（キャンバス座標）
  opacity: number; // 0..1。パーツ自身の不透明度の基準値（不透明度のキーが無いとき・デフォルト値での値。I-026）
  blendMode: BlendMode;
  depth: number; // 奥行き。手前が正（-1..1 が目安）
  mask: { sourcePartIds: Id[]; inverted: boolean } | null;
  physicsId: Id | null;
  visible: boolean;
  locked: boolean;
}
export type StandardPartType =
  | 'face'
  | 'earL'
  | 'earR'
  | 'cheek'
  | 'eyeWhiteL'
  | 'irisL'
  | 'highlightL'
  | 'upperLidL'
  | 'lowerLidL'
  | 'eyeWholeL'
  | 'eyeWhiteR'
  | 'irisR'
  | 'highlightR'
  | 'upperLidR'
  | 'lowerLidR'
  | 'eyeWholeR'
  | 'browL'
  | 'browR'
  | 'upperLip'
  | 'lowerLip'
  | 'mouthInside'
  | 'teeth'
  | 'tongue'
  | 'mouthWhole'
  | 'frontHair'
  | 'sideHairL'
  | 'sideHairR'
  | 'backHair'
  | 'neck'
  | 'torso'
  | 'armL'
  | 'armR'
  // 変形グループ（かんたんセットアップが作る）
  | 'bodyRoot'
  | 'armRootL'
  | 'armRootR'
  | 'neckRoot'
  | 'headRoot'
  | 'faceGroup'
  | 'eyeGroupL'
  | 'eyeGroupR'
  | 'mouthGroup';

// ---- Mesh ----

export interface Mesh {
  id: Id;
  vertices: Vec2[]; // 基準状態の頂点（キャンバス座標）
  uvs: Vec2[]; // 0..1（素材画像の中の位置）
  triangles: [number, number, number][];
  density: 'light' | 'standard' | 'smooth' | 'custom';
  edited: boolean; // 手で編集したか
}

// 一本の流れ線。座標はメッシュの局所座標。reference は作成時、points は編集後。
export interface CurveGuide {
  id: Id;
  partId: Id;
  meshId: Id;
  meshSignature: string; // 頂点/面の対応が変わった線を無言で再適用しない
  reference: [Vec2, Vec2, Vec2];
  points: [Vec2, Vec2, Vec2];
  radius: number; // 影響幅（局所座標の px）
  rootFraction: number; // 頭に追従する根元の区間（0..0.5）
  gravity: boolean;
  enabled: boolean;
}

// ---- Warp ----

export interface Warp {
  id: Id;
  partId: Id; // ワープを付ける group パーツ
  columns: number;
  rows: number; // 格子の分割数
  bounds: { x: number; y: number; width: number; height: number }; // キャンバス座標
  points: Vec2[]; // (columns+1)×(rows+1) 個、行優先。基準状態の制御点
}

// ---- Parameter と ParameterGroup ----

export interface ParameterGroup {
  id: ParameterGroupId;
  name: string;
}
export interface Parameter {
  id: Id; // 標準は 'FaceAngleX' など。ユーザー定義は任意の文字列
  name: string; // 表示名
  groupId: ParameterGroupId;
  min: number;
  max: number;
  default: number;
  standard: boolean;
}

// ---- Binding と ParameterKey ----

export type Channel = 'transform' | 'vertices' | 'warpPoints';
export interface TransformDelta {
  position: Vec2;
  rotation: number;
  scale: Vec2;
  opacity: number;
}
// position・rotation は加算、scale は倍率（1 = 変化なし）。
// opacity は controlsOpacity のバインディングでだけ使い、その姿勢でのパーツ自身の不透明度（0..1 の絶対値）。
// 使わないバインディングでは 1 のまま（I-026。schemaVersion 1 では倍率だった）
export interface Binding {
  id: Id;
  target: { type: 'part' | 'mesh' | 'warp'; id: Id }; // transform → part、vertices → mesh、warpPoints → warp
  channel: Channel;
  parameterIds: Id[]; // 1 または 2
  keyValues: number[][]; // パラメータごとのキー位置（昇順。デフォルト値を必ず含む）
  keys: ParameterKey[];
  generation: 'linear' | 'depth' | 'rotate' | 'surface' | 'ease';
  divisions: number | null; // 中間キーの分割数（自動なら null）
  // transform だけ。キーの opacity でパーツ自身の不透明度を決める（省略は false。I-026）。デフォルト値のキーは
  // Part.opacity と同じ値にする。パーツ自身の不透明度 = Part.opacity + Σ（このバインディングのいまの値 − デフォルト値での値）
  // （0..1 に収める）。不透明度のバインディングが1つなら、いまの値がそのままパーツの不透明度になる
  controlsOpacity?: boolean;
}
export interface ParameterKey {
  coords: number[]; // parameterIds と同じ順の値
  delta: TransformDelta | Vec2[]; // transform は TransformDelta、それ以外は頂点・制御点ごとの差分
  source: 'manual' | 'auto' | 'generated' | 'combined';
  locked: boolean;
}

// ---- Model と Project ----

export interface Model {
  parts: Part[];
  meshes: Mesh[];
  warps: Warp[];
  drawOrder: Id[]; // 画像パーツの id。背面 → 前面
  parameters: Parameter[];
  parameterGroups: ParameterGroup[];
  bindings: Binding[];
  curveGuides?: CurveGuide[]; // 省略は空。カード99 / schemaVersion 4
  lipSync: LipSync;
  setupHints: { closedLineL: Vec2[] | null; closedLineR: Vec2[] | null }; // かんたんセットアップ用（閉じた目の線。STEP1で使う）
}
export interface Project {
  schemaVersion: number; // 現在は4（3 → 4で流れ線。旧版は開くときに移行）
  id: Id;
  name: string;
  assets: Asset[];
  model: Model;
  expressions: Expression[];
  animations: Animation[];
  physics: Physics[];
  trackingMappings: TrackingMapping[]; // カスタムの割り当ての一覧（trackingSetup.mode が custom のときに使う）
  trackingSetup: TrackingSetup; // トラッキングの割り当ての使い方と合わせ方（I-042）
  studio: { scenes: Scene[]; activeSceneId: Id | null; hotkeys: Hotkey[] };
}

// ---- Expression ----

export type BlendOp = 'override' | 'add' | 'multiply' | 'max';
export interface Expression {
  id: Id;
  name: string;
  entries: { parameterId: Id; value: number; blend: BlendOp }[];
  fadeIn: number;
  fadeOut: number; // 秒
}

// ---- LipSync ----

export interface LipSync {
  mouthSource: 'max' | 'micOnly' | 'cameraOnly';
  strength: 'low' | 'standard' | 'high';
  vowels: { vowel: 'closed' | 'a' | 'i' | 'u' | 'e' | 'o'; values: Record<Id, number> }[]; // STEP2で使う
}

// ---- Animation ----

export interface Animation {
  id: Id;
  name: string;
  duration: number; // 秒
  speed: number;
  loop: boolean;
  periodic: boolean; // 周期アニメーションか
  tracks: { parameterId: Id; keyframes: { time: number; value: number; curve: 'linear' | 'smooth' | 'step' }[] }[];
  affectedGroups: ParameterGroupId[]; // 空なら自動（トラックのあるグループ）
  restart: 'restart' | 'ignore';
  transition: {
    preset: 'auto' | 'quick' | 'natural' | 'slow' | 'custom';
    blendIn: number;
    blendOut: number; // 秒
    curve: 'linear' | 'smooth';
    blendMode: 'override' | 'addToTracking';
    keepLipSync: boolean;
    keepPhysics: boolean;
    returnToTracking: boolean;
  };
}

// ---- Physics ----

export interface Physics {
  id: Id;
  partId: Id; // 根元の位置はこのパーツの pivot
  preset: 'hair' | 'cloth' | 'ribbon' | 'accessory';
  strength: number; // 0..1（かんたん設定の「揺れ方」）
  direction: 'horizontal' | 'vertical' | 'both';
  length: number; // px
  spring: number;
  damping: number;
  gravity: number;
  inertia: number;
  range: number;
  inputs: { parameterId: Id; weight: number }[];
  outputParameterId: Id;
}

// ---- TrackingMapping ----

export type TrackingInput =
  | 'faceYaw'
  | 'facePitch'
  | 'faceRoll'
  | 'eyeOpenL'
  | 'eyeOpenR'
  | 'eyeBallX'
  | 'eyeBallY'
  | 'mouthOpen'
  | 'mouthForm'
  | 'mouthWidth'
  | 'browY';
export interface TrackingMapping {
  input: TrackingInput;
  parameterId: Id;
  inputRange: [number, number];
  outputRange: [number, number];
  invert: boolean;
  curve: 'linear' | 'smooth';
  smoothing: number; // 0..1
  deadZone: number; // 入力の単位
  weight: number; // 0 以上。同じパラメータへの割り当てを「加算」「重み付き平均」で合わせるときの重み（I-042）
}
// 同じパラメータに複数の割り当てがあるときの合わせ方（I-042）。add = 重み × 値の和、average = 重みで平均、
// priority = 一覧で上にある割り当て（そのフレームに入力が無ければ次の割り当て）
export type TrackingCombineMethod = 'add' | 'average' | 'priority';
export interface TrackingSetup {
  // standard = 既定のマッピング、custom = Project.trackingMappings の一覧（空なら何も動かさない）、
  // off = トラッキングでパラメータを動かさない（自動まばたきは目のトラッキングの設定のまま）
  mode: 'standard' | 'custom' | 'off';
  combine: { parameterId: Id; method: TrackingCombineMethod }[]; // 一覧に無いパラメータは add
}

// ---- Scene と Hotkey ----

export interface Scene {
  id: Id;
  name: string;
  background: { type: 'transparent' } | { type: 'color'; color: string } | { type: 'image'; path: string }; // path はプロジェクトからの相対パス
  modelTransform: { position: Vec2; scale: number }; // 出力画面での位置（px）と倍率
  expressionIds: Id[]; // シーンに切り替えたときに適用する表情
  periodicAnimationIds: Id[]; // STEP2で使う
}
export interface Hotkey {
  id: Id;
  keys: string; // 例: 'Ctrl+Shift+1'
  action: 'expression' | 'scene' | 'background' | 'animation' | 'parameter' | 'pauseTracking' | 'recalibrate';
  targetId: Id | null;
  mode: 'toggle' | 'hold';
}

// ---- Environment（PCごとの設定でプロジェクトの外に保存） ----

export interface Environment {
  cameraDeviceId: string | null;
  cameraCapture: { mode: 'auto' | 'manual'; width: number; height: number; fps: number };
  mirror: boolean;
  calibration: {
    neutral: { yaw: number; pitch: number; roll: number };
    eyeClosed: { l: number; r: number };
    mouthOpenMax: number;
  } | null;
  microphoneDeviceId: string | null;
  silenceThreshold: number; // dBFS
  trackingPreset: 'stable' | 'standard' | 'large' | 'custom';
  eyeTracking: boolean;
  autoBlink: boolean; // 目の値がカメラから来ていない間の自動まばたき（STEP3 のカード65）
  trackingCustom: { minCutoff: number; beta: number; gain: number; deadZone: number };
  bodyFollowStrength: 'low' | 'standard' | 'high';
  expressionMode: 'stack' | 'single';
  // adapterId: Spout2 で描く GPU（アダプターの識別子）。null は自動（既定のアダプター）。STEP3 のカード65
  output: { method: 'window' | 'spout2'; width: number; height: number; fps: number; adapterId: string | null };
  uiLevel: Record<ModeId, UiLevel>;
  lastProjectDir: string | null;
}
