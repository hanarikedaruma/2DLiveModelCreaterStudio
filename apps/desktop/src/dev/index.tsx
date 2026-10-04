// 開発中の確認用の部品（サンプルを開くメニュー・座標を確かめるツール・確認用パネル）
import { useSyncExternalStore } from 'react';
import type { Vec2 } from '@app/schema';
import type { Services } from '@app/contracts';
import { emitAppEvent, registerCanvasTool, registerMenuItem, registerPanel, useCanvas, useProject } from '../shell/api';
import { SHELL_NOTIFY } from '../shell/Shell';
import { loadSampleModel } from './sampleModel';

// 最後に押したキャンバス座標（拡大・移動の後も座標が正しいかを確かめる）
let lastPoint: Vec2 | null = null;
const pointListeners = new Set<() => void>();
function setLastPoint(p: Vec2) {
  lastPoint = p;
  for (const l of [...pointListeners]) l();
}
function useLastPoint() {
  return useSyncExternalStore(
    (l) => {
      pointListeners.add(l);
      return () => pointListeners.delete(l);
    },
    () => lastPoint,
  );
}

function CanvasInfo() {
  const project = useProject();
  const { view } = useCanvas();
  const point = useLastPoint();
  return (
    <dl className="dev-info">
      <dt>プロジェクト</dt>
      <dd>{project.name}</dd>
      <dt>パーツ</dt>
      <dd>{project.model.parts.length}</dd>
      <dt>倍率</dt>
      <dd>{view.scale.toFixed(3)}</dd>
      <dt>最後に押した座標</dt>
      <dd data-testid="dev-last-point">{point ? `${point.x.toFixed(1)}, ${point.y.toFixed(1)}` : '—'}</dd>
    </dl>
  );
}

export function registerDevParts(services: Services): void {
  const openSample = async () => {
    try {
      await loadSampleModel(services);
      emitAppEvent(SHELL_NOTIFY, 'サンプルモデルを開いた');
    } catch (e) {
      emitAppEvent(SHELL_NOTIFY, `サンプルモデルを開けない: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  registerMenuItem({ id: 'dev.openSample', label: 'サンプルモデルを開く', run: () => void openSample() });
  registerCanvasTool({
    id: 'dev.probe',
    label: '座標の確認',
    cursor: 'crosshair',
    onPointerDown: (e) => setLastPoint(e.canvasPoint),
    drawOverlay(ctx, view) {
      if (!lastPoint) return;
      const x = lastPoint.x * view.scale + view.offset.x;
      const y = lastPoint.y * view.scale + view.offset.y;
      ctx.strokeStyle = '#ff4081';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 10, y);
      ctx.lineTo(x + 10, y);
      ctx.moveTo(x, y - 10);
      ctx.lineTo(x, y + 10);
      ctx.stroke();
    },
  });
  registerPanel({
    id: 'dev.info',
    mode: 'modeling',
    area: 'right',
    title: '確認用',
    order: 1000,
    component: CanvasInfo,
  });
}
