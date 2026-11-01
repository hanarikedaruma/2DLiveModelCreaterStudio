// ページと推定 Worker の間のメッセージ。
// 時刻はすべてページ（メインスレッド）の performance.now() の ms。Worker の performance.now() は起点が違うので、
// Worker 側で timeOrigin の差を足してから送る（toPageTime）。

export type Delegate = 'GPU' | 'CPU';
export type PoseModel = 'lite' | 'full';

export interface WorkerConfig {
  delegate: Delegate; // 最初に試す方。GPU が失敗したら CPU で作り直す（fallback が true のとき）
  fallback: boolean;
  poseModel: PoseModel;
  pose: boolean;
  hands: boolean;
  handIntervalMs: number; // 0 なら毎フレーム。軽量案は 1000/15
  splitPost: boolean; // Pose の結果を手の推定の前に送る（腕の遅れを手の推定に引きずらせない）
  urls: { wasmLoader: string; wasmBinary: string; pose: string; gesture: string };
  simulate?: 'gpu-fail' | 'gesture-fail' | undefined; // 異常系の再現（試作だけ）
  // false は見張りで止めずに記録だけする（ネットワーク層の確認用。外へ出ないプロキシと名前解決の設定と組み合わせる）
  netGuard?: boolean | undefined;
}

export interface InitMessage {
  type: 'init';
  config: WorkerConfig;
  pageTimeOrigin: number;
}

// 画像は所有権ごと渡す。Worker が処理後か、新しい待ちで置き換えたときに close() する
export interface FrameMessage {
  type: 'frame';
  id: number;
  generation: number;
  captureTime: number;
  sentAt: number;
  image: VideoFrame | ImageBitmap;
}

export interface StopMessage {
  type: 'stop';
}

export interface ProbeMessage {
  type: 'probe';
}

// 決して解決されない名前（.invalid）へ fetch して、通信がどこで止まるかを見る
export interface NetcheckMessage {
  type: 'netcheck';
}

export type ToWorker = InitMessage | FrameMessage | StopMessage | ProbeMessage | NetcheckMessage;

// 推定器ごとの準備の結果
export interface TaskStatus {
  name: 'pose' | 'gesture';
  delegate: Delegate | null; // 実際に動いた方。null は使えない
  loadMs: number;
  errors: string[];
}

export interface ReadyMessage {
  type: 'ready';
  tasks: TaskStatus[];
  offscreenCanvas: boolean;
  webgl2: boolean;
}

// 点は [x, y, z, visibility] を並べた配列。SDK が返す項目だけを入れる（無い項目を作らない）
export interface HandObservation {
  handedness: { categoryName: string; score: number; index: number } | null; // SDK の左右候補（正解ではない）
  gestures: { categoryName: string; score: number }[];
  landmarks: number[]; // 21 点 × [x, y, z, visibility]（正規化画像座標）
  world: number[]; // 21 点 × [x, y, z, visibility]（手基準の m）
}

export interface BodyResult {
  type: 'result';
  id: number;
  generation: number;
  captureTime: number;
  sentAt: number;
  receivedAt: number;
  poseStart: number | null;
  poseEnd: number | null;
  handStart: number | null;
  handEnd: number | null;
  postedAt: number;
  width: number;
  height: number;
  pose: { landmarks: number[]; world: number[] } | null; // null は推定していない。landmarks が空なら見つからなかった
  hands: HandObservation[] | null; // null は推定していない（軽量案で間引いた、または Pose だけを先に送った）
  final: boolean; // このフレームの最後の結果（Pose を先に送ったときは手の結果が最後）
  dropped: number; // 待ちを新しいフレームで置き換えた累計
  errors: string[];
}

// 最初の結果で SDK の実際の項目名を報告する（型に書かれていても値が入らない項目を見分ける）
export interface ShapeMessage {
  type: 'shape';
  task: 'pose' | 'gesture';
  keys: Record<string, string[]>;
  visibility: { min: number; max: number; count: number };
}

// 外部への通信の試み。Worker の fetch を見張り、ページの外への送信は止めて記録する
export interface NetMessage {
  type: 'net';
  url: string;
  method: string;
  at: number;
  blocked: boolean;
}

// CSP が Worker に効いているか。送り先の無い 127.0.0.1:9 へ fetch して、CSP の違反になるかを見る
export interface ProbeResult {
  type: 'probe';
  violated: boolean;
  directive: string | null;
  error: string | null;
}

export interface ErrorMessage {
  type: 'error';
  stage: string;
  message: string;
}

export interface NetcheckResult {
  type: 'netcheck';
  url: string;
  error: string | null;
}

export type FromWorker =
  ReadyMessage | BodyResult | ShapeMessage | NetMessage | ProbeResult | NetcheckResult | ErrorMessage;

// Pose の点の番号（演者自身の左右。MediaPipe の命名）
export const POSE = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftIndex: 19,
  rightIndex: 20,
  leftHip: 23,
  rightHip: 24,
} as const;

export const STRIDE = 4;
