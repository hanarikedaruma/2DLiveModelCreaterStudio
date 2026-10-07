// 計測の表示（カード25）。Ctrl+Shift+D で開閉する。スタジオの描画の fps・トラッキングの fps・遅延を出し、
// 最大5分の記録を JSON に書き出せる。表示は DOM を直接使う小さな窓（どのモードでも出せるように React の外に置く）
import type { Services } from '@app/contracts';
import type { AudioLipSyncProducer } from '@app/audio';
import { studioRuntime, type StudioFrame } from '../modes/studio/runtime';
import { isTauri } from '../platform/tauri';
import { registerMenuItem } from '../shell/api';
import { emitAppEvent } from '../shell/events';
import { SHELL_NOTIFY } from '../shell/Shell';
import {
  createDiagnosticsCollector,
  RECORD_LIMIT_MS,
  type DiagnosticsCollector,
  type DiagnosticsRecord,
  type DiagnosticsSnapshot,
} from './collector';
import './diagnostics.css';
import { createLayerDisplay, DEFAULT_DIAGNOSTIC_PARAMETERS, LAYER_SAMPLE_MS } from './layers';

export { createDiagnosticsCollector, type DiagnosticsRecord, type DiagnosticsSnapshot } from './collector';

export interface Diagnostics {
  collector: DiagnosticsCollector;
  toggle(): void;
  isVisible(): boolean;
  startRecording(): void;
  stopRecording(): DiagnosticsRecord | null;
  lastRecord(): DiagnosticsRecord | null;
  environment(): Record<string, unknown>;
}

const fmt = (v: number, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : '—');

// 画面に出す文（テストしやすいように分けておく）
export function formatSnapshot(s: DiagnosticsSnapshot): string[] {
  const lines = [
    `描画 ${fmt(s.render.avg)} fps（1%最低 ${fmt(s.render.low1)}）`,
    `トラッキング ${fmt(s.trackingFps)} fps`,
    `遅延 p95 ${fmt(s.latency.p95, 0)} ms（平均 ${fmt(s.latency.avg, 0)}、${s.latency.samples} 件）`,
  ];
  if (s.recording.active) {
    const sec = Math.floor(s.recording.elapsedMs / 1000);
    lines.push(`記録中 ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} / 5:00`);
  }
  lines.push(`母音処理→描画 p95 ${fmt(s.vowelLatency.p95, 0)} ms（${s.vowelLatency.samples} 件）`);
  return lines;
}

function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'WebGL2 なし';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '不明';
  }
}

async function saveRecord(services: Services, record: DiagnosticsRecord): Promise<string | null> {
  const name = `diagnostics-${record.startedAt.replace(/[:.]/g, '-')}.json`;
  const text = JSON.stringify(record, null, 2);
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: name, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!path) return null;
    await services.fs.writeText(path.replace(/\\/g, '/'), text);
    return path;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

export function registerDiagnostics(services: Services): Diagnostics {
  const collector = createDiagnosticsCollector();
  const selected = new Set(DEFAULT_DIAGNOSTIC_PARAMETERS);
  let latestFrame: StudioFrame | null = null;
  studioRuntime.registerFrameSink((frame) => {
    latestFrame = frame;
    const now = performance.now();
    collector.onRenderedFrame(now);
    if (collector.isRecording()) collector.onLayerFrame(frame, now, selected);
    const lipSync = services.lipSync as Partial<AudioLipSyncProducer>;
    const time = lipSync.vowelFrameTime?.();
    if (time !== undefined && time !== null) collector.onVowelRendered(time, now);
  });
  services.tracking.onFrame((frame) => collector.onTrackingFrame(frame, performance.now()));

  let root: HTMLDivElement | null = null;
  let lines: HTMLDivElement | null = null;
  let recordButton: HTMLButtonElement | null = null;
  let exportButton: HTMLButtonElement | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let last: DiagnosticsRecord | null = null;
  let layerDisplay: ReturnType<typeof createLayerDisplay> | null = null;

  const environment = (): Record<string, unknown> => {
    const project = services.store.get();
    return {
      userAgent: navigator.userAgent,
      gpu: gpuName(),
      hardwareConcurrency: navigator.hardwareConcurrency,
      devicePixelRatio: window.devicePixelRatio,
      screen: { width: screen.width, height: screen.height },
      window: { width: window.innerWidth, height: window.innerHeight },
      output: studioRuntime.getOutputSize(),
      cameraCapture: services.tracking.captureStats(),
      model: {
        name: project.name,
        parts: project.model.parts.length,
        meshes: project.model.meshes.length,
        vertices: project.model.meshes.reduce((n, m) => n + m.vertices.length, 0),
        bindings: project.model.bindings.length,
      },
    };
  };

  const update = () => {
    if (!lines || !recordButton || !exportButton) return;
    const text = formatSnapshot(collector.snapshot(performance.now()));
    const camera = services.tracking.captureStats();
    if (camera)
      text.splice(
        1,
        0,
        `カメラ映像 ${camera.width}×${camera.height} / ${camera.cameraFps === null ? '--' : fmt(camera.cameraFps)} fps`,
      );
    lines.replaceChildren(
      ...text.map((text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div;
      }),
    );
    recordButton.textContent = collector.isRecording() ? '記録を止める' : '記録を始める';
    exportButton.disabled = last === null;
    layerDisplay?.update(latestFrame, services.store.get().model.parameters);
  };

  const show = () => {
    if (root) return;
    root = document.createElement('div');
    root.className = 'diagnostics';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-label', '計測');
    root.setAttribute('aria-live', 'off');
    const title = document.createElement('div');
    title.className = 'diagnostics-title';
    title.textContent = '計測（Ctrl+Shift+D で閉じる）';
    lines = document.createElement('div');
    const buttons = document.createElement('div');
    buttons.className = 'diagnostics-buttons';
    recordButton = document.createElement('button');
    recordButton.type = 'button';
    recordButton.onclick = () => (collector.isRecording() ? api.stopRecording() : api.startRecording());
    exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.textContent = 'JSON に書き出す';
    exportButton.onclick = () => {
      if (!last) return;
      saveRecord(services, last)
        .then((path) => path && emitAppEvent(SHELL_NOTIFY, `計測の記録を書き出した: ${path}`))
        .catch((e) => emitAppEvent(SHELL_NOTIFY, `書き出せなかった: ${e instanceof Error ? e.message : String(e)}`));
    };
    buttons.append(recordButton, exportButton);
    layerDisplay = createLayerDisplay(selected);
    root.append(title, lines, buttons, layerDisplay.root);
    document.body.append(root);
    update();
    timer = setInterval(() => {
      // 5分たったら自動で止める（記録は「JSON に書き出す」で保存できる）
      const s = collector.snapshot(performance.now());
      if (s.recording.active && s.recording.elapsedMs >= RECORD_LIMIT_MS) api.stopRecording();
      else update();
    }, LAYER_SAMPLE_MS);
  };

  const hide = () => {
    if (timer) clearInterval(timer);
    timer = null;
    root?.remove();
    root = lines = recordButton = exportButton = null;
    layerDisplay = null;
  };

  const api: Diagnostics = {
    collector,
    toggle: () => (root ? hide() : show()),
    isVisible: () => root !== null,
    startRecording() {
      collector.startRecording(performance.now(), new Date());
      update();
    },
    stopRecording() {
      const record = collector.stopRecording(performance.now(), environment());
      if (record) last = record;
      update();
      return record;
    },
    lastRecord: () => last,
    environment,
  };

  registerMenuItem({ id: 'diagnostics.toggle', label: '計測の表示', shortcut: 'Ctrl+Shift+D', run: api.toggle });
  return api;
}
