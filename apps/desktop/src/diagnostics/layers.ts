import { LAYER_ORDER, type Layer, type LayerId, type ParamValues } from '@app/contracts';
import type { Parameter } from '@app/schema';
import type { StudioFrame } from '../modes/studio/runtime';

export const LAYER_SAMPLE_MS = 500;
export const DEFAULT_DIAGNOSTIC_PARAMETERS = [
  'FaceAngleX',
  'FaceAngleY',
  'FaceAngleZ',
  'EyeOpenL',
  'EyeOpenR',
  'MouthOpen',
  'BodyAngleX',
  'BodyAngleY',
  'BodyAngleZ',
];
const LABELS: Record<LayerId, string> = {
  tracking: 'カメラ',
  auto: '自動',
  bodyFollow: '体の追従',
  expression: '表情',
  hotkey: 'ホットキー',
  animation: 'アニメーション',
  lipSync: '音声',
  periodic: '周期',
  physics: '物理',
};
export interface LayerSample {
  atMs: number;
  parameterIds: string[];
  final: ParamValues;
  layers: Layer[];
}

// 選んだ値だけを写す。producer が次のフレームで元の値を変更しても記録は変わらない。
export function sampleLayers(frame: StudioFrame, ids: readonly string[], atMs: number): LayerSample {
  const pick = (values: ParamValues): ParamValues =>
    Object.fromEntries(
      ids.filter((id) => Object.hasOwn(values, id) && Number.isFinite(values[id])).map((id) => [id, values[id]!]),
    );
  return {
    atMs,
    parameterIds: [...ids],
    final: pick(frame.params),
    layers: frame.layers.map((layer) => ({
      id: layer.id,
      weight: layer.weight,
      values: pick(layer.values),
      ...(layer.parameterWeights ? { parameterWeights: pick(layer.parameterWeights) } : {}),
      ...(layer.blend
        ? {
            blend: Object.fromEntries(
              ids.filter((id) => Object.hasOwn(layer.blend!, id)).map((id) => [id, layer.blend![id]!]),
            ),
          }
        : {}),
    })),
  };
}

const number = (value: number | undefined) => (value !== undefined && Number.isFinite(value) ? value.toFixed(3) : '—');

export function createLayerDisplay(selected: Set<string>) {
  const root = document.createElement('div');
  root.className = 'diagnostics-layers';
  const choices = document.createElement('details');
  const summary = document.createElement('summary');
  const options = document.createElement('div');
  options.className = 'diagnostics-parameters';
  choices.append(summary, options);
  const scroll = document.createElement('div');
  scroll.className = 'diagnostics-table-scroll';
  scroll.tabIndex = 0;
  scroll.setAttribute('aria-label', '層ごとの値の表をスクロール');
  const table = document.createElement('table');
  const caption = document.createElement('caption');
  caption.textContent = '層ごとの値（元の値 / 重み・合成方法）';
  const head = document.createElement('thead');
  const headers = document.createElement('tr');
  for (const text of ['パラメータ', '最後の値', ...LAYER_ORDER.map((id) => LABELS[id])]) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = text;
    headers.append(th);
  }
  head.append(headers);
  const body = document.createElement('tbody');
  table.append(caption, head, body);
  scroll.append(table);
  const note = document.createElement('div');
  note.className = 'diagnostics-layer-note';
  note.textContent = '— はこの層が担当しない値。最後の値は全層の合成後。表示と層の記録は毎秒2回。';
  root.append(choices, scroll, note);
  let parameters: Parameter[] = [];
  let frame: StudioFrame | null = null;
  let rows: { parameter: Parameter; row: HTMLTableRowElement; cells: HTMLTableCellElement[] }[] = [];
  const setText = (element: HTMLElement, text: string) => {
    if (element.textContent !== text) element.textContent = text;
  };
  const redraw = () => {
    const displayed = parameters.filter((p) => selected.has(p.id));
    setText(summary, `表示するパラメータ（${displayed.length}）`);
    // 選択が同じなら DOM を保ち、変わった値だけを書き換える。
    if (rows.length !== displayed.length || rows.some((row, i) => row.parameter !== displayed[i])) {
      rows = displayed.map((parameter) => {
        const row = document.createElement('tr');
        row.dataset.parameterId = parameter.id;
        const name = document.createElement('th');
        name.scope = 'row';
        name.textContent = parameter.id;
        name.title = parameter.name;
        const final = document.createElement('td');
        final.dataset.final = '';
        row.append(name, final);
        const cells = [final];
        for (const id of LAYER_ORDER) {
          const cell = document.createElement('td');
          cell.dataset.layerId = id;
          row.append(cell);
          cells.push(cell);
        }
        return { parameter, row, cells };
      });
      body.replaceChildren(...rows.map(({ row }) => row));
    }
    for (const { parameter, cells } of rows) {
      setText(cells[0]!, number(frame?.params[parameter.id]));
      for (const [index, id] of LAYER_ORDER.entries()) {
        // 同じ層の producer が複数あればすべて表示する（最後の値は実行部の結果を使う）。
        const layers =
          frame?.layers.filter((layer) => layer.id === id && Object.hasOwn(layer.values, parameter.id)) ?? [];
        const text = layers.length
          ? layers
              .map((layer) => {
                const op = layer.blend?.[parameter.id] ?? 'override';
                const blend = op === 'add' ? '加算' : op === 'multiply' ? '乗算' : op === 'max' ? '大きい方' : '上書き';
                return `${number(layer.values[parameter.id])} / 重み ${number(layer.parameterWeights?.[parameter.id] ?? layer.weight)}・${blend}`;
              })
              .join('\n')
          : '—';
        setText(cells[index + 1]!, text);
      }
    }
  };
  return {
    root,
    update(nextFrame: StudioFrame | null, nextParameters: Parameter[]) {
      frame = nextFrame;
      if (parameters !== nextParameters) {
        parameters = nextParameters;
        options.replaceChildren(
          ...parameters.map((parameter) => {
            const label = document.createElement('label');
            const check = document.createElement('input');
            check.type = 'checkbox';
            check.checked = selected.has(parameter.id);
            check.onchange = () => {
              if (check.checked) selected.add(parameter.id);
              else selected.delete(parameter.id);
              redraw();
            };
            label.append(check, `${parameter.name} (${parameter.id})`);
            return label;
          }),
        );
      }
      redraw();
    },
  };
}
