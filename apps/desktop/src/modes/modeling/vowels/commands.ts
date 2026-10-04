import type { LipSync, Project } from '@app/schema';
import type { Command, ParamValues } from '@app/contracts';

export type Vowel = LipSync['vowels'][number]['vowel'];
export const VOWEL_CHOICES: readonly { id: Vowel; name: string }[] = [
  { id: 'closed', name: '閉じる' },
  { id: 'a', name: 'あ' },
  { id: 'i', name: 'い' },
  { id: 'u', name: 'う' },
  { id: 'e', name: 'え' },
  { id: 'o', name: 'お' },
];
export const MOUTH_PARAMETERS = ['MouthOpen', 'MouthForm', 'MouthWidth'] as const;
export const STANDARD_VOWELS: LipSync['vowels'] = [
  { vowel: 'closed', values: { MouthOpen: 0, MouthWidth: 0, MouthForm: 0 } },
  { vowel: 'a', values: { MouthOpen: 1, MouthWidth: 0.3, MouthForm: 0 } },
  { vowel: 'i', values: { MouthOpen: 0.3, MouthWidth: 1, MouthForm: 0.2 } },
  { vowel: 'u', values: { MouthOpen: 0.3, MouthWidth: -1, MouthForm: 0 } },
  { vowel: 'e', values: { MouthOpen: 0.6, MouthWidth: 0.7, MouthForm: 0 } },
  { vowel: 'o', values: { MouthOpen: 0.6, MouthWidth: -0.7, MouthForm: 0 } },
];

function mouthValues(project: Project, values: ParamValues): ParamValues {
  return Object.fromEntries(
    MOUTH_PARAMETERS.flatMap((id) => {
      const p = project.model.parameters.find((q) => q.id === id);
      if (!p) return [];
      const value = values[id];
      return [[id, Number.isFinite(value) ? Math.min(p.max, Math.max(p.min, value!)) : p.default]];
    }),
  );
}

export function registerVowelCommand(vowel: Vowel, values: ParamValues): Command {
  const snapshot = { ...values };
  return {
    label: '母音の形を登録',
    apply(project) {
      const vowels = project.model.lipSync.vowels.filter((v) => v.vowel !== vowel);
      vowels.push({ vowel, values: mouthValues(project, snapshot) });
      return { ...project, model: { ...project.model, lipSync: { ...project.model.lipSync, vowels } } };
    },
  };
}

export function standardVowelsCommand(): Command {
  return {
    label: '母音を標準の形で作る',
    apply(project) {
      const vowels = STANDARD_VOWELS.map((v) => ({ vowel: v.vowel, values: mouthValues(project, v.values) }));
      return { ...project, model: { ...project.model, lipSync: { ...project.model.lipSync, vowels } } };
    },
  };
}
