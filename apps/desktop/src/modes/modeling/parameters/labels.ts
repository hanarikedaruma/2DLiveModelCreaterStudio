// パラメータの値を言葉にする（パネルの行と、キャンバスの「編集中」の表示で使う）
import { previewParameters } from '../../../services/keyEditor/common';
import type { Parameter, Project } from '@app/schema';
import type { EditorState } from '@app/contracts';
import { activeParameters, hasKeyAtCurrentValue, isAutomaticCombination, valueOf } from './marks';
import { bindingInScope, partScope } from './generate';

interface ResultWords {
  min: string;
  default: string | null; // null はデフォルト値が端にあるもの（端の言葉を使う）
  max: string;
}

// 結果の言葉（最小 / デフォルト / 最大）
export const RESULT_WORDS: Record<string, ResultWords> = {
  FaceAngleX: { min: '左', default: '正面', max: '右' },
  FaceAngleY: { min: '下', default: '正面', max: '上' },
  FaceAngleZ: { min: '左へ', default: 'なし', max: '右へ' },
  EyeOpenL: { min: '閉じる', default: null, max: '開く' },
  EyeOpenR: { min: '閉じる', default: null, max: '開く' },
  EyeBallX: { min: '左', default: '中央', max: '右' },
  EyeBallY: { min: '下', default: '中央', max: '上' },
  MouthOpen: { min: '閉じる', default: null, max: '開く' },
  // STEP1 の標準パラメータ（カード34）。'–' はデフォルト値（中ほど）に言葉が無いもの
  EyeSmileL: { min: 'なし', default: null, max: '笑顔' },
  EyeSmileR: { min: 'なし', default: null, max: '笑顔' },
  BrowYL: { min: '下げる', default: '–', max: '上げる' },
  BrowYR: { min: '下げる', default: '–', max: '上げる' },
  BrowFormL: { min: '困り', default: '–', max: '怒り' },
  BrowFormR: { min: '困り', default: '–', max: '怒り' },
  MouthForm: { min: 'への字', default: '–', max: '笑顔' },
  MouthWidth: { min: 'すぼめる', default: '–', max: '横に開く' },
  Cheek: { min: 'なし', default: null, max: '染める' },
  BodyAngleX: { min: '左', default: '正面', max: '右' },
  BodyAngleY: { min: '下', default: '正面', max: '上' },
  BodyAngleZ: { min: '左へ', default: 'なし', max: '右へ' },
  // STEP2 の標準パラメータ（カード53）。髪揺れの向きは物理の設定で決まるので言葉を付けない
  Breath: { min: '吐く', default: null, max: '吸う' },
  ArmL: { min: '内へ', default: '–', max: '上げる' },
  ArmR: { min: '内へ', default: '–', max: '上げる' },
};

const NEAR = 1e-6;

// 範囲が 10 を超えるものは小数1桁、それ以外は2桁まで。負の値を取るものは正に + を付ける
export function formatValue(parameter: Parameter, value: number): string {
  const digits = parameter.max - parameter.min > 10 ? 1 : 2;
  const rounded = Number(value.toFixed(digits));
  const text = String(Object.is(rounded, -0) ? 0 : rounded);
  return parameter.min < 0 && rounded > 0 ? `+${text}` : text;
}

// 値の向きの言葉。表に無いパラメータは null
export function resultWord(parameter: Parameter, value: number): string | null {
  const words = RESULT_WORDS[parameter.id];
  if (!words) return null;
  if (Math.abs(value - parameter.default) <= NEAR) {
    if (words.default) return words.default;
    return parameter.default <= parameter.min ? words.min : words.max;
  }
  return value < parameter.default ? words.min : words.max;
}

// 例: 「右（+30）」。言葉が無ければ値だけ
export function resultLabel(parameter: Parameter, value: number): string {
  const word = resultWord(parameter, value);
  const formatted = formatValue(parameter, value);
  return word ? `${word}（${formatted}）` : formatted;
}

// キャンバスに出す「編集中: 顔 左右 ＝ 右（+30）」。キーの無い値なら「キーなし」を添える。編集中でなければ null
export function editingLabel(project: Project, editor: EditorState): string | null {
  const params = activeParameters(project.model, editor);
  // プレビュー中のパラメータ（編集していないのに値がデフォルト値でない。I-028）
  const previews = previewParameters(project.model, editor);
  const preview =
    previews.length > 0
      ? `プレビュー: ${previews.map((p) => `${p.name} ＝ ${resultLabel(p, valueOf(p, editor))}`).join('、')}`
      : '';
  if (params.length === 0) {
    if (preview) return `${preview}（パーツは動かせない）`;
    const scope = partScope(project.model, editor.selectedPartIds);
    return scope && project.model.bindings.some((b) => b.keys.length > 0 && bindingInScope(project.model, b, scope))
      ? '基準の形を編集中（すべてのキーが一緒に動く）'
      : null;
  }
  const parts = params.map((p) => `${p.name} ＝ ${resultLabel(p, valueOf(p, editor))}`);
  const tail = preview ? '　' + preview + '（編集できない）' : '';
  const noKey = !hasKeyAtCurrentValue(project.model, editor);
  if (noKey && isAutomaticCombination(project.model, editor)) {
    const face =
      params.length === 2 && params.some((p) => p.id === 'FaceAngleX') && params.some((p) => p.id === 'FaceAngleY');
    const status = face ? '　自動（左右と上下の和）' : '　自動（' + params.length + 'つのパラメータの合成）';
    return `編集中: ${parts.join('、')}${status}${tail}`;
  }
  return `編集中: ${parts.join('、')}${noKey ? '　キーなし' : ''}${tail}`;
}
