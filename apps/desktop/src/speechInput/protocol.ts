import type { SpeechInspection, VoiceState } from '@app/contracts';
import type { SpeechPreferences, VoiceEnvironment } from '@app/schema';

export const INPUT_LABEL = 'speech-input';
export const REQUEST_EVENT = 'studio-speech:request';
export const RESPONSE_EVENT = 'studio-speech:response';
export interface SpeechSnapshot {
  projectId: string;
  projectName: string;
  profileKey?: string;
  preferences: SpeechPreferences;
  environment: VoiceEnvironment;
  inspection: SpeechInspection | null;
  state: VoiceState;
}
export type SpeechAction =
  | { action: 'ready' | 'stop' | 'clear' | 'release' }
  | { action: 'speak'; text: string }
  | { action: 'draft'; text: string; owner: string; revision: number }
  | { action: 'discardDraft'; owner: string }
  | { action: 'mute'; mute: boolean }
  | { action: 'preferences'; preferences: SpeechPreferences }
  | { action: 'output'; outputDeviceId: string | null };
export type SpeechRequest = SpeechAction & { token: string; id: string; projectId: string };
export type SpeechResponse =
  { token: string; snapshot: SpeechSnapshot } | { token: string; id: string; error?: string };

export function isSpeechRequest(value: unknown, token: string): value is SpeechRequest {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.token === token &&
    typeof v.id === 'string' &&
    v.id.length <= 80 &&
    typeof v.projectId === 'string' &&
    ['ready', 'stop', 'clear', 'release', 'speak', 'draft', 'discardDraft', 'mute', 'preferences', 'output'].includes(
      String(v.action),
    )
  );
}
