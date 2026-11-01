// 案内つき収録の手順。案内の文が正解（演者自身の左右・手形）になる。
// 画面の左右ではなく「右手・左手」（演者自身の手）で案内する。収録中のプレビューは鏡像なので、右手は画面の右側に映る。
// カメラの映像（推定器へ渡す）は未反転なので、点列では演者の右手が画像の左側にある。
// 1つの区間で1つの動きだけにし、使わない手は「下ろす」と書く（2026-10-31 の1回目の収録で、反対の手が写る・別の手を使う区間が多かった）。
import type { StepTruth } from './record';

export interface Scenario {
  id: string;
  label: string;
  truth: StepTruth;
}

export const SCENARIOS: Scenario[] = [
  { id: 'rest', label: '両手を下ろす（手は画面に入れない）', truth: { active: [], shape: null } },
  { id: 'wave-right', label: '右手だけ上げて、パーで手を振る', truth: { active: ['right'], shape: 'open' } },
  { id: 'wave-left', label: '左手だけ上げて、パーで手を振る', truth: { active: ['left'], shape: 'open' } },
  { id: 'wave-both', label: '両手を上げて、パーで手を振る', truth: { active: ['left', 'right'], shape: 'open' } },
  {
    id: 'point-up-right',
    label: '右手の人さし指で、真上を指す',
    truth: { active: ['right'], shape: 'point', pointing: 'up' },
  },
  {
    id: 'point-side-right',
    label: '右腕を横へ伸ばし、人さし指で右の真横を指す',
    truth: { active: ['right'], shape: 'point', pointing: 'side' },
  },
  {
    id: 'point-diag-right',
    label: '右手の人さし指で、右ななめ上を指す',
    truth: { active: ['right'], shape: 'point', pointing: 'diagonal' },
  },
  {
    id: 'point-side-left',
    label: '左腕を横へ伸ばし、人さし指で左の真横を指す',
    truth: { active: ['left'], shape: 'point', pointing: 'side' },
  },
  {
    id: 'point-diag-left',
    label: '左手の人さし指で、左ななめ上を指す',
    truth: { active: ['left'], shape: 'point', pointing: 'diagonal' },
  },
  {
    id: 'point-camera-right',
    label: '右手の人さし指を、カメラへ向ける',
    truth: { active: ['right'], shape: 'point', pointing: 'side' },
  },
  { id: 'peace-face-right', label: '右手だけで、顔の前でピース', truth: { active: ['right'], shape: 'peace' } },
  { id: 'peace-face-left', label: '左手だけで、顔の前でピース', truth: { active: ['left'], shape: 'peace' } },
  { id: 'fist-right', label: '右手だけで、胸の前でグー', truth: { active: ['right'], shape: 'fist' } },
  { id: 'fist-left', label: '左手だけで、胸の前でグー', truth: { active: ['left'], shape: 'fist' } },
  {
    id: 'flip-right',
    label: '右手をパーで上げ、手のひら→手の甲→手のひらと、ゆっくり返す',
    truth: { active: ['right'], shape: 'open', palmFlip: true },
  },
  {
    id: 'cross',
    label: '両腕を胸の前で交差して、そのまま止める',
    truth: { active: ['left', 'right'], shape: 'open', crossed: true },
  },
  {
    id: 'cover-face',
    label: '右手で顔を覆う（目と口を隠す）',
    truth: { active: ['right'], shape: 'open', faceCovered: true },
  },
  {
    id: 'elbow-edge',
    label: '右腕を横へ大きく伸ばし、肘を画面の端に出す',
    truth: { active: ['right'], shape: 'open', edge: true },
  },
  {
    id: 'out-and-back',
    label: '右手を画面の外へ出し、また入れて手を振る',
    truth: { active: ['right'], shape: 'open', outOfFrame: true },
  },
];

// 使わない手の案内。片手の区間だけ
export function otherHandNote(scenario: Scenario): string {
  if (scenario.truth.active.length !== 1) return '';
  return scenario.truth.active[0] === 'right' ? '左手は下ろしたまま' : '右手は下ろしたまま';
}
