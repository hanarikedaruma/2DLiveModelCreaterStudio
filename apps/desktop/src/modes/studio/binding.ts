// スタジオの画面が出ている間、実行部を services につなぎ、環境設定（出力の大きさ・ミラー）を反映する
import { useEffect } from 'react';
import { useEnvironment, useServices } from '../../shell/api';
import { studioRuntime } from './runtime';

export function useStudioBinding(): void {
  const services = useServices();
  const [env] = useEnvironment();
  const { width, height } = env.output;
  useEffect(() => studioRuntime.attach(services), [services]);
  useEffect(() => studioRuntime.setOutputSize({ width, height }), [width, height]);
  useEffect(() => services.trackingLayer.setMirror(env.mirror), [services, env.mirror]);
}
