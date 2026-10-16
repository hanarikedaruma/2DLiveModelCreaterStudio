import type { SpeechPreferences } from '@app/schema';

export const SPEECH_EMOTIONS: { id: SpeechPreferences['style']; label: string }[] = [
  { id: 'auto', label: 'おまかせ' },
  { id: 'cheerful', label: 'うれしい' },
  { id: 'shy', label: '恥ずかしい' },
  { id: 'gentle', label: 'やさしい' },
  { id: 'sad', label: '寂しい' },
  { id: 'surprised', label: '驚き' },
  { id: 'whisper', label: 'ささやき' },
];

export function EmotionButtons({
  value,
  disabled,
  onChange,
}: {
  value: SpeechPreferences['style'];
  disabled: boolean;
  onChange: (style: SpeechPreferences['style']) => void;
}) {
  return (
    <div className="speech-emotions" role="group" aria-label="読み上げの感情">
      <span>感情</span>
      {SPEECH_EMOTIONS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          disabled={disabled}
          aria-pressed={value === id}
          className={value === id ? 'primary' : ''}
          title={id === 'auto' ? '文脈に合わせる' : undefined}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
