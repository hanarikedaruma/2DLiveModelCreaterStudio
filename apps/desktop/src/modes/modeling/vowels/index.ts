import { registerPanel } from '../../../shell/api';
import { VowelPanel } from './VowelPanel';

export function register(): void {
  registerPanel({
    id: 'modeling.vowels',
    mode: 'modeling',
    area: 'right',
    title: '母音',
    order: 65,
    component: VowelPanel,
  });
}
