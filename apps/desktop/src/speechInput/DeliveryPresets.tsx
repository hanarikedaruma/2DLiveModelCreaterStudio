import type { SpeechPreferences } from '@app/schema';

const PRESETS = [
  {
    label: '大切なことを伝える',
    scene:
      '大切な気持ちをまっすぐ伝える。息で押さず、お腹で支えるような芯と自然な響きを意識し、重要な言葉は少し丁寧に、ゆっくり置く。声量は会話のまま。参照音声の声質と普段の高さを保つ。怒鳴ったり、低い声を作ったりしない。',
  },
  {
    label: '話題を切り替える',
    scene:
      '話題の切り替わりで短く自然な間を取り、次の話の出だしを明瞭に伝える。お腹で支えるような芯と響きを意識し、声量は会話のまま。参照音声の声質と普段の高さを保つ。怒鳴ったり、低い声を作ったりしない。',
  },
];

export function DeliveryPresets({
  disabled,
  onChange,
}: {
  disabled: boolean;
  onChange: (patch: Partial<SpeechPreferences>) => void;
}) {
  return (
    <div>
      <div className="studio-row" role="group" aria-label="話し方の例">
        {PRESETS.map(({ label, scene }) => (
          <button key={label} type="button" disabled={disabled} onClick={() => onChange({ scene, style: 'auto' })}>
            {label}
          </button>
        ))}
      </div>
      <p className="studio-note">声を張らず、芯と響きを意識した話し方です。選ぶと［場面・話し方］に反映します。</p>
    </div>
  );
}
