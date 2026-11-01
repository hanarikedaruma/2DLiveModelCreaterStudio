// ページと腕・手の推定 Worker の間のメッセージ（AT-04）。製品の外へは公開しない。
// 時刻はすべてページの単調時計（performance.now()）の ms。Worker は timeOrigin の差を足してから送る。
import type { BodySampleTime, HandObservation, PoseObservation } from '@app/contracts';

export type Delegate = 'GPU' | 'CPU';

export interface BodyWorkerUrls {
  wasmLoader: string; // vision_wasm_module_internal.js（モジュール Worker 用）
  wasmBinary: string;
  pose: string;
  gesture: string;
}

export interface InitMessage {
  type: 'init';
  pageTimeOrigin: number;
  hands: boolean; // false なら手の推定器を作らない
  handIntervalMs: number; // 0 は毎フレーム。軽量は 1000/15
  urls: BodyWorkerUrls;
}

export interface ModeMessage {
  type: 'mode';
  handIntervalMs: number;
}

// 画像は所有権ごと渡す。Worker が推定の後に close() する
export interface FrameMessage {
  type: 'frame';
  generation: number;
  frameId: number;
  capturedAt: number;
  captureSource: BodySampleTime['captureSource'];
  image: VideoFrame | ImageBitmap;
}

export interface StopMessage {
  type: 'stop';
}

export type ToBodyWorker = InitMessage | ModeMessage | FrameMessage | StopMessage;

export interface TaskReady {
  delegate: Delegate | null; // null は使えない
  errors: string[];
}

export interface ReadyMessage {
  type: 'ready';
  pose: TaskReady;
  hands: TaskReady | null; // null は手を推定しない設定
}

// Pose と手は別々に送る（腕を手の推定で待たせない）。各フレームの最後に done を送る
interface PartBase {
  generation: number;
  frameId: number;
  capturedAt: number;
  captureSource: BodySampleTime['captureSource'];
  completedAt: number;
  width: number;
  height: number;
  error: string | null; // 推定で例外が出たとき。value は null
}

export interface PosePart extends PartBase {
  type: 'pose';
  value: PoseObservation | null;
}

export interface HandsPart extends PartBase {
  type: 'hands';
  value: HandObservation[] | null;
}

// このフレームの推定が終わった（推定しなかったときも送る）。ページは次のフレームを渡してよい
export interface DoneMessage {
  type: 'done';
  generation: number;
  frameId: number;
}

// ページの外への通信の試み（止めて知らせる）
export interface NetMessage {
  type: 'net';
  url: string;
  method: string;
}

export interface FailedMessage {
  type: 'failed';
  message: string;
}

export type FromBodyWorker = ReadyMessage | PosePart | HandsPart | DoneMessage | NetMessage | FailedMessage;
