import type { ImportFile, ImportResult } from './importer';

export interface ImportProgress {
  phase: 'reading' | 'layers' | 'images';
  fileName: string;
  fileIndex: number;
  fileCount: number;
  layerName?: string;
  layerIndex: number;
  layerCount: number;
}
export type WorkerRequest = { kind: 'import'; files: ImportFile[] };
export type WorkerReply =
  | { kind: 'progress'; progress: ImportProgress }
  | { kind: 'result'; result: ImportResult }
  | { kind: 'error'; message: string };
