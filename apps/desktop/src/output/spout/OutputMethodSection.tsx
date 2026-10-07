// スタジオの設定（studioSettings）の「出力の方式」（カード41）。ウィンドウ / Spout2 の切り替え、Spout2 の fps、
// 送信の状態、OBS での受け取り方。解像度は「出力」のセクション（カード22）の値を、どちらの方式でも使う
import { useEffect, useState } from 'react';
import { useEnvironment, useServices } from '../../shell/api';
import { spoutOutput, useSpoutStatus, type OutputSettings, type SpoutStatus } from './controller';
import { SPOUT_SENDER_NAME } from './sink';
import { listSpoutAdapters, type SpoutAdapter } from './adapters';
import './spout.css';

export const FPS_CHOICES = [30, 60] as const;

const STATUS_LABEL: Record<SpoutStatus['state'], string> = {
  off: '停止中',
  starting: '準備中',
  running: '送信中',
  recovering: 'GPU の復旧中',
  error: '送れない',
};

export function OutputMethodSection() {
  const services = useServices();
  const [env, setEnv] = useEnvironment();
  const status = useSpoutStatus();
  const output = env.output;
  const [adapters, setAdapters] = useState<SpoutAdapter[] | null>(null);
  const [adapterNotice, setAdapterNotice] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void listSpoutAdapters().then(
      (found) => {
        if (alive) setAdapters(found);
      },
      (e: unknown) => {
        if (alive) setAdapterNotice(`GPU の一覧を読めない: ${e instanceof Error ? e.message : String(e)}`);
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const fallback = (status.state === 'running' || status.state === 'recovering') && status.telemetry?.adapterFallback;
    if (output.adapterId && (fallback || (adapters !== null && !adapters.some((a) => a.id === output.adapterId)))) {
      setAdapterNotice('選んだGPUが見つからないため、既定のGPUに戻した');
      setEnv({ output: { ...output, adapterId: null } });
    }
  }, [adapters, output, status, setEnv]);
  // 設定に合わせて Spout2 を始める・止める（画面を離れても止めない）
  useEffect(() => spoutOutput.sync(services, output), [services, output]);

  const setOutput = (patch: Partial<OutputSettings>) => setEnv({ output: { ...output, ...patch } });
  const fpsChoices: number[] = FPS_CHOICES.includes(output.fps as 30 | 60)
    ? [...FPS_CHOICES]
    : [...FPS_CHOICES, output.fps];
  const transmitting = status.state === 'running' || status.state === 'recovering';
  const senderName = (transmitting && status.senderName) || SPOUT_SENDER_NAME;

  return (
    <div className="studio-section spout-section">
      <h3>出力の方式</h3>
      <div className="studio-choices" role="group" aria-label="出力の方式">
        <button type="button" aria-pressed={output.method === 'window'} onClick={() => setOutput({ method: 'window' })}>
          ウィンドウ
        </button>
        <button type="button" aria-pressed={output.method === 'spout2'} onClick={() => setOutput({ method: 'spout2' })}>
          Spout2
        </button>
      </div>
      {output.method === 'window' ? (
        <p className="studio-note">
          「出力ウィンドウを開く」で開いたウィンドウを、配信ソフトのウィンドウキャプチャで取り込む
        </p>
      ) : (
        <>
          <label className="studio-field">
            <span>GPU</span>
            <select
              aria-label="Spout2 の GPU"
              value={output.adapterId ?? ''}
              disabled={adapters === null}
              onChange={(e) => {
                setAdapterNotice(null);
                setOutput({ adapterId: e.target.value || null });
              }}
            >
              <option value="">既定のGPU</option>
              {adapters?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <p className="studio-note">OBSと同じGPUを選ぶ（GPUが異なると受け取れないことがある）</p>
          {adapterNotice && (
            <p className="studio-note studio-warn" role="status">
              {adapterNotice}
            </p>
          )}
          <label className="studio-field">
            <span>fps</span>
            <select value={output.fps} onChange={(e) => setOutput({ fps: Number(e.target.value) })}>
              {fpsChoices.map((fps) => (
                <option key={fps} value={fps}>
                  {fps}
                </option>
              ))}
            </select>
          </label>
          <div className="studio-row">
            <span className="studio-status" data-spout={status.state} aria-label="Spout2 の状態">
              {STATUS_LABEL[status.state]}
            </span>
            {status.state === 'error' && (
              <button type="button" onClick={() => spoutOutput.retry()}>
                やり直す
              </button>
            )}
          </div>
          {transmitting && (
            <p className="studio-note">
              送り手「{senderName}」・{status.width}×{status.height}・{status.fps}fps
            </p>
          )}
          {transmitting && status.telemetry && (
            <p className="studio-note">
              実際の送信 {status.telemetry.sendFps.toFixed(1)}fps・失敗 {status.telemetry.failures} 回・復旧{' '}
              {status.telemetry.recoveries} 回
            </p>
          )}
          {status.state === 'recovering' && status.telemetry?.message && (
            <p className="studio-note studio-warn">{status.telemetry.message}。間を空けて自動で試し直す</p>
          )}
          {status.state === 'error' && <p className="studio-note studio-warn">{status.message}</p>}
          <p className="studio-note">
            解像度は「出力」の解像度（{output.width}×{output.height}
            ）で送る。背景を「透明」にすると、モデルだけを透過のまま送る
          </p>
          <details className="spout-obs">
            <summary>OBS での受け取り方</summary>
            <ol>
              <li>OBS に Spout2 のプラグイン（Spout2 Plugin for OBS Studio）を入れ、OBS を開き直す</li>
              <li>ソースの「＋」から「Spout2 Capture」を追加する</li>
              <li>送り手（Spout Senders）で「{senderName}」を選ぶ</li>
              <li>
                透明なところは透明のまま重なる。縁の色がおかしいときは、ソースの合成の設定（Composite Mode）を既定に戻す
              </li>
            </ol>
          </details>
        </>
      )}
    </div>
  );
}
