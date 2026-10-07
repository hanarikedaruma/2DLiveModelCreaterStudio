import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../../platform/tauri';

export interface SpoutAdapter {
  id: string;
  name: string;
}
export async function listSpoutAdapters(): Promise<SpoutAdapter[] | null> {
  if (!isTauri()) return null;
  return invoke<SpoutAdapter[]>('spout_adapters');
}
