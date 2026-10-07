import { useServices } from '../../../shell/api';
import { importSessionOf, useImportState } from './importSession';

export function ImportProgress() {
  const services = useServices();
  const { busy, progress } = useImportState(services);
  if (!busy) return null;
  return (
    <div className="import-progress" role="status" aria-live="polite" aria-label="素材の取り込み">
      <span>
        {progress
          ? `${progress.fileName}（ファイル ${progress.fileIndex}/${progress.fileCount}）`
          : '取り込みを準備中…'}
        {progress?.layerCount
          ? ` / ${progress.phase === 'images' ? '画像を準備中' : 'レイヤー'} ${progress.layerIndex}/${progress.layerCount}：${progress.layerName ?? ''}`
          : ' / 解析中…'}
      </span>
      <button type="button" onClick={() => importSessionOf(services).cancel()}>
        取り込みを取り消す
      </button>
    </div>
  );
}
