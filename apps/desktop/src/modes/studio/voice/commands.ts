import { createDefaultVoiceSettings, type VoiceProfile, type VoiceSettings } from '@app/schema';
import type { Command } from '@app/contracts';
export function setVoiceCommand(patch: Partial<VoiceSettings>): Command {
  return {
    label: '音声の設定を変える',
    apply(project) {
      return {
        ...project,
        studio: { ...project.studio, voice: { ...(project.studio.voice ?? createDefaultVoiceSettings()), ...patch } },
      };
    },
  };
}
export type VoiceQualityChoice = VoiceProfile['quality'] | 'hqQuality';
export function profileWithQuality(profile: VoiceProfile, quality: VoiceQualityChoice): VoiceProfile {
  const { advanced: _advanced, ...rest } = profile;
  void _advanced;
  if (quality === 'hqQuality')
    return { ...rest, quality: 'hq', backend: 'seed-whisper-large', advanced: { steps: 30 } };
  return { ...rest, quality, backend: quality === 'hq' ? 'seed-whisper-large' : 'seed-xlsr-tiny' };
}
