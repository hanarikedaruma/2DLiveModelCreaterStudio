import { registerPanel, registerPanelSection } from '../../../shell/api';
import { STUDIO_AUDIO_PANEL } from '../sections';
import { VoiceSection } from './VoiceSection';
import { SpeechPanel } from './SpeechPanel';
export function register(): void {
  registerPanel({
    id: 'studioSpeech',
    mode: 'studio',
    area: 'right',
    title: 'チャット読み上げ',
    order: -20,
    component: SpeechPanel,
  });
  registerPanelSection({ id: 'studio.voice', panelId: STUDIO_AUDIO_PANEL, order: 10, component: VoiceSection });
}
