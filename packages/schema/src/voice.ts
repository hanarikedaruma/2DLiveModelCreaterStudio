import { z } from 'zod';

export type VoiceBackend = 'seed-xlsr-tiny' | 'seed-whisper-large';
export type VoiceFilterType = 'resonance' | 'deesser' | 'lowpass' | 'equalizer' | 'gain';
export interface VoiceFilter {
  id: string;
  type: VoiceFilterType;
  name: string;
  enabled: boolean;
  params: Record<string, number>;
}
export interface VoiceFilters {
  schemaVersion: 1;
  enabled: boolean;
  items: VoiceFilter[];
}
export interface VoiceProfile {
  name: string;
  backend: VoiceBackend;
  quality: 'fast' | 'balanced' | 'stable' | 'hq';
  reference: string;
  outputGainDb: number;
  voiceTone: { brightnessDb: number; bodyDb: number; softnessDb: number };
  inputCleanup: { noiseReduction: number; speechOnly: boolean; speechSensitivity: number };
  outputFilters: VoiceFilters;
  advanced?: Partial<
    Record<
      | 'steps'
      | 'cfgRate'
      | 'hopSeconds'
      | 'lookaheadSeconds'
      | 'historySeconds'
      | 'generationHistorySeconds'
      | 'referenceSeconds'
      | 'seed',
      number
    >
  >;
}
export interface VoiceSettings {
  profile: VoiceProfile;
  syncOffsetMs: number;
  mouthLinked: boolean;
  speech?: SpeechPreferences;
}
export interface SpeechPreferences {
  voice: string;
  scene: string;
  style: 'auto' | 'cheerful' | 'shy' | 'gentle' | 'sad' | 'surprised' | 'whisper';
  useContext: boolean;
  applyFilters: boolean;
  delivery?: 'whole' | 'stream';
}
export const DEFAULT_SPEECH_VOICE =
  '自然な日本語を話す若い成人女性。柔らかく、可愛らしく、あたたかい声。軽く明るい響き。極端な高音や鼻声を避け、子音は明瞭に、日常会話らしく自然に話す。';
export function createDefaultSpeechPreferences(): SpeechPreferences {
  return { voice: DEFAULT_SPEECH_VOICE, scene: '', style: 'auto', useContext: true, applyFilters: true };
}
export interface VoiceEnvironment {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  inputGainDb: number;
  silenceThreshold: number;
}

const num = z.number().finite();
export const voiceFiltersSchema: z.ZodType<VoiceFilters> = z
  .object({
    schemaVersion: z.literal(1),
    enabled: z.boolean(),
    items: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          type: z.enum(['resonance', 'deesser', 'lowpass', 'equalizer', 'gain']),
          name: z.string().min(1).max(100),
          enabled: z.boolean(),
          params: z.record(num),
        }),
      )
      .max(8),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.items.map((f) => f.id)).size !== value.items.length)
      ctx.addIssue({ code: 'custom', message: 'フィルタのIDが重複している' });
  });
export const voiceProfileSchema: z.ZodType<VoiceProfile> = z
  .object({
    name: z.string().trim().min(1).max(100),
    backend: z.enum(['seed-xlsr-tiny', 'seed-whisper-large']),
    quality: z.enum(['fast', 'balanced', 'stable', 'hq']),
    reference: z.string().regex(/^(builtin|voice\/references\/[a-f0-9]{64}\.wav)$/),
    outputGainDb: num.min(-18).max(12),
    voiceTone: z.object({
      brightnessDb: num.min(-4).max(4),
      bodyDb: num.min(-3).max(3),
      softnessDb: num.min(0).max(6),
    }),
    inputCleanup: z.object({
      noiseReduction: num.min(0).max(1),
      speechOnly: z.boolean(),
      speechSensitivity: num.min(0).max(100),
    }),
    outputFilters: voiceFiltersSchema,
    advanced: z
      .object({
        steps: num.int().min(4).max(50).optional(),
        cfgRate: num.min(0).max(2).optional(),
        hopSeconds: num.min(0.12).max(3).optional(),
        lookaheadSeconds: num.min(0.04).max(1).optional(),
        historySeconds: num.min(0).max(4).optional(),
        generationHistorySeconds: num.min(0.2).max(4).optional(),
        referenceSeconds: num.min(1).max(12).optional(),
        seed: num.int().min(0).max(2147483647).optional(),
      })
      .optional(),
  })
  .superRefine((p, ctx) => {
    if ((p.backend === 'seed-whisper-large') !== (p.quality === 'hq'))
      ctx.addIssue({ code: 'custom', message: 'AI方式と品質が一致しない' });
  });
const speechText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .refine(
      (text) => Array.from(text).every((char) => char.charCodeAt(0) >= 32 || '\n\r\t'.includes(char)),
      '使用できない文字がある',
    );
export const speechPreferencesSchema: z.ZodType<SpeechPreferences> = z.object({
  voice: speechText(5, 2000),
  scene: speechText(0, 500),
  style: z.enum(['auto', 'cheerful', 'shy', 'gentle', 'sad', 'surprised', 'whisper']),
  useContext: z.boolean(),
  applyFilters: z.boolean(),
  delivery: z.enum(['whole', 'stream']).optional(),
});
export const speechUtteranceSchema = speechText(1, 300);
export const voiceSettingsSchema: z.ZodType<VoiceSettings> = z.object({
  profile: voiceProfileSchema,
  syncOffsetMs: num.min(-300).max(300),
  mouthLinked: z.boolean(),
  speech: speechPreferencesSchema.optional(),
});
export const voiceEnvironmentSchema: z.ZodType<VoiceEnvironment> = z.object({
  inputDeviceId: z.string().nullable(),
  outputDeviceId: z.string().nullable(),
  inputGainDb: num.min(-12).max(24),
  silenceThreshold: num.min(-80).max(-10),
});

export function createDefaultVoiceSettings(): VoiceSettings {
  return {
    syncOffsetMs: 0,
    mouthLinked: true,
    profile: {
      name: 'Original Soft Girl Realtime',
      backend: 'seed-xlsr-tiny',
      quality: 'fast',
      reference: 'builtin',
      outputGainDb: -3,
      voiceTone: { brightnessDb: 0, bodyDb: 0, softnessDb: 0 },
      inputCleanup: { noiseReduction: 0.85, speechOnly: true, speechSensitivity: 40 },
      outputFilters: {
        schemaVersion: 1,
        enabled: true,
        items: [
          {
            id: 'default-resonance',
            type: 'resonance',
            name: '電子感・金属音の抑制',
            enabled: true,
            params: { strength: 35, frequencyHz: 1800, q: 1.2, sensitivity: 75 },
          },
          {
            id: 'default-deesser',
            type: 'deesser',
            name: '高音のザラつき・歯擦音の抑制',
            enabled: true,
            params: { strength: 30, frequencyHz: 5800, thresholdDb: -40 },
          },
          {
            id: 'default-lowpass',
            type: 'lowpass',
            name: '高音を丸める（ローパス）',
            enabled: true,
            params: { frequencyHz: 9000 },
          },
        ],
      },
    },
  };
}
