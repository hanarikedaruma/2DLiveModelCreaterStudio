// メインのウィンドウと出力ウィンドウのあいだのメッセージ
import type { Project } from '@app/schema';
import type { ParamValues, ViewTransform } from '@app/contracts';
import type { Size } from '../modes/studio/placement';
import type { SceneBackground } from '../modes/studio/scene';

// メイン → 出力
// project: 開いたとき（ready を受けたとき）はすべての素材、以後は変わった素材・背景の画像だけを入れる
export interface ProjectMessage {
  type: 'project';
  project: Project;
  assets: Record<string, Uint8Array>; // assetId → PNG
  backgrounds: Record<string, Uint8Array>; // 背景の画像のパス → 画像のファイル
}
// 毎フレーム。view は出力画面（size）の px での変換
export interface FrameMessage {
  type: 'frame';
  params: ParamValues;
  view: ViewTransform;
  background: SceneBackground;
  size: Size;
  now: number;
}
export type ToOutput = ProjectMessage | FrameMessage;

// 出力 → メイン。ready は受け取る準備ができたとき（開いたとき・読み込み直したとき）
export type FromOutput = { type: 'ready' } | { type: 'closed' };

export function isToOutput(value: unknown): value is ToOutput {
  const type = (value as { type?: unknown } | null)?.type;
  return type === 'project' || type === 'frame';
}

export function isFromOutput(value: unknown): value is FromOutput {
  const type = (value as { type?: unknown } | null)?.type;
  return type === 'ready' || type === 'closed';
}

// ---- JSON にするときの形（Tauri のイベントは JSON で渡るので、バイナリは base64 にする） ----

export interface WireProjectMessage {
  type: 'project';
  project: Project;
  assets: Record<string, string>;
  backgrounds: Record<string, string>;
}
export type WireToOutput = WireProjectMessage | FrameMessage;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function mapValues<A, B>(record: Record<string, A>, fn: (a: A) => B): Record<string, B> {
  const out: Record<string, B> = {};
  for (const [k, v] of Object.entries(record)) out[k] = fn(v);
  return out;
}

export function encodeToOutput(message: ToOutput): WireToOutput {
  if (message.type === 'frame') return message;
  return {
    ...message,
    assets: mapValues(message.assets, bytesToBase64),
    backgrounds: mapValues(message.backgrounds, bytesToBase64),
  };
}

export function decodeToOutput(wire: WireToOutput): ToOutput {
  if (wire.type === 'frame') return wire;
  return {
    ...wire,
    assets: mapValues(wire.assets, base64ToBytes),
    backgrounds: mapValues(wire.backgrounds, base64ToBytes),
  };
}
