// 素材トレイの [PSD を読み込み直す]（カード43）。PSD から取り込んだ素材があるときだけ出す。
// PSD が2つ以上なら、どれを読み込み直すかを選ぶ。終わったら結果（更新・追加・見つからない）を出す
import { useEffect, useMemo, useRef, useState } from 'react';
import { psdSourceFiles } from '@app/io';
import { onAppEvent, useDialogs, useProject, useServices } from '../../../../shell/api';
import { readFileBytes } from '../actions';
import { reloadPsd, type ReloadSummary, type ReloadedItem } from './actions';
import './reload.css';

export const ACCEPT_PSD = '.psd,image/vnd.adobe.photoshop';

const CHANGE_TEXT: Record<ReloadSummary['updated'][number]['change'], string> = {
  image: '絵を差し替えた',
  moved: '位置が変わった（メッシュをずらした）',
  resized: '大きさが変わった（メッシュを作り直して変形を移した）',
};

function ResultGroup({
  kind,
  title,
  items,
  note,
}: {
  kind: string;
  title: string;
  items: readonly ReloadedItem[];
  note(item: ReloadedItem): string | null;
}) {
  if (items.length === 0) return null;
  return (
    <li data-reload-group={kind}>
      <p>
        <strong>{title}</strong> {items.length} 個
      </p>
      <ul className="layer-names">
        {items.map((it) => {
          const text = note(it);
          return (
            <li key={it.assetId} data-asset-id={it.assetId}>
              {it.name}
              {text && <span className="am-dim">：{text}</span>}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

export function ReloadResult({ summary, onClose }: { summary: ReloadSummary; onClose(): void }) {
  const changeOf = new Map(summary.updated.map((u) => [u.assetId, u.change]));
  return (
    <div className="psd-reload-result" role="status" aria-label="再読み込みの結果">
      <div className="psd-reload-head">
        <strong>{summary.file} を読み込み直した</strong>
        <button type="button" className="am-icon-button" aria-label="結果を閉じる" onClick={onClose}>
          ×
        </button>
      </div>
      <ul className="psd-reload-groups">
        <ResultGroup
          kind="updated"
          title="更新"
          items={summary.updated}
          note={(it) => {
            const change = changeOf.get(it.assetId);
            if (change === 'resized' && it.parts === 0) return '大きさが変わった';
            return change ? CHANGE_TEXT[change] : null;
          }}
        />
        <ResultGroup kind="added" title="追加（トレイに足した）" items={summary.added} note={() => null} />
        <ResultGroup
          kind="missing"
          title="見つからない（素材とパーツは残した）"
          items={summary.missing}
          note={(it) => (it.parts > 0 ? `パーツ ${it.parts} 個で使っている` : null)}
        />
      </ul>
      {summary.unchanged > 0 && <p className="am-dim">変わらない: {summary.unchanged} 個</p>}
      {summary.warnings > 0 && <p className="am-dim">取り込みの警告がある（警告の一覧を確認）</p>}
      <p className="am-dim am-hint">「元に戻す」1回で、まとめて読み込み直す前に戻せる</p>
    </div>
  );
}

export function PsdReloadSection() {
  const services = useServices();
  const project = useProject();
  const { notify } = useDialogs();
  const sources = useMemo(() => psdSourceFiles(project.assets), [project.assets]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ReloadSummary | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 新規・開くのあとは前の結果を消す
  useEffect(() => onAppEvent('projectLoaded', () => setSummary(null)), []);

  const target = chosen !== null && sources.includes(chosen) ? chosen : (sources[0] ?? null);
  if (target === null && !summary) return null;

  const run = async (file: File, sourceFile: string) => {
    setBusy(true);
    try {
      const data = await readFileBytes(file);
      const outcome = await reloadPsd(services, { name: file.name, data }, sourceFile);
      if (!outcome.ok) {
        notify(outcome.error);
        return;
      }
      setSummary(outcome.summary);
      setChosen(outcome.summary.file); // 素材は新しいファイル名になるので、次もそれを選ぶ
      if (outcome.summary.warnings > 0) notify('取り込みの警告がある。素材トレイの一覧を確認してください');
    } catch (e) {
      notify(`読み込み直せない: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="psd-reload">
      {target !== null && (
        <div className="psd-reload-toolbar">
          <button
            type="button"
            disabled={busy}
            title={`直した PSD を選び、${target} から取り込んだ素材をまとめて更新する`}
            onClick={() => inputRef.current?.click()}
          >
            PSD を読み込み直す
          </button>
          {sources.length > 1 && (
            <select
              aria-label="読み込み直す PSD"
              value={target}
              disabled={busy}
              onChange={(e) => setChosen(e.currentTarget.value)}
            >
              {sources.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_PSD}
            hidden
            aria-label="読み込み直す PSD ファイル"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (file) void run(file, target);
            }}
          />
        </div>
      )}
      {summary && <ReloadResult summary={summary} onClose={() => setSummary(null)} />}
    </div>
  );
}
