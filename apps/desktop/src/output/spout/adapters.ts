import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../../platform/tauri';

export interface SpoutAdapter {
  id: string;
  name: string;
  legacyId?: string; // 同じ起動中に従来のLUIDで保存した設定を移す
}
export async function listSpoutAdapters(): Promise<SpoutAdapter[] | null> {
  if (!isTauri()) return null;
  return invoke<SpoutAdapter[]>('spout_adapters');
}
