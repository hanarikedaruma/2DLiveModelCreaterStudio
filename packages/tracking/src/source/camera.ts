// カメラまわりの差し込み口。本物は navigator.mediaDevices と <video>。テストでは仮のものに替える
import type { Environment } from '@app/schema';

export interface CameraTrack {
  getSettings(): MediaTrackSettings;
  getCapabilities(): MediaTrackCapabilities;
  applyConstraints(constraints: MediaTrackConstraints): Promise<void>;
}

export interface MediaStreamLike {
  getTracks(): { stop(): void }[];
  getVideoTracks(): CameraTrack[];
}

// navigator.mediaDevices のうち使うところ
export interface MediaDevicesLike {
  enumerateDevices(): Promise<{ deviceId: string; kind: string; label: string }[]>;
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamLike>;
}

// requestVideoFrameCallback が渡すフレームの情報のうち使うところ
export interface VideoFrameInfo {
  presentedFrames: number; // 表示したフレームの通し番号（同じフレームを2度推定しないために使う）
  captureTime?: number; // カメラが撮った時刻（ページの時計の ms）。WebView2 のカメラでは入る。無ければ通知の時刻を使う
}

// カメラの映像を流す先。推定には image を渡す
export interface CameraVideo {
  readonly image: HTMLVideoElement;
  frameCount(): number;
  play(stream: MediaStreamLike): Promise<void>;
  // 次のフレームが出たら1回だけ呼ぶ。戻り値で取り消す
  onNextFrame(callback: (now: number, info: VideoFrameInfo) => void): () => void;
  // 止めて片付ける
  release(): void;
}

export const AUTO_CAPTURE = { mode: 'auto', width: 640, height: 480, fps: 60 } as const;

export function captureConstraints(settings: Environment['cameraCapture'], relaxed = false): MediaTrackConstraints {
  return {
    width:
      settings.mode === 'manual'
        ? { exact: settings.width }
        : { ideal: settings.width, ...(relaxed ? {} : { max: settings.width }) },
    height:
      settings.mode === 'manual'
        ? { exact: settings.height }
        : { ideal: settings.height, ...(relaxed ? {} : { max: settings.height }) },
    frameRate: { ideal: settings.mode === 'auto' ? AUTO_CAPTURE.fps : settings.fps },
  };
}

export function cameraConstraints(
  deviceId?: string,
  settings: Environment['cameraCapture'] = AUTO_CAPTURE,
  relaxed = false,
): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      ...captureConstraints(settings.mode === 'auto' ? AUTO_CAPTURE : settings, relaxed),
    },
  };
}

export function stopStream(stream: Pick<MediaStreamLike, 'getTracks'>): void {
  for (const track of stream.getTracks()) track.stop();
}

// 本物の <video> を使う。requestVideoFrameCallback が確実に呼ばれるように、見えない形で文書に入れておく。
// 映像はこの要素の中だけで扱い、外へは送らない
export function createDomCameraVideo(doc: Document = document): CameraVideo {
  const video = doc.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = false;
  video.setAttribute('aria-hidden', 'true');
  video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;';
  return {
    image: video,
    frameCount: () => video.getVideoPlaybackQuality().totalVideoFrames,
    async play(stream) {
      if (typeof video.requestVideoFrameCallback !== 'function') {
        throw new Error('この環境では requestVideoFrameCallback が使えない');
      }
      if (!video.isConnected) doc.body.appendChild(video);
      video.srcObject = stream as MediaStream;
      await video.play();
    },
    onNextFrame(callback) {
      const handle = video.requestVideoFrameCallback((now, metadata) => callback(now, metadata));
      return () => video.cancelVideoFrameCallback(handle);
    },
    release() {
      video.pause();
      video.srcObject = null;
      video.remove();
    },
  };
}
