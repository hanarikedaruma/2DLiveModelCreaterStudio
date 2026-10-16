import type { SpeechPreferences, VoiceEnvironment, VoiceFilters, VoiceProfile } from '@app/schema';

export interface VoiceDevice {
  id: string;
  index: number;
  label: string;
}
export interface VoiceFilterSpec {
  type: import('@app/schema').VoiceFilterType;
  title: string;
  description: string;
  parameters: { key: string; label: string; minimum: number; maximum: number; default: number; unit: string }[];
}
export interface VoiceInspection {
  ready: boolean;
  reason: string;
  modelRoot: string;
  inputs: VoiceDevice[];
  outputs: VoiceDevice[];
  filters: VoiceFilterSpec[];
}
export interface VoiceState {
  state: 'unprepared' | 'stopped' | 'loading' | 'priming' | 'running' | 'stopping' | 'error';
  sessionId: string | null;
  error: string;
  mute: boolean;
  bypass: boolean;
  metrics: Record<string, number>;
  converting: boolean;
  conversionOutput: string | null;
  source: 'microphone' | 'speech' | null;
  speech: {
    history: string[];
    resident: boolean;
    delivery?: 'whole' | 'stream';
    speakerKey?: string;
    preparation?: {
      owner: string;
      revision: number;
      state: 'idle' | 'scheduled' | 'generating' | 'ready' | 'error';
      error?: string;
    };
  };
}
export interface SpeechInspection {
  ready: boolean;
  reason: string;
  voice: string;
  outputs: VoiceDevice[];
}
export interface VoicePlayback {
  sessionId: string;
  sequence: number;
  time: number;
  sampleRate: number;
  samples: Float32Array;
}
export interface VoiceService {
  state(): VoiceState;
  subscribe(listener: () => void): () => void;
  onPlayback(listener: (frame: VoicePlayback) => void): () => void;
  inspect(): Promise<VoiceInspection>;
  inspectSpeech(profile: VoiceProfile): Promise<SpeechInspection>;
  speak(
    text: string,
    preferences: SpeechPreferences,
    profile: VoiceProfile,
    environment: VoiceEnvironment,
  ): Promise<void>;
  clearSpeechHistory(): Promise<void>;
  prepareSpeechDraft(
    text: string,
    preferences: SpeechPreferences,
    profile: VoiceProfile,
    owner: string,
    revision: number,
  ): Promise<void>;
  discardSpeechDraft(owner: string): Promise<void>;
  releaseSpeech(): Promise<void>;
  configureRuntime(python: string, modelRoot: string): Promise<void>;
  start(profile: VoiceProfile, environment: VoiceEnvironment): Promise<void>;
  stop(): Promise<void>;
  controls(
    value: Partial<Pick<VoiceProfile, 'voiceTone' | 'outputFilters'>> & {
      inputGainDb?: number;
      mute?: boolean;
      bypass?: boolean;
    },
  ): Promise<void>;
  setProjectDirectory(dir: string | null): void;
  persistReferences(targetDir: string, profile: VoiceProfile): Promise<void>;
  importReference(path: string): Promise<string>;
  previewReference(reference: string): Promise<string>;
  importProfile(path: string): Promise<VoiceProfile>;
  exportProfile(path: string, profile: VoiceProfile): Promise<void>;
  readFilters(path: string): Promise<VoiceFilters>;
  saveFilters(path: string, filters: VoiceFilters): Promise<void>;
  convert(source: string, output: string, profile: VoiceProfile): Promise<void>;
}
