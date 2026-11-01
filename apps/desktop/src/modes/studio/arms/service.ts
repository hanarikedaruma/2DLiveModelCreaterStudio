// スタジオの腕・手の画面（AT-11）が使うサービス。AT-11から依頼した3つ（設定の読み出し・校正の取り消し・診断）は
// AT-03 CO v3 で CC-032 の ArmService に入ったので、型は契約のものを使う（画面側の名前は別名で残す）
import { useEffect, useState } from 'react';
import type { ArmDiagnostics, ArmService, ArmServiceStatus, Services } from '@app/contracts';
import type { ArmCalibration, ArmTrackingSettings } from '@app/schema';

export type {
  ArmActorSide as ActorSide,
  ArmDiagnosticPoint as DiagnosticPoint,
  ArmDiagnostics,
  ArmSideDiagnostics,
} from '@app/contracts';
export type StudioArmService = ArmService;

// services.arms が画面に要る操作を持っていれば返す。無ければ理由（契約より前に作られたサービスでも落ちないように確かめる）
export function studioArmService(
  services: Pick<Services, 'arms'>,
): { service: StudioArmService; reason: null } | { service: null; reason: string } {
  const s = services.arms as Partial<StudioArmService> | undefined;
  if (!s) return { service: null, reason: '腕のサービスが無い' };
  const ok = (['settings', 'cancelCalibration', 'diagnostics', 'onDiagnostics'] as const).every(
    (k) => typeof s[k] === 'function',
  );
  return ok
    ? { service: s as StudioArmService, reason: null }
    : { service: null, reason: '腕のサービスが設定の読み出し・診断に対応していない' };
}

export interface ArmSnapshot {
  status: ArmServiceStatus;
  settings: ArmTrackingSettings;
  calibration: ArmCalibration | null;
}
function readSnapshot(service: StudioArmService): ArmSnapshot {
  return { status: service.status(), settings: service.settings(), calibration: service.calibration() };
}

// status() などは呼ぶたびに新しいオブジェクトを返すので、通知のときだけ読み直す
export function useArmSnapshot(service: StudioArmService): ArmSnapshot {
  const [snapshot, setSnapshot] = useState(() => readSnapshot(service));
  useEffect(() => {
    setSnapshot(readSnapshot(service));
    return service.subscribe(() => setSnapshot(readSnapshot(service)));
  }, [service]);
  return snapshot;
}

export const DIAGNOSTICS_STALE_MS = 500; // これより前の撮影時刻の診断は「古い」と示す

// 診断を購読する。古いかどうかを確かめ直すため、出している間は一定の間隔で描き直す
export function useArmDiagnostics(service: StudioArmService): { diagnostics: ArmDiagnostics | null; stale: boolean } {
  const [diagnostics, setDiagnostics] = useState(() => service.diagnostics());
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    setDiagnostics(service.diagnostics());
    return service.onDiagnostics(() => {
      setDiagnostics(service.diagnostics());
      setNow(performance.now());
    });
  }, [service]);
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(id);
  }, []);
  return { diagnostics, stale: diagnostics !== null && now - diagnostics.time > DIAGNOSTICS_STALE_MS };
}
